# Agente Periferia

Agente conversacional en TypeScript (Bun) con herramientas tipadas con zod, confirmación humana para acciones sensibles y un chat web que muestra cada llamada a herramienta.

## Puesta en marcha

```bash
bun install
cp .env.example .env    # y completa ANTHROPIC_API_KEY
bun run dev             # http://localhost:3000
```

Verificación sin modelo de lenguaje:

```bash
bun demo.ts             # ejecuta las herramientas contra los casos de prueba
bun test                # ciclo del agente con un modelo guionizado
```

## Cómo funciona

```
Navegador ──POST /api/chat──▶ Servidor (Bun) ──▶ Agent.send()
    ▲                                              │
    │  SSE: text · tool_call · tool_result         ▼
    │       confirmation_required · turn_end   ciclo: modelo ⇄ herramientas
    │                                              │
    └──POST /api/confirm (aprobar/rechazar)──▶ Agent.resume()
```

1. El usuario escribe; el servidor añade el mensaje a la sesión y llama a Claude con el prompt (`agent/prompt.md`) y las herramientas.
2. Si el modelo pide herramientas, cada entrada se valida con zod y se ejecuta. Los resultados vuelven al modelo, que puede encadenar más llamadas.
3. Si una herramienta declara que la llamada requiere confirmación (`confirm`), el turno se pausa y el chat la resalta con botones **Aprobar / Rechazar**. Las demás herramientas del mismo paso ya se ejecutaron; al decidir, el turno se reanuda con todos los resultados juntos.
4. Cada evento se transmite al navegador por SSE, así que se ve el texto, las llamadas y sus resultados en vivo.

Decisiones principales:

- **Ciclo propio en lugar del tool runner del SDK.** La confirmación humana pausa el turno entre dos peticiones HTTP; un ciclo explícito permite guardar el estado pendiente en la sesión y reanudarlo.
- **Reglas de negocio en código, no en el prompt.** Las validaciones viven en las herramientas, son deterministas y `demo.ts` las prueba sin LLM.
- **Modelo inyectable.** El ciclo depende de una función `CallModel`; los tests usan un modelo guionizado y no gastan tokens.
- **Caché de prompts y fallback.** Cada llamada cachea el prefijo estable (herramientas, prompt, historial) y activa el fallback del servidor ante rechazos por política.

## Despliegue

```bash
docker build -t periferia-agente .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... periferia-agente
```

La imagen sirve en cualquier plataforma de contenedores (Railway, Render, Fly.io, Cloud Run). Las sesiones viven en memoria: basta una sola instancia para la demo.
