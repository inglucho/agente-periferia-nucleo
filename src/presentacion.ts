import type { Presentacion } from "./core/presentacion";

/** Guía de uso del dominio de ejemplo del núcleo. */
export const presentacion: Presentacion = {
  reto: "Núcleo",
  titulo: "Agente de ejemplo",
  descripcion: "Dominio de ejemplo para probar el núcleo: consulta y aprueba registros; los montos altos piden confirmación.",
  placeholder: "Escribe una instrucción, por ejemplo: Consulta el registro R-001",
  queHace: ["Consulta registros por su código.", "Aprueba registros; los montos mayores a 5.000.000 piden tu confirmación."],
  sugerencias: [
    { titulo: "Consultar", texto: "Consulta el registro R-001.", espera: "Muestra la descripción, el monto y el estado." },
    { titulo: "Aprobar con confirmación", texto: "Consulta el registro R-002 y apruébalo.", espera: "Como el monto supera el tope, te pide confirmar antes de aprobar." },
  ],
  casos: [
    { id: "R-001", descripcion: "Licencias de software · $1,2 M", resultado: "Se aprueba sin confirmación", tono: "ok", instruccion: "Aprueba el registro R-001." },
    { id: "R-002", descripcion: "Mantenimiento de equipos · $8,5 M", resultado: "Pide confirmación", tono: "confirmar", instruccion: "Aprueba el registro R-002." },
  ],
  confirmaciones: "Las aprobaciones de montos altos se detienen hasta que respondas «Confirmo».",
  resultados: [{ ruta: "out/log.jsonl", descripcion: "Cada llamada a herramienta." }],
};
