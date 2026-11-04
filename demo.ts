/**
 * Verificación sin modelo de lenguaje: llama directamente a las herramientas y
 * compara cada resultado con lo esperado. Sale con código 1 si algo no coincide.
 *
 *   bun run demo.ts
 *
 * Plantilla del núcleo: cada reto la reescribe con sus casos (sol-001…, msg-001…).
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./src/config";
import { leerResultado } from "./src/core/herramientas";
import { aprobar, consultar, reiniciarRegistros } from "./src/tools/ejemplo";

const ctx = { directory: config.directorio, sessionId: "demo" };

interface Paso {
  nombre: string;
  ejecutar: () => Promise<string>;
  espera: "ok" | "error" | "confirmacion";
}

const pasos: Paso[] = [
  { nombre: "Consulta un registro existente", ejecutar: () => consultar.execute({ codigo: "R-001" }, ctx), espera: "ok" },
  { nombre: "Consulta un registro inexistente", ejecutar: () => consultar.execute({ codigo: "R-999" }, ctx), espera: "error" },
  { nombre: "Aprueba un monto bajo sin confirmación", ejecutar: () => aprobar.execute({ codigo: "R-001" }, ctx), espera: "ok" },
  { nombre: "No permite aprobar dos veces", ejecutar: () => aprobar.execute({ codigo: "R-001" }, ctx), espera: "error" },
  { nombre: "Un monto alto pide confirmación", ejecutar: () => aprobar.execute({ codigo: "R-002" }, ctx), espera: "confirmacion" },
  {
    nombre: "Con confirmación explícita, aprueba el monto alto",
    ejecutar: () => aprobar.execute({ codigo: "R-002", confirmado: true }, ctx),
    espera: "ok",
  },
];

// Determinismo: se parte de `out/` vacío y del estado inicial de los datos.
await rm(join(config.directorio, "out"), { recursive: true, force: true });
reiniciarRegistros();

let fallos = 0;
for (const paso of pasos) {
  const r = leerResultado(await paso.ejecutar());
  const obtenido = r.confirmacion ? "confirmacion" : r.ok ? "ok" : "error";
  const correcto = obtenido === paso.espera;
  if (!correcto) fallos++;
  console.log(`${correcto ? "✔" : "✘"} ${paso.nombre}  [esperado: ${paso.espera}, obtenido: ${obtenido}]`);
  console.log(`    ${r.ok ? JSON.stringify(r.data) : r.error}`);
}

console.log(`\n${pasos.length - fallos}/${pasos.length} pasos correctos`);
process.exit(fallos === 0 ? 0 : 1);
