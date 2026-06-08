// Native (Capacitor) initialization. Safe to import on web — every call is
// wrapped in a feature check so missing plugins / browser context just no-op.

import { Capacitor } from "@capacitor/core";

let initialized = false;

export async function initNative() {
  if (initialized) return;
  initialized = true;
  if (!Capacitor?.isNativePlatform?.()) return;

  // Status bar: match the warm app background so the top safe-area isn't
  // black or white on iOS. --background ≈ oklch(0.74 0.008 50) ≈ #d4ccbe.
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    await StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  } catch {}

  // Keyboard: when an input is focused, resize the WebView so the input is
  // not hidden behind the keyboard. With `position: fixed` body we also
  // need scrollIntoView (handled in the global focus listener below).
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
    await Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});
  } catch {}

  // Ensure focused inputs are scrolled into view above the keyboard.
  if (typeof window !== "undefined") {
    document.addEventListener(
      "focusin",
      (e) => {
        const el = e.target as HTMLElement | null;
        if (!el) return;
        const tag = el.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") return;
        // Defer so the keyboard has time to animate in.
        setTimeout(() => {
          try {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          } catch {}
        }, 250);
      },
      true,
    );
  }

  // Tap outside input/textarea to dismiss keyboard.
  // Only on native iOS; on web the browser handles this natively.
  if (typeof window !== "undefined") {
    document.addEventListener(
      "touchend",
      (e) => {
        const active = document.activeElement as HTMLElement | null;
        if (!active) return;
        if (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA") return;

        const target = e.target as HTMLElement | null;
        if (!target) return;

        // Don't dismiss when touching the active input itself.
        if (target === active) return;

        // Don't dismiss when touching inside a label that owns the active input.
        const label = target.closest("label");
        if (label && label.contains(active)) return;

        // Don't dismiss when touching another input/textarea (let focusin handle it).
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

        // Don't dismiss when touching interactive controls — buttons, links, selects —
        // so that tapping e.g. "Send" or a recipient chip doesn't hide the keyboard
        // before the click handler runs.
        const interactive = target.closest(
          "button, a[href], select, [role='button']",
        );
        if (interactive) return;

        active.blur();
      },
      { passive: true, capture: true },
    );
  }
}

/** Open the iOS Settings app (used when camera permission is denied). */
export async function openNativeSettings() {
  if (!Capacitor?.isNativePlatform?.()) return false;
  try {
    // iOS app-settings deep link — use the native bridge directly since
    // @capacitor/app v8 dropped the typed openUrl helper.
    if (typeof window !== "undefined") {
      window.location.href = "app-settings:";
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isNative() {
  return Boolean(Capacitor?.isNativePlatform?.());
}
