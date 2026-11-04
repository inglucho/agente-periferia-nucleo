import { Agent } from "./core/agent";
import { type CallModel, createClaudeModel, DEFAULT_MODEL } from "./core/model";
import { herramientas } from "./tools/ejemplo";

/** Punto único donde se conecta el dominio del reto: prompt + herramientas. */
export const MODEL = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

export async function crearAgente(callModel?: CallModel): Promise<Agent> {
  const systemPrompt = await Bun.file(new URL("../agent/prompt.md", import.meta.url)).text();
  return new Agent({
    systemPrompt,
    tools: herramientas,
    callModel: callModel ?? createClaudeModel({ model: MODEL }),
  });
}
