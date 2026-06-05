// Tracks the number of PDF documents the user has sent on this install.
// Used together with src/lib/premium.ts to gate the free tier (5 docs).
//
// Stored only in localStorage on this device — no server, no account.

const KEY = "signgo.usage.sent_count.v1";

export const FREE_DOC_LIMIT = 5;

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function read(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function write(n: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, String(n));
  } catch {}
  listeners.forEach((l) => l(n));
}

export const usage = {
  getSentCount(): number {
    return read();
  },
  /** Free docs left, clamped to 0. */
  getFreeRemaining(): number {
    return Math.max(0, FREE_DOC_LIMIT - read());
  },
  /** Increment after a successful send. */
  incrementSent(): number {
    const next = read() + 1;
    write(next);
    return next;
  },
  /** Manually reset (for debug / dev only). */
  reset() {
    write(0);
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
