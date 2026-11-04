import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Agent, type Session } from "../src/core/agent";
import type { AgentEvent } from "../src/core/events";
import type { CallModel, ModelRequest } from "../src/core/model";
import { defineTool } from "../src/core/tool";

type Block = Anthropic.Beta.BetaContentBlock;

function message(content: Block[], stop_reason: Anthropic.Beta.BetaStopReason): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Block;

/** Modelo falso: devuelve las respuestas en orden y guarda cada solicitud recibida. */
function scripted(responses: Anthropic.Beta.BetaMessage[]) {
  const requests: ModelRequest[] = [];
  const callModel: CallModel = async (request, onText) => {
    requests.push(structuredClone(request));
    const next = responses.shift();
    if (!next) throw new Error("El modelo guionizado se quedó sin respuestas");
    for (const b of next.content) if (b.type === "text") onText(b.text);
    return next;
  };
  return { callModel, requests };
}

function collector() {
  const events: AgentEvent[] = [];
  return { events, emit: (e: AgentEvent) => events.push(e) };
}

function setup(responses: Anthropic.Beta.BetaMessage[]) {
  const calls: string[] = [];
  const sumar = defineTool({
    name: "sumar",
    description: "Suma dos números",
    input: z.object({ a: z.number(), b: z.number() }),
    run: ({ a, b }) => {
      calls.push("sumar");
      return { total: a + b };
    },
  });
  const pagar = defineTool({
    name: "pagar",
    description: "Registra un pago",
    input: z.object({ monto: z.number() }),
    confirm: ({ monto }) => (monto > 100 ? "Monto alto" : null),
    run: ({ monto }) => {
      calls.push(`pagar:${monto}`);
      return { pagado: monto };
    },
  });
  const model = scripted(responses);
  const agent = new Agent({ systemPrompt: "test", tools: [sumar, pagar], callModel: model.callModel });
  const session: Session = { id: "s1", messages: [] };
  return { agent, session, calls, requests: model.requests };
}

describe("Agent", () => {
  test("ejecuta una herramienta y devuelve el resultado al modelo", async () => {
    const { agent, session, calls, requests } = setup([
      message([toolUse("t1", "sumar", { a: 2, b: 3 })], "tool_use"),
      message([text("El total es 5")], "end_turn"),
    ]);
    const { events, emit } = collector();

    await agent.send(session, "¿cuánto es 2+3?", emit);

    expect(calls).toEqual(["sumar"]);
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "text", "turn_end"]);
    const lastRequest = requests[1]!.messages.at(-1)!;
    expect(lastRequest.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: '{"total":5}' }]);
  });

  test("pausa ante una acción que requiere confirmación y la ejecuta al aprobar", async () => {
    const { agent, session, calls } = setup([
      message([toolUse("t1", "pagar", { monto: 500 })], "tool_use"),
      message([text("Pago registrado")], "end_turn"),
    ]);
    const first = collector();

    await agent.send(session, "paga 500", first.emit);

    expect(calls).toEqual([]);
    expect(session.pending?.awaiting.map((p) => p.use.id)).toEqual(["t1"]);
    expect(first.events.find((e) => e.type === "confirmation_required")).toMatchObject({ reason: "Monto alto" });
    await expect(agent.send(session, "otro mensaje", first.emit)).rejects.toThrow();

    const second = collector();
    await agent.resume(session, [{ id: "t1", approved: true }], second.emit);

    expect(calls).toEqual(["pagar:500"]);
    expect(session.pending).toBeUndefined();
    expect(second.events.map((e) => e.type)).toEqual(["tool_result", "text", "turn_end"]);
  });

  test("no ejecuta la acción si el usuario la rechaza", async () => {
    const { agent, session, calls, requests } = setup([
      message([toolUse("t1", "pagar", { monto: 500 })], "tool_use"),
      message([text("Entendido, no se pagó")], "end_turn"),
    ]);
    const { emit } = collector();

    await agent.send(session, "paga 500", emit);
    await agent.resume(session, [{ id: "t1", approved: false, comment: "no corresponde" }], emit);

    expect(calls).toEqual([]);
    const result = (requests[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain("no corresponde");
  });

  test("ejecuta de inmediato lo que no requiere confirmación y envía todos los resultados juntos", async () => {
    const { agent, session, calls, requests } = setup([
      message([toolUse("t1", "sumar", { a: 1, b: 1 }), toolUse("t2", "pagar", { monto: 900 })], "tool_use"),
      message([text("Listo")], "end_turn"),
    ]);
    const { emit } = collector();

    await agent.send(session, "suma y paga", emit);
    expect(calls).toEqual(["sumar"]);

    await agent.resume(session, [{ id: "t2", approved: true }], emit);
    const results = requests[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["t1", "t2"]);
  });

  test("devuelve un error al modelo cuando la entrada no cumple el esquema", async () => {
    const { agent, session, calls, requests } = setup([
      message([toolUse("t1", "sumar", { a: "dos", b: 3 })], "tool_use"),
      message([text("Corrijo la entrada")], "end_turn"),
    ]);
    const { emit } = collector();

    await agent.send(session, "suma", emit);

    expect(calls).toEqual([]);
    const result = (requests[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain("Entrada inválida");
  });

  test("informa herramientas desconocidas sin romper el ciclo", async () => {
    const { agent, session, requests } = setup([
      message([toolUse("t1", "borrar_todo", {})], "tool_use"),
      message([text("Esa herramienta no existe")], "end_turn"),
    ]);
    const { emit } = collector();

    await agent.send(session, "borra", emit);

    const result = (requests[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!;
    expect(String(result.content)).toContain("Herramienta desconocida");
  });
});
