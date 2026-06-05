// Tracks the number of PDF documents the user has sent on this install.
// Used together with src/lib/premium.ts to gate the free tier (5 docs).
//
// Storage strategy:
// - On native iOS, the authoritative count lives in the iOS Keychain
//   (via capacitor-secure-storage-plugin). Keychain entries survive app
//   uninstalls, so users can't reset the free counter by reinstalling.
// - localStorage is used as a synchronous cache so the UI can render
//   immediately. On startup we reconcile: max(keychain, localStorage)
//   wins and is written back to both.
// - On web / non-iOS, only localStorage is used.

import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

const KEY = "signgo.usage.sent_count.v1";

export const FREE_DOC_LIMIT = 5;

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

let memCount = 0;
let initialized = false;

function isNativeIOS(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return cap?.getPlatform?.() === "ios";
}

function readLocal(): number {
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

function writeLocal(n: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, String(n));
  } catch {}
}

async function readKeychain(): Promise<number | null> {
  if (!isNativeIOS()) return null;
  try {
    const res = await SecureStoragePlugin.get({ key: KEY });
    const n = parseInt(res.value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    // Not set yet, or plugin unavailable.
    return null;
  }
}

async function writeKeychain(n: number): Promise<void> {
  if (!isNativeIOS()) return;
  try {
    await SecureStoragePlugin.set({ key: KEY, value: String(n) });
  } catch (e) {
    console.warn("[usage] keychain write failed", e);
  }
}

function notify() {
  listeners.forEach((l) => l(memCount));
}

function setCount(n: number, persist: { keychain: boolean }) {
  memCount = n;
  writeLocal(n);
  if (persist.keychain) void writeKeychain(n);
  notify();
}

// Seed sync state from localStorage immediately so the first render is correct.
if (typeof window !== "undefined") {
  memCount = readLocal();
}

/**
 * Initialize the counter from Keychain on native iOS. Safe to call multiple
 * times. Resolves once the in-memory count is reconciled with Keychain.
 */
export async function initUsage(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!isNativeIOS()) return;

  const local = readLocal();
  const keychain = await readKeychain();

  if (keychain === null) {
    // First run on this install — seed Keychain with whatever we have locally.
    if (local > 0) await writeKeychain(local);
    return;
  }

  // Keychain wins if it's higher (survives reinstall). Otherwise sync up.
  const next = Math.max(keychain, local);
  if (next !== memCount) {
    memCount = next;
    writeLocal(next);
    notify();
  }
  if (next !== keychain) await writeKeychain(next);
}

export const usage = {
  getSentCount(): number {
    return memCount;
  },
  /** Free docs left, clamped to 0. */
  getFreeRemaining(): number {
    return Math.max(0, FREE_DOC_LIMIT - memCount);
  },
  /** Increment after a successful send. Returns the new count. */
  incrementSent(): number {
    const next = memCount + 1;
    setCount(next, { keychain: true });
    return next;
  },
  /** Manually reset (for debug / dev only). Does NOT clear Keychain. */
  reset() {
    setCount(0, { keychain: false });
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
