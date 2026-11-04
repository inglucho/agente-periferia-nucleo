import type { Session } from "./agent";

interface Entry {
  session: Session;
  busy: boolean;
  lastUsed: number;
}

const TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Sesiones en memoria. Suficiente para la demo; en producción iría en Redis o una
 * base de datos para sobrevivir reinicios y escalar a varias instancias.
 */
export class SessionStore {
  private readonly entries = new Map<string, Entry>();

  /** Reserva la sesión para un turno. Devuelve `null` si ya hay un turno en curso. */
  acquire(id: string): Session | null {
    this.evictExpired();
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { session: { id, messages: [] }, busy: false, lastUsed: Date.now() };
      this.entries.set(id, entry);
    }
    if (entry.busy) return null;
    entry.busy = true;
    entry.lastUsed = Date.now();
    return entry.session;
  }

  release(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.busy = false;
  }

  reset(id: string): void {
    this.entries.delete(id);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (!entry.busy && now - entry.lastUsed > TTL_MS) this.entries.delete(id);
    }
  }
}
