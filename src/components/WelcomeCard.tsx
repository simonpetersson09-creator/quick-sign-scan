import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { useT } from "@/lib/i18n";

const KEY = "signgo.premium.welcome.seen.v1";

/**
 * One-time welcome card shown the first time the user opens the app.
 * Explains the 5-free / 99 kr/year model. No paywall, no signup.
 */
export function WelcomeCard() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true);
    } catch {}
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/30 backdrop-blur-sm px-4 pb-safe pt-safe"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-[var(--shadow-card)] p-6 flex flex-col items-center text-center gap-4">
        <div className="h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
          <Crown className="h-5 w-5 text-primary" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight">
            {t("welcome_title")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("welcome_body")}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="mt-2 w-full rounded-xl bg-primary text-primary-foreground h-11 px-6 shadow-[var(--shadow-card)] transition active:scale-[0.98] text-[15px] font-semibold"
        >
          {t("welcome_continue")}
        </button>
      </div>
    </div>
  );
}
