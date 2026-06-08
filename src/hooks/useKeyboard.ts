import { useEffect, useState, useCallback } from "react";

export function useKeyboard() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        setVisible(true);
      }
    };

    const onFocusOut = () => {
      // Wait briefly so any immediate focusin (switching between inputs)
      // runs before we hide the toolbar.
      setTimeout(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) {
          setVisible(false);
        }
      }, 60);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const dismiss = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      el.blur();
    }
  }, []);

  return { visible, dismiss };
}
