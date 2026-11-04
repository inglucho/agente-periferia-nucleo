import { z } from "zod";
import { defineTool } from "../core/tool";

/**
 * Dominio de ejemplo para probar el núcleo de punta a punta mientras llega el reto.
 * Se reemplaza por las herramientas del reto elegido (p. ej. `src/tools/oc.ts`).
 */

interface Registro {
  codigo: string;
  descripcion: string;
  monto: number;
  estado: "pendiente" | "aprobado";
}

const registros = new Map<string, Registro>([
  ["R-001", { codigo: "R-001", descripcion: "Licencias de software", monto: 1_200_000, estado: "pendiente" }],
  ["R-002", { codigo: "R-002", descripcion: "Mantenimiento de equipos", monto: 8_500_000, estado: "pendiente" }],
]);

/** Por encima de este monto, aprobar un registro exige confirmación humana. */
export const TOPE_SIN_CONFIRMACION = 5_000_000;

export const consultarRegistro = defineTool({
  name: "consultar_registro",
  description: "Consulta un registro por su código y devuelve su descripción, monto y estado.",
  input: z.object({
    codigo: z.string().describe("Código del registro, p. ej. R-001"),
  }),
  run: ({ codigo }) => registros.get(codigo.toUpperCase()) ?? { encontrado: false, codigo },
});

export const aprobarRegistro = defineTool({
  name: "aprobar_registro",
  description:
    "Marca un registro como aprobado. Los montos altos requieren confirmación humana antes de ejecutarse.",
  input: z.object({
    codigo: z.string().describe("Código del registro a aprobar"),
    justificacion: z.string().min(5).describe("Motivo de la aprobación"),
  }),
  confirm: ({ codigo }) => {
    const registro = registros.get(codigo.toUpperCase());
    if (registro && registro.monto > TOPE_SIN_CONFIRMACION) {
      return `El monto (${registro.monto.toLocaleString("es-CO")}) supera el tope de ${TOPE_SIN_CONFIRMACION.toLocaleString("es-CO")}.`;
    }
    return null;
  },
  run: ({ codigo, justificacion }) => {
    const registro = registros.get(codigo.toUpperCase());
    if (!registro) throw new Error(`No existe el registro ${codigo}`);
    if (registro.estado === "aprobado") throw new Error(`El registro ${codigo} ya estaba aprobado`);
    registro.estado = "aprobado";
    return { ...registro, justificacion };
  },
});

export const herramientas = [consultarRegistro, aprobarRegistro];
