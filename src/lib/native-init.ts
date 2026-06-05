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
}

/** Open the iOS Settings app (used when camera permission is denied). */
export async function openNativeSettings() {
  if (!Capacitor?.isNativePlatform?.()) return false;
  try {
    const { App } = await import("@capacitor/app");
    // iOS app-settings deep link.
    await App.openUrl({ url: "app-settings:" });
    return true;
  } catch {
    return false;
  }
}

export function isNative() {
  return Boolean(Capacitor?.isNativePlatform?.());
}
