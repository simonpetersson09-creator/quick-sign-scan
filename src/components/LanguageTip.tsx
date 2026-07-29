import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

const STORAGE_KEY = "sg_lang_tip_seen";

/**
 * One-time onboarding speech bubble that points at the language button.
 * Purely presentational; dismisses on any interaction and never returns.
 */
export function LanguageTip({ dismissed }: { dismissed?: boolean }) {
  const { t } = useLang();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      return;
    }
    const showTimer = window.setTimeout(() => {
      setMounted(true);
      window.requestAnimationFrame(() => setVisible(true));
    }, 800);
    return () => window.clearTimeout(showTimer);
  }, []);

  // auto-hide + dismiss on any interaction
  useEffect(() => {
    if (!mounted) return;
    const close = () => setVisible(false);
    const hideTimer = window.setTimeout(close, 4000);
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", close, opts);
    window.addEventListener("touchstart", close, opts);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, opts);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("touchstart", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close);
    };
  }, [mounted]);

  useEffect(() => {
    if (dismissed) setVisible(false);
  }, [dismissed]);

  // unmount after the fade-out finishes
  useEffect(() => {
    if (!mounted || visible) return;
    const timer = window.setTimeout(() => setMounted(false), 300);
    return () => window.clearTimeout(timer);
  }, [mounted, visible]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-[calc(100%+14px)] right-1 z-40 w-[220px] origin-bottom-right"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
        transition: "opacity 300ms cubic-bezier(0.32,0.72,0,1), transform 300ms cubic-bezier(0.32,0.72,0,1)",
      }}
    >
      <div className="relative rounded-[24px] border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
        <div className="flex items-start gap-2.5">
          <span className="text-[18px] leading-[1.2]">🌍</span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-snug tracking-tight text-foreground">
              {t("langTipTitle")}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
              {t("langTipBody")}
            </p>
          </div>
        </div>
        {/* pointer */}
        <div className="absolute -bottom-[6px] right-[18px] h-3 w-3 rotate-45 rounded-[3px] border-b border-r border-border bg-card" />
      </div>
    </div>
  );
}
