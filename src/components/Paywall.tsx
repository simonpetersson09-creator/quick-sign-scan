import { useState } from "react";
import { Crown, Loader2, Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  purchasePremium,
  restorePremium,
  type PremiumStatus,
} from "@/lib/premium";

// Apple's standard EULA — used when the app doesn't ship a custom EULA.
// Replace with your own Terms of Use URL when you have one.
const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
// TODO: replace with your own hosted Privacy Policy URL before App Store submission.
const PRIVACY_URL = "https://quick-sign-scan.lovable.app/privacy";

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
  const usedAll = freeRemaining <= 0;

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
    <div className="flex flex-col items-center text-center gap-6 px-2 w-full max-w-[340px] mx-auto">
      <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center">
        <Crown className="h-6 w-6 text-primary" strokeWidth={1.75} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("premium_paywall_title")}
        </h2>
        <p className="text-[15px] text-foreground/80 leading-snug">
          {usedAll
            ? t("premium_paywall_used_all", { limit: String(freeLimit) })
            : t("premium_paywall_remaining", {
                remaining: String(freeRemaining),
                limit: String(freeLimit),
              })}
        </p>
      </div>

      <ul className="flex flex-col gap-2.5 text-[15px] text-foreground self-stretch">
        {[
          t("premium_benefit_scan"),
          t("premium_benefit_sign"),
          t("premium_benefit_send"),
        ].map((line) => (
          <li key={line} className="flex items-center gap-2.5 text-left">
            <Check className="h-4 w-4 text-primary shrink-0" strokeWidth={2.5} />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="text-[22px] font-semibold tracking-tight text-foreground">
        {t("premium_price_yearly")}
      </div>

      <div className="flex flex-col gap-2 self-stretch">
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
            {t("premium_start_cta")}
          </span>
        </button>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {t("premium_apple_secure")}
        </p>
        <button
          type="button"
          onClick={restore}
          disabled={busy !== null || unsupported}
          className="mt-1 text-[13px] font-medium text-primary hover:underline disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
        >
          {busy === "restore" && <Loader2 className="h-3 w-3 animate-spin" />}
          {t("premium_restore")}
        </button>
        {unsupported && (
          <p className="text-[12px] text-muted-foreground mt-1">
            {t("premium_only_ios")}
          </p>
        )}
        {info && (
          <p className="text-[12px] text-destructive mt-1">{info}</p>
        )}
      </div>

      {/* Apple-required disclosures for auto-renewable subscriptions. */}
      <div className="self-stretch flex flex-col gap-2 pt-2">
        <p className="text-[11px] leading-snug text-muted-foreground text-left">
          {t("premium_legal_renewal")}
        </p>
        <div className="flex items-center justify-center gap-3 text-[12px] font-medium">
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t("premium_legal_terms")}
          </a>
          <span className="text-muted-foreground/60">·</span>
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t("premium_legal_privacy")}
          </a>
        </div>
      </div>
    </div>
  );
}
