import type { AgentEvent, ConfirmationDecision } from "../src/core/events";

const log = document.getElementById("log") as HTMLElement;
const empty = document.getElementById("empty") as HTMLElement;
const meta = document.getElementById("meta") as HTMLElement;
const form = document.getElementById("composer") as HTMLFormElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const sendButton = document.getElementById("send") as HTMLButtonElement;
const resetButton = document.getElementById("reset") as HTMLButtonElement;

// Cada carga de la página abre una conversación nueva: el historial vive en el servidor.
let sessionId = crypto.randomUUID();
let modelLabel = "";
let busy = false;
let currentText: HTMLElement | null = null;
const toolCards = new Map<string, HTMLDetailsElement>();
/** Confirmaciones del turno actual; se envían juntas cuando todas tienen decisión. */
let pendingIds: string[] = [];
const decisions = new Map<string, ConfirmationDecision>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function append(node: HTMLElement) {
  empty.hidden = true;
  log.append(node);
  log.scrollTop = log.scrollHeight;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function setBusy(value: boolean) {
  busy = value;
  const locked = busy || pendingIds.length > 0;
  input.disabled = locked;
  sendButton.disabled = locked;
  if (!locked) input.focus();
}

function toolCard(id: string, name: string, args: unknown): HTMLDetailsElement {
  const card = el("details", "tool");
  const summary = el("summary");
  summary.append(el("span", undefined, "🔧"), el("span", "name", name), el("span", "badge", "ejecutando…"));
  const body = el("div", "body");
  body.append(el("h4", undefined, "Entrada"), el("pre", undefined, json(args)));
  card.append(summary, body);
  toolCards.set(id, card);
  append(card);
  return card;
}

function setBadge(card: HTMLElement, text: string, kind: "ok" | "error" | "warn") {
  const badge = card.querySelector(".badge") as HTMLElement;
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function askConfirmation(id: string, reason: string) {
  const card = toolCards.get(id);
  if (!card) return;
  card.classList.add("awaiting");
  card.open = true;
  setBadge(card, "requiere autorización", "warn");
  pendingIds.push(id);

  const panel = el("div", "confirm");
  panel.append(el("p", undefined, `⚠️ ${reason}`));
  const actions = el("div", "actions");
  const approve = el("button", "approve", "Aprobar");
  const reject = el("button", "reject", "Rechazar");
  approve.type = reject.type = "button";
  const decide = (approved: boolean) => {
    const comment = approved ? undefined : (prompt("¿Motivo del rechazo? (opcional)") ?? undefined);
    decisions.set(id, { id, approved, comment: comment || undefined });
    panel.replaceChildren(el("p", undefined, approved ? "✅ Aprobado por ti" : "⛔ Rechazado por ti"));
    card.classList.remove("awaiting");
    if (pendingIds.every((pid) => decisions.has(pid))) void submitDecisions();
  };
  approve.onclick = () => decide(true);
  reject.onclick = () => decide(false);
  actions.append(approve, reject);
  panel.append(actions);
  card.append(panel);
}

async function submitDecisions() {
  const payload = pendingIds.map((pid) => decisions.get(pid)!);
  pendingIds = [];
  decisions.clear();
  await runTurn("/api/confirm", { sessionId, decisions: payload });
}

function handle(event: AgentEvent) {
  switch (event.type) {
    case "text":
      if (!currentText) {
        currentText = el("div", "msg assistant");
        append(currentText);
      }
      currentText.textContent += event.delta;
      log.scrollTop = log.scrollHeight;
      break;
    case "tool_call":
      currentText = null;
      toolCard(event.id, event.name, event.input);
      break;
    case "tool_result": {
      const card = toolCards.get(event.id);
      if (!card) break;
      setBadge(card, event.isError ? "error" : "ok", event.isError ? "error" : "ok");
      const body = card.querySelector(".body") as HTMLElement;
      body.append(el("h4", undefined, "Resultado"), el("pre", undefined, json(event.output)));
      if (event.isError) card.open = true;
      break;
    }
    case "confirmation_required":
      currentText = null;
      askConfirmation(event.id, event.reason);
      break;
    case "error":
      currentText = null;
      append(el("div", "msg error", event.message));
      break;
    case "turn_end": {
      const u = event.usage;
      meta.textContent = `${modelLabel} · último turno: ${u.modelCalls} llamadas, ${u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens} tokens de entrada (${u.cacheReadTokens} desde caché), ${u.outputTokens} de salida`;
      break;
    }
  }
}

async function runTurn(url: string, body: unknown) {
  setBusy(true);
  currentText = null;
  const typing = el("div", "typing", "El agente está trabajando…");
  append(typing);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      handle({ type: "error", message: data.error ?? `Error HTTP ${res.status}` });
      return;
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (frame.startsWith("data: ")) {
          handle(JSON.parse(frame.slice(6)) as AgentEvent);
          log.append(typing);
        }
        sep = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    handle({ type: "error", message: `Se perdió la conexión: ${String(err)}` });
  } finally {
    typing.remove();
    setBusy(false);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy || pendingIds.length > 0) return;
  input.value = "";
  input.style.height = "";
  append(el("div", "msg user", text));
  void runTurn("/api/chat", { sessionId, message: text });
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
});

resetButton.addEventListener("click", async () => {
  if (busy) return;
  await fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  sessionId = crypto.randomUUID();
  pendingIds = [];
  decisions.clear();
  toolCards.clear();
  log.replaceChildren(empty);
  empty.hidden = false;
  setBusy(false);
});

fetch("/api/info")
  .then((r) => r.json())
  .then((info: { model: string; tools: { name: string }[] }) => {
    modelLabel = `Modelo ${info.model}`;
    meta.textContent = `${modelLabel} · ${info.tools.length} herramientas: ${info.tools.map((t) => t.name).join(", ")}`;
  })
  .catch(() => {
    meta.textContent = "No se pudo cargar la información del agente";
  });
