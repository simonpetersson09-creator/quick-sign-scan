// iOS 13+ requires DeviceMotionEvent.requestPermission() to be invoked
// synchronously inside a user gesture handler (a click/tap). Calling it
// after async work or on mount fails silently — the promise resolves to
// "denied" without a system prompt.
//
// We expose two helpers:
//   - requestMotionPermissionFromGesture(): MUST be called from a click/tap
//     handler. Fires the permission request synchronously, caches the result.
//   - getMotionPermissionState(): returns the cached state for consumers
//     (e.g. the scanner) so they can decide whether to attach the motion
//     listener or fall back to stricter visual stability gates.

type IOSDME = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export type MotionPermissionState =
  | "granted"
  | "denied"
  | "pending"
  | "unsupported"
  | "unknown";

let cached: MotionPermissionState = "unknown";
const STORAGE_KEY = "motion-perm-v1";

function readStored(): MotionPermissionState | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "granted" || v === "denied") return v;
  } catch {}
  return null;
}

function writeStored(v: "granted" | "denied") {
  try {
    sessionStorage.setItem(STORAGE_KEY, v);
  } catch {}
}

function detectInitial(): MotionPermissionState {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
    return "unsupported";
  }
  const dme = DeviceMotionEvent as IOSDME;
  if (typeof dme.requestPermission !== "function") {
    // Android / desktop / non-iOS Safari — listener works without prompting.
    return "granted";
  }
  return readStored() ?? "unknown";
}

export function getMotionPermissionState(): MotionPermissionState {
  if (cached === "unknown") cached = detectInitial();
  return cached;
}

/**
 * Call SYNCHRONOUSLY from inside a click/tap handler — no `await` before it.
 * Safe to call multiple times; subsequent calls are no-ops once a decision
 * has been recorded.
 */
export function requestMotionPermissionFromGesture(): void {
  const state = getMotionPermissionState();
  if (
    state === "granted" ||
    state === "denied" ||
    state === "unsupported" ||
    state === "pending"
  ) {
    return;
  }
  const dme = DeviceMotionEvent as IOSDME;
  if (typeof dme.requestPermission !== "function") {
    cached = "granted";
    return;
  }
  cached = "pending";
  try {
    dme
      .requestPermission()
      .then((res) => {
        cached = res;
        writeStored(res);
      })
      .catch(() => {
        cached = "denied";
      });
  } catch {
    cached = "denied";
  }
}
