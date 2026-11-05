import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { OpcionesBitacora } from "./core/bitacora";
import { registrar } from "./core/herramientas";
import * as ejemplo from "./tools/ejemplo";

/**
 * Único punto donde se conecta el dominio del reto. Para cambiar de reto se cambia
 * el import de herramientas y su prefijo; el prompt y el conocimiento son archivos.
 */
export const herramientas = registrar("ejemplo", ejemplo);

export const opcionesBitacora: OpcionesBitacora = {};

/** Cómo se presenta el agente en el chat: título, descripción y sugerencias para empezar. */
export const presentacion = {
  reto: "Núcleo",
  titulo: "Agente de ejemplo",
  descripcion: "Dominio de ejemplo para probar el núcleo: consulta y aprueba registros; los montos altos piden confirmación.",
  sugerencias: [
    { titulo: "Consultar", texto: "Consulta el registro R-001." },
    { titulo: "Aprobar con confirmación", texto: "Consulta el registro R-002 y apruébalo." },
  ],
};

/**
 * System prompt = comportamiento (`agent/prompt.md`) + conocimiento del proceso
 * (`src/knowledge/*.md`). Se mantienen en archivos separados, como pide el PRD.
 */
export async function cargarSistema(directorio: string): Promise<string> {
  const prompt = await Bun.file(join(directorio, "agent", "prompt.md")).text();
  const carpeta = join(directorio, "src", "knowledge");
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith(".md")).sort();
  const conocimiento = await Promise.all(archivos.map((f) => Bun.file(join(carpeta, f)).text()));
  return [prompt.trim(), "# Conocimiento del proceso", ...conocimiento.map((c) => c.trim())].join("\n\n");
}
