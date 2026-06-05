import { useState } from "react";
import { Crown, RotateCcw, Loader2, Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  purchasePremium,
  restorePremium,
  type PremiumStatus,
} from "@/lib/premium";

interface Props {
  status: PremiumStatus;
  freeRemaining: number;
  freeLimit: number;
  onClose?: () => void;
}

export function Paywall({ status, freeRemaining, freeLimit, onClose }: Props) {
  const t = useT();
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const unsupported = status.state === "unsupported";

  async function buy() {
    setInfo(null);
    setBusy("buy");
    const res = await purchasePremium();
    setBusy(null);
    if (!res.ok && res.reason !== "unsupported") {
      setInfo(t("premium_purchase_failed"));
    }
  }

  async function restore() {
    setInfo(null);
    setBusy("restore");
    const res = await restorePremium();
    setBusy(null);
    if (!res.ok) setInfo(t("premium_restore_failed"));
    else if (!res.active) setInfo(t("premium_restore_none"));
    else if (onClose) onClose();
  }

  return (
    <div className="flex flex-col items-center text-center gap-5 px-2">
      <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center">
        <Crown className="h-6 w-6 text-primary" strokeWidth={1.75} />
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("premium_paywall_title")}
        </h2>
        <p className="text-sm text-muted-foreground max-w-[300px]">
          {freeRemaining > 0
            ? t("premium_paywall_remaining", {
                remaining: String(freeRemaining),
                limit: String(freeLimit),
              })
            : t("premium_paywall_limit_reached", { limit: String(freeLimit) })}
        </p>
      </div>

      <ul className="flex flex-col gap-2 text-sm text-foreground/85 self-stretch max-w-[320px] mx-auto">
        {[
          t("premium_benefit_unlimited"),
          t("premium_benefit_no_ads"),
          t("premium_benefit_support"),
        ].map((line) => (
          <li key={line} className="flex items-start gap-2 text-left">
            <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2.5 self-stretch max-w-[320px] mx-auto pt-1">
        <button
          type="button"
          onClick={buy}
          disabled={busy !== null || unsupported}
          className="rounded-xl bg-primary text-primary-foreground h-12 px-6 shadow-[var(--shadow-card)] transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy === "buy" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Crown className="h-4 w-4" />
          )}
          <span className="text-[15px] font-semibold">
            {t("premium_buy_cta")}
          </span>
        </button>
        <button
          type="button"
          onClick={restore}
          disabled={busy !== null || unsupported}
          className="rounded-xl bg-card text-foreground border border-border h-11 px-6 transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy === "restore" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          <span className="text-[14px] font-medium">{t("premium_restore")}</span>
        </button>
        {unsupported && (
          <p className="text-[12px] text-muted-foreground mt-1">
            {t("premium_only_ios")}
          </p>
        )}
        {info && (
          <p className="text-[12px] text-destructive mt-1">{info}</p>
        )}
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          {t("premium_legal_footnote")}
        </p>
      </div>
    </div>
  );
}
