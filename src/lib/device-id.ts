// Stable per-install device identifier used as the key for the server-side
// premium entitlement and free-quota records.
//
// On native iOS the id is stored in the Keychain (survives reinstalls), with
// localStorage as a synchronous cache.

import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

const KEY = "signgo.device_id.v1";

function isNativeIOS(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return cap?.getPlatform?.() === "ios";
}

function generate(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let cached: string | null = null;

export function getDeviceIdSync(): string {
  if (cached) return cached;
  if (typeof window === "undefined") return "";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const next = generate();
    localStorage.setItem(KEY, next);
    cached = next;
    return next;
  } catch {
    cached = cached ?? generate();
    return cached;
  }
}

/** Reconciles with the Keychain on native iOS. Safe to call repeatedly. */
export async function getDeviceId(): Promise<string> {
  const local = getDeviceIdSync();
  if (!isNativeIOS()) return local;
  try {
    const res = await SecureStoragePlugin.get({ key: KEY });
    if (res?.value) {
      cached = res.value;
      try {
        localStorage.setItem(KEY, res.value);
      } catch {}
      return res.value;
    }
  } catch {
    // Not stored yet.
  }
  try {
    await SecureStoragePlugin.set({ key: KEY, value: local });
  } catch {}
  return local;
}
