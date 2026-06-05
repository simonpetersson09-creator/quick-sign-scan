// Shared access-code helpers.
//
// Two sources for the access code:
//   1. Build-time `VITE_APP_ACCESS_CODE` — used by the Capacitor iOS build.
//      Bake it into the bundle with:
//          VITE_APP_ACCESS_CODE=<code> bun run build && npx cap sync ios
//      The variable is NOT set for the public web build, so the value never
//      ends up in the lovable.app JS bundle.
//   2. `localStorage["app_access_code"]` — set by the web access-code gate
//      after the user enters a valid code.
//
// `getAccessCode()` returns whichever is available; build-time wins so the
// native app never prompts.

const STORAGE_KEY = "app_access_code";

// Bundled at build time. `undefined` in the web build, populated only when
// the Capacitor build is run with VITE_APP_ACCESS_CODE in the environment.
const BUILD_TIME_CODE: string | undefined = import.meta.env
  .VITE_APP_ACCESS_CODE as string | undefined;

function isDev(): boolean {
  return typeof import.meta.env !== "undefined" && !!import.meta.env.DEV;
}

export function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "capacitor:";
}

export function getAccessCode(): string | null {
  if (BUILD_TIME_CODE && BUILD_TIME_CODE.length > 0) return BUILD_TIME_CODE;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAccessCode(code: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* localStorage disabled — caller must handle the resulting empty state */
  }
}

export function clearAccessCode() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function hasUsableAccessCode(): boolean {
  // Capacitor build always carries a baked-in code; the gate should never show.
  if (isCapacitor()) return true;
  if (BUILD_TIME_CODE && BUILD_TIME_CODE.length > 0) return true;
  return !!getAccessCode();
}
