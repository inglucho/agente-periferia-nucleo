import type { AdaptadorLLM } from "./adapter";
import { AdaptadorAnthropic } from "./anthropic";

/**
 * Elige la implementación del proveedor. Añadir uno nuevo es crear su archivo y un caso aquí.
 * La clave se lee de `LLM_API_KEY` solo en este punto y va directo al cliente del proveedor.
 */
export function crearAdaptador(opciones: { proveedor: string; modelo: string; timeoutMs: number }): AdaptadorLLM {
  const apiKey = process.env.LLM_API_KEY;
  switch (opciones.proveedor) {
    case "anthropic":
      return new AdaptadorAnthropic({ modelo: opciones.modelo, timeoutMs: opciones.timeoutMs, apiKey });
    default:
      throw new Error(`Proveedor de IA no soportado: ${opciones.proveedor}`);
  }
}
