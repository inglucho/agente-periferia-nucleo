import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Una herramienta del agente. Es una función pura y tipada: el modelo la invoca
 * a través del ciclo del agente, pero `demo.ts` y los tests la llaman directamente
 * con `tool.run(...)`, sin pasar por ningún LLM.
 */
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /**
   * Devuelve el motivo por el que esta llamada necesita confirmación humana,
   * o `null` si puede ejecutarse sin preguntar. Se evalúa con la entrada ya
   * validada, así que la regla puede depender de los datos (p. ej. montos).
   */
  confirm?: (input: z.infer<S>) => string | null;
  run: (input: z.infer<S>) => unknown | Promise<unknown>;
}

// biome-ignore lint/suspicious/noExplicitAny: el registro mezcla herramientas con esquemas distintos
export type AnyTool = ToolDef<any>;

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/** Convierte una herramienta a la definición que espera la API de Claude. */
export function toApiTool(tool: AnyTool): Anthropic.Beta.BetaTool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input, { io: "input" }) as Record<
    string,
    unknown
  >;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    // Las entradas llegan mientras se generan; por eso validamos con zod antes de ejecutar.
    eager_input_streaming: true,
  };
}

export type ToolOutcome =
  | { ok: true; input: unknown; output: unknown }
  | { ok: false; input: unknown; error: string };

/** Valida la entrada con zod y ejecuta la herramienta. Nunca lanza excepciones. */
export async function executeTool(tool: AnyTool, rawInput: unknown): Promise<ToolOutcome> {
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, input: rawInput, error: `Entrada inválida: ${z.prettifyError(parsed.error)}` };
  }
  try {
    return { ok: true, input: parsed.data, output: await tool.run(parsed.data) };
  } catch (err) {
    return { ok: false, input: parsed.data, error: err instanceof Error ? err.message : String(err) };
  }
}
