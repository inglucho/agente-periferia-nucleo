import Anthropic from "@anthropic-ai/sdk";

export interface ModelRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
}

/**
 * Una llamada al modelo: recibe el estado de la conversación y devuelve el mensaje
 * completo, avisando cada fragmento de texto por `onText`. El ciclo del agente solo
 * depende de esta firma, así que en los tests se reemplaza por un modelo guionizado.
 */
export type CallModel = (
  request: ModelRequest,
  onText: (delta: string) => void,
) => Promise<Anthropic.Beta.BetaMessage>;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeOptions {
  model?: string;
  effort?: Effort;
  maxTokens?: number;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export function createClaudeModel(options: ClaudeOptions = {}): CallModel {
  // Toma las credenciales del entorno (ANTHROPIC_API_KEY u otro origen configurado).
  const client = new Anthropic();
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? "medium";
  const maxTokens = options.maxTokens ?? 64000;

  return async (request, onText) => {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      system: request.system,
      tools: request.tools,
      messages: request.messages,
      output_config: { effort },
      // Cachea el prefijo estable (herramientas + system prompt + historial previo).
      cache_control: { type: "ephemeral" },
      // Si el modelo declina por política, la API reintenta con otro modelo en la misma llamada.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    stream.on("text", onText);
    // Si falla (red, API o una entrada de herramienta ilegible), el error sube al servidor;
    // el historial queda consistente, así que el usuario puede reenviar el mensaje.
    return stream.finalMessage();
  };
}
