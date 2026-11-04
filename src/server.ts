import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import index from "../web/index.html";
import { crearAgente, MODEL } from "./agente";
import type { Agent, Session } from "./core/agent";
import type { AgentEvent } from "./core/events";
import { SessionStore } from "./core/sessions";

const agent = await crearAgente();
const sessions = new SessionStore();

const ChatBody = z.object({ sessionId: z.string().min(1), message: z.string().min(1) });
const ConfirmBody = z.object({
  sessionId: z.string().min(1),
  decisions: z.array(z.object({ id: z.string(), approved: z.boolean(), comment: z.string().optional() })),
});
const ResetBody = z.object({ sessionId: z.string().min(1) });

/** Ejecuta un turno del agente y transmite sus eventos al navegador por SSE. */
function streamTurn(sessionId: string, run: (agent: Agent, session: Session, emit: (e: AgentEvent) => void) => Promise<void>) {
  const session = sessions.acquire(sessionId);
  if (!session) return Response.json({ error: "La sesión ya está procesando un turno." }, { status: 409 });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      // Mantiene viva la conexión mientras el modelo razona sin emitir texto.
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      try {
        await run(agent, session, send);
      } catch (err) {
        console.error(err);
        send({ type: "error", message: describeError(err) });
      } finally {
        clearInterval(heartbeat);
        sessions.release(sessionId);
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Credenciales de Anthropic inválidas o ausentes.";
  if (err instanceof Anthropic.RateLimitError) return "Límite de uso de la API alcanzado; intenta de nuevo en un momento.";
  if (err instanceof Anthropic.APIError) return `Error de la API (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 255,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/api/health": () => Response.json({ ok: true }),
    "/api/info": () =>
      Response.json({ model: MODEL, tools: agent.tools.map((t) => ({ name: t.name, description: t.description })) }),
    "/api/chat": {
      POST: async (req) => {
        const parsed = ChatBody.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
        const { sessionId, message } = parsed.data;
        return streamTurn(sessionId, (a, s, emit) => a.send(s, message, emit));
      },
    },
    "/api/confirm": {
      POST: async (req) => {
        const parsed = ConfirmBody.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
        const { sessionId, decisions } = parsed.data;
        return streamTurn(sessionId, (a, s, emit) => a.resume(s, decisions, emit));
      },
    },
    "/api/reset": {
      POST: async (req) => {
        const parsed = ResetBody.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
        sessions.reset(parsed.data.sessionId);
        return Response.json({ ok: true });
      },
    },
  },
});

console.log(`Agente escuchando en ${server.url} (modelo ${MODEL})`);
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("Aviso: no hay ANTHROPIC_API_KEY; el chat fallará hasta configurarla (ver .env.example).");
}
