/**
 * Eventos que el backend emite por SSE al frontend durante un turno del agente.
 * Este archivo lo importan tanto el servidor como el cliente web.
 */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: unknown; isError: boolean }
  | { type: "confirmation_required"; id: string; name: string; input: unknown; reason: string }
  | { type: "turn_end"; usage: TurnUsage }
  | { type: "error"; message: string };

export interface TurnUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ConfirmationDecision {
  id: string;
  approved: boolean;
  comment?: string;
}
