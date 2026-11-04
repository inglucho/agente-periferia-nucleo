/**
 * Verificación determinista: ejecuta las herramientas directamente, sin modelo de
 * lenguaje, y compara cada resultado con lo esperado. Sale con código 1 si algo falla.
 *
 *   bun demo.ts
 *
 * Mientras llega el reto usa el dominio de ejemplo; luego cada caso de prueba del
 * reto (sol-001…, msg-001…) se convierte en un caso de esta lista.
 */
import { aprobarRegistro, consultarRegistro } from "./src/tools/ejemplo";
import { executeTool, type AnyTool } from "./src/core/tool";

interface Caso {
  nombre: string;
  tool: AnyTool;
  input: unknown;
  /** Qué debe ocurrir: resultado esperado (parcial), error esperado o confirmación requerida. */
  espera: { ok: Record<string, unknown> } | { error: string } | { confirmacion: true };
}

const casos: Caso[] = [
  {
    nombre: "Consulta un registro existente",
    tool: consultarRegistro,
    input: { codigo: "R-001" },
    espera: { ok: { codigo: "R-001", estado: "pendiente" } },
  },
  {
    nombre: "Consulta un registro inexistente",
    tool: consultarRegistro,
    input: { codigo: "R-999" },
    espera: { ok: { encontrado: false } },
  },
  {
    nombre: "Aprueba un monto bajo sin pedir confirmación",
    tool: aprobarRegistro,
    input: { codigo: "R-001", justificacion: "Renovación anual" },
    espera: { ok: { estado: "aprobado" } },
  },
  {
    nombre: "Un monto alto exige confirmación humana",
    tool: aprobarRegistro,
    input: { codigo: "R-002", justificacion: "Mantenimiento preventivo" },
    espera: { confirmacion: true },
  },
  {
    nombre: "Rechaza una entrada que no cumple el esquema",
    tool: aprobarRegistro,
    input: { codigo: "R-001", justificacion: "x" },
    espera: { error: "Entrada inválida" },
  },
  {
    nombre: "No permite aprobar dos veces",
    tool: aprobarRegistro,
    input: { codigo: "R-001", justificacion: "Intento duplicado" },
    espera: { error: "ya estaba aprobado" },
  },
];

function contiene(actual: unknown, esperado: Record<string, unknown>): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(esperado).every(([k, v]) => (actual as Record<string, unknown>)[k] === v);
}

let fallos = 0;
for (const caso of casos) {
  let ok: boolean;
  let detalle: unknown;

  if ("confirmacion" in caso.espera) {
    const parsed = caso.tool.input.safeParse(caso.input);
    const motivo = parsed.success ? caso.tool.confirm?.(parsed.data) : null;
    ok = Boolean(motivo);
    detalle = motivo ?? "no pidió confirmación";
  } else {
    const outcome = await executeTool(caso.tool, caso.input);
    detalle = outcome.ok ? outcome.output : outcome.error;
    ok =
      "ok" in caso.espera
        ? outcome.ok && contiene(outcome.output, caso.espera.ok)
        : !outcome.ok && outcome.error.includes(caso.espera.error);
  }

  if (!ok) fallos++;
  console.log(`${ok ? "✔" : "✘"} ${caso.nombre}`);
  console.log(`    ${caso.tool.name}(${JSON.stringify(caso.input)}) → ${JSON.stringify(detalle)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos === 0 ? 0 : 1);
