import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, ConfirmationDecision, TurnUsage } from "./events";
import type { CallModel } from "./model";
import { type AnyTool, executeTool, type ToolOutcome, toApiTool } from "./tool";

type ToolUse = Anthropic.Beta.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

interface PendingToolUse {
  use: ToolUse;
  tool: AnyTool;
  input: unknown;
}

/**
 * Estado de una conversación. El historial solo crece (nunca se reescribe), lo que
 * mantiene válidos la caché de prompts y los bloques de razonamiento del modelo.
 */
export interface Session {
  id: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  /** Herramientas en espera de confirmación humana; el turno queda pausado. */
  pending?: {
    order: string[];
    results: Map<string, ToolResult>;
    awaiting: PendingToolUse[];
  };
}

export interface AgentConfig {
  systemPrompt: string;
  tools: AnyTool[];
  callModel: CallModel;
  /** Máximo de llamadas al modelo por turno, para cortar ciclos sin salida. */
  maxModelCalls?: number;
}

export type Emit = (event: AgentEvent) => void;

export class Agent {
  private readonly toolsByName: Map<string, AnyTool>;
  private readonly apiTools: Anthropic.Beta.BetaTool[];

  constructor(private readonly config: AgentConfig) {
    this.toolsByName = new Map(config.tools.map((t) => [t.name, t]));
    this.apiTools = config.tools.map(toApiTool);
  }

  get tools(): AnyTool[] {
    return this.config.tools;
  }

  /** Procesa un mensaje del usuario hasta que el agente responde o pide confirmación. */
  async send(session: Session, text: string, emit: Emit): Promise<void> {
    if (session.pending) {
      throw new Error("Hay herramientas esperando confirmación; resuélvelas antes de seguir.");
    }
    session.messages.push({ role: "user", content: text });
    await this.loop(session, emit);
  }

  /** Aplica las decisiones del usuario sobre las herramientas pendientes y reanuda el turno. */
  async resume(session: Session, decisions: ConfirmationDecision[], emit: Emit): Promise<void> {
    const pending = session.pending;
    if (!pending) throw new Error("No hay confirmaciones pendientes.");
    const byId = new Map(decisions.map((d) => [d.id, d]));
    const missing = pending.awaiting.filter((p) => !byId.has(p.use.id));
    if (missing.length > 0) {
      throw new Error(`Faltan decisiones para: ${missing.map((p) => p.use.name).join(", ")}`);
    }

    for (const { use, tool, input } of pending.awaiting) {
      const decision = byId.get(use.id)!;
      if (decision.approved) {
        const outcome = await executeTool(tool, input);
        pending.results.set(use.id, this.report(use, outcome, emit));
      } else {
        const note = decision.comment ? ` Comentario: ${decision.comment}` : "";
        const result = { rechazado: true, motivo: `El usuario no autorizó esta acción.${note}` };
        emit({ type: "tool_result", id: use.id, name: use.name, output: result, isError: true });
        pending.results.set(use.id, {
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result),
          is_error: true,
        });
      }
    }

    session.pending = undefined;
    // Todos los resultados de un mismo turno van juntos y en el orden de las llamadas.
    session.messages.push({ role: "user", content: pending.order.map((id) => pending.results.get(id)!) });
    await this.loop(session, emit);
  }

  private async loop(session: Session, emit: Emit): Promise<void> {
    const usage: TurnUsage = {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const maxCalls = this.config.maxModelCalls ?? 20;

    while (usage.modelCalls < maxCalls) {
      const message = await this.config.callModel(
        { system: this.config.systemPrompt, tools: this.apiTools, messages: session.messages },
        (delta) => emit({ type: "text", delta }),
      );
      usage.modelCalls++;
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;

      if (message.stop_reason === "refusal") {
        emit({ type: "error", message: "El modelo declinó responder esta solicitud." });
        emit({ type: "turn_end", usage });
        return;
      }

      // Se guarda el contenido completo (incluido el razonamiento), no solo el texto.
      session.messages.push({ role: "assistant", content: message.content });

      if (message.stop_reason === "pause_turn") continue;

      const toolUses = message.content.filter((b): b is ToolUse => b.type === "tool_use");
      if (toolUses.length === 0) {
        emit({ type: "turn_end", usage });
        return;
      }
      if (message.stop_reason === "max_tokens") {
        // Una llamada cortada por max_tokens puede traer una entrada truncada: no se ejecuta.
        emit({ type: "error", message: "La respuesta del modelo se cortó por longitud." });
        emit({ type: "turn_end", usage });
        return;
      }

      const results = new Map<string, ToolResult>();
      const awaiting: PendingToolUse[] = [];

      for (const use of toolUses) {
        emit({ type: "tool_call", id: use.id, name: use.name, input: use.input });
        const tool = this.toolsByName.get(use.name);
        if (!tool) {
          const outcome: ToolOutcome = { ok: false, input: use.input, error: `Herramienta desconocida: ${use.name}` };
          results.set(use.id, this.report(use, outcome, emit));
          continue;
        }
        const parsed = tool.input.safeParse(use.input);
        const reason = parsed.success ? tool.confirm?.(parsed.data) : null;
        if (parsed.success && reason) {
          awaiting.push({ use, tool, input: parsed.data });
          emit({ type: "confirmation_required", id: use.id, name: use.name, input: parsed.data, reason });
          continue;
        }
        results.set(use.id, this.report(use, await executeTool(tool, use.input), emit));
      }

      const order = toolUses.map((u) => u.id);
      if (awaiting.length > 0) {
        session.pending = { order, results, awaiting };
        emit({ type: "turn_end", usage });
        return;
      }
      session.messages.push({ role: "user", content: order.map((id) => results.get(id)!) });
    }

    emit({ type: "error", message: `Se alcanzó el límite de ${maxCalls} llamadas al modelo en este turno.` });
    emit({ type: "turn_end", usage });
  }

  private report(use: ToolUse, outcome: ToolOutcome, emit: Emit): ToolResult {
    const output = outcome.ok ? outcome.output : { error: outcome.error };
    emit({ type: "tool_result", id: use.id, name: use.name, output, isError: !outcome.ok });
    return {
      type: "tool_result",
      tool_use_id: use.id,
      content: JSON.stringify(output ?? null),
      ...(outcome.ok ? {} : { is_error: true }),
    };
  }
}
