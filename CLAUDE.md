# Agente Periferia (prueba técnica)

Agente conversacional en TypeScript + Bun para la prueba técnica de IA de Periferia IT Group. El núcleo (ciclo del agente, chat web, servidor) es independiente del reto; cada reto aporta su prompt y sus herramientas.

## Comandos

- `bun install`: instala dependencias
- `bun run dev`: servidor con recarga en caliente en http://localhost:3000 (requiere `ANTHROPIC_API_KEY` para el chat)
- `bun test`: tests del ciclo del agente con un modelo guionizado (sin API)
- `bun demo.ts`: verificación determinista de las herramientas (sin API)
- `bun run typecheck`: verificación de tipos

Antes de cada commit: `bun run typecheck && bun test && bun demo.ts`.

## Estructura

- `agent/prompt.md`: system prompt. Es lo único que se edita para cambiar el comportamiento conversacional.
- `src/tools/<dominio>.ts`: herramientas del reto, definidas con `defineTool` y zod. Son funciones puras sin dependencia del modelo.
- `src/agente.ts`: conecta prompt + herramientas + modelo. Es el único archivo que cambia al pasar de un reto a otro.
- `src/core/`: núcleo genérico (ciclo del agente, llamada al modelo, sesiones, eventos SSE). No debe importar nada de `src/tools/`.
- `web/`: chat en TypeScript sin framework, empaquetado por Bun desde `index.html`.
- `demo.ts`: un caso por cada caso de prueba del reto, con su resultado esperado.

## Convenciones

- Todo el código, los comentarios y los mensajes al usuario van en español.
- Las reglas de negocio (topes, validaciones, vigencias) viven en las herramientas, nunca en el prompt: así son deterministas y `demo.ts` las puede verificar.
- Toda acción que escriba o registre algo declara `confirm` cuando la regla del PRD exige revisión humana.
- Las herramientas devuelven datos estructurados; para errores esperados lanzan `Error` con un mensaje claro, y `executeTool` lo convierte en `is_error` para el modelo.
- El historial de la sesión solo crece; no reescribir mensajes anteriores (rompe la caché y el razonamiento preservado del modelo).

## Flujo de trabajo

- Nunca hacer commit en `main`: cada cambio va en una rama `feat/…`, `fix/…` o `docs/…` y entra por pull request.
