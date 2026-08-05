import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { X, Crown, RotateCcw, Loader2, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { loadSettings, saveSettings, type AppSettings } from "@/lib/settings";
import { useT, useLang } from "@/lib/i18n";
import { usePremium, useUsage } from "@/hooks/usePremium";
import { isProductLoaded, purchasePremium, restorePremium } from "@/lib/premium";


export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Inställningar" }] }),
  component: SettingsPage,
});

// SSR-safe initial state (matches what loadSettings returns on the server).
const initial: AppSettings = {
  defaultRecipient: "",
  defaultSubject: "",
  defaultMessage: "",
  recipients: [],
};

function SettingsPage() {
  const t = useT();
  const [s, setS] = useState<AppSettings>(initial);
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load from localStorage only on the client to avoid SSR hydration mismatch.
  useEffect(() => {
    setS(loadSettings());
    setHydrated(true);
  }, []);

  function update<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS({ ...s, [k]: v });
    setSaved(false);
  }

  function save() {
    saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function removeRecipient(email: string) {
    const next = { ...s, recipients: s.recipients.filter((r) => r.email !== email) };
    setS(next);
    saveSettings(next);
  }

  function clearAllRecipients() {
    const next = { ...s, recipients: [] };
    setS(next);
    saveSettings(next);
  }

  return (
    <AppShell
      title={t("settingsTitle")}
      back="/"
      className="h-dvh overflow-hidden"
      mainClassName="overflow-y-auto overscroll-contain"
    >
      <div className="flex flex-col gap-4 mt-2">

        <PremiumSection />

        <section className="rounded-2xl bg-card border border-border divide-y divide-border overflow-hidden">
          <Row label={t("defaultRecipientLabel")}>
            <input
              type="email"
              value={s.defaultRecipient}
              onChange={(e) => update("defaultRecipient", e.target.value)}
              placeholder={t("placeholderTo")}
              className="row-input"
            />
          </Row>

          <Row label={t("defaultSubjectLabel")}>
            <input
              value={s.defaultSubject}
              onChange={(e) => update("defaultSubject", e.target.value)}
              placeholder={t("defaultSubjectInitial")}
              className="row-input"
            />
          </Row>

          <Row label={t("defaultMessageLabel")}>
            <textarea
              value={s.defaultMessage}
              onChange={(e) => update("defaultMessage", e.target.value)}
              placeholder={t("defaultMessageInitial")}
              rows={8}
              className="row-input resize-y min-h-[10rem]"
            />
          </Row>
        </section>

        {hydrated && s.recipients.length > 0 && (
          <section className="rounded-2xl bg-card border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {t("recentRecipients")}
              </span>
              <button
                type="button"
                onClick={clearAllRecipients}
                className="text-[11px] font-medium text-destructive hover:underline shrink-0"
              >
                {t("clearRecipients")}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.recipients.map((r) => (
                <span
                  key={r.email}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1 py-[3px] rounded-full bg-secondary text-secondary-foreground text-[11px] font-medium"
                >
                  {r.email}
                  <button
                    type="button"
                    onClick={() => removeRecipient(r.email)}
                    aria-label={t("removeRecipient")}
                    className="h-4 w-4 inline-flex items-center justify-center rounded-full hover:bg-foreground/10 transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {t("recipientsFootnote")}
            </p>
          </section>
        )}
      </div>


      <div className="flex-1" />

      <div className="pt-6">
        <PrimaryButton onClick={save}>
          {saved ? t("savedCheck") : t("saveSettings")}
        </PrimaryButton>
        <p className="text-center text-xs text-muted-foreground mt-3">
          {t("settingsFootnote")}
        </p>
      </div>

      <style>{`
        .row-input {
          width: 100%;
          background: transparent;
          border: none;
          padding: 0;
          font-size: 15px;
          line-height: 1.35;
          color: var(--foreground);
          outline: none;
        }
        .row-input::placeholder { color: var(--muted-foreground); }
      `}</style>

    </AppShell>
  );
}

function PremiumSection() {
  const t = useT();
  const { lang } = useLang();
  const status = usePremium();
  const { remaining, limit } = useUsage();
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isActive = status.state === "active";
  const unsupported = status.state === "unsupported";
  const loading = status.state === "loading";
  const productReady =
    isActive ||
    unsupported ||
    isProductLoaded() ||
    (status.state === "inactive" && Boolean(status.priceLabel));

  function formatDate(d?: Date | null) {
    if (!d) return "";
    try {
      return d.toLocaleDateString(lang === "sv" ? "sv-SE" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  async function buy() {
    setInfo(null);
    setBusy("buy");
    const r = await purchasePremium();
    setBusy(null);
    if (!r.ok && r.reason !== "unsupported" && r.reason !== "cancelled") {
      if (r.reason === "product_not_loaded" || r.reason === "no_offer") {
        setInfo(t("premium_loading_product"));
      } else {
        setInfo(`${t("premium_purchase_failed")}${r.reason ? ` (${r.reason})` : ""}`);
      }
    }
  }

  async function restore() {
    setInfo(null);
    setBusy("restore");
    const r = await restorePremium();
    setBusy(null);
    if (!r.ok) setInfo(t("premium_restore_failed"));
    else if (!r.active) setInfo(t("premium_restore_none"));
  }

  function openManageSubscriptions() {
    const webUrl = "https://apps.apple.com/account/subscriptions";
    const isNative =
      typeof window !== "undefined" &&
      // Capacitor native shell
      Boolean((window as any).Capacitor?.isNativePlatform?.());
    if (isNative) {
      // itms-apps opens the App Store subscriptions screen directly
      window.location.href = "itms-apps://apps.apple.com/account/subscriptions";
      setTimeout(() => {
        window.location.href = webUrl;
      }, 800);
      return;
    }
    const w = window.open(webUrl, "_blank", "noopener,noreferrer");
    if (!w) window.location.href = webUrl;
  }



  return (
    <section className="rounded-2xl bg-card border border-border p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
            <Crown className="h-4 w-4 text-primary" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold tracking-tight text-primary">
              {t("premium_status_title")}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {loading
                ? t("premium_status_loading")
                : isActive
                  ? t("premium_status_active")
                  : unsupported
                    ? t("premium_status_unsupported")
                    : t("premium_status_inactive")}
            </span>
          </div>
        </div>
        {isActive && (
          <span className="badge-premium inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold shrink-0">
            <Crown className="h-3 w-3" />
            <span>{t("home_premium_badge")}</span>
          </span>
        )}
      </div>


      <div className="text-[12px] text-muted-foreground">
        {isActive ? (
          <div className="ml-0.5">
            <div>{t("premium_unlimited")}</div>
            {status.state === "active" && status.expiryDate && (
              <div className="mt-0.5">
                {status.willRenew === false
                  ? t("premium_status_no_renew", { date: formatDate(status.expiryDate) })
                  : t("premium_status_expires", { date: formatDate(status.expiryDate) })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card border border-border text-foreground/75 shadow-[var(--shadow-soft)] text-[11px] font-medium pl-2.5 pr-3 py-1">
              <span className="flex items-center gap-[3px]" aria-hidden="true">
                {Array.from({ length: limit }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-[6px] w-[6px] rounded-full transition-colors ${
                      i < remaining ? "bg-primary" : "bg-border"
                    }`}
                  />
                ))}
              </span>
              <span className="text-muted-foreground">
                {t("home_free_remaining", { remaining: String(remaining) })}
              </span>
            </span>
          </div>
        )}
      </div>

      {!isActive && (
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={buy}
            disabled={busy !== null || unsupported || !productReady}
            className="btn-premium rounded-xl h-10 px-4 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy === "buy" || !productReady ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Crown className="h-4 w-4" />
            )}
            <span className="text-[13px] font-semibold tracking-tight">
              {!productReady && !unsupported
                ? t("premium_loading_product")
                : t("premium_start_cta")}
            </span>

          </button>
        </div>
      )}

      <div className={`flex items-stretch gap-2 ${isActive ? "pt-1" : "-mt-1"}`}>
        {!isActive && (
          <button
            type="button"
            onClick={restore}
            disabled={busy !== null || unsupported}
            className="flex-1 rounded-xl bg-background text-foreground border border-border h-10 px-3 transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy === "restore" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            <span className="text-[13px] font-medium truncate">{t("premium_restore")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={openManageSubscriptions}
          className="flex-1 rounded-xl bg-background text-foreground border border-border h-10 px-3 transition active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="text-[13px] font-medium truncate">{t("premium_manage_apple")}</span>
        </button>
      </div>




      {info && <p className="text-[12px] text-destructive">{info}</p>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block px-4 py-2.5 focus-within:bg-secondary/30 transition-colors">
      <span className="text-[11px] font-medium text-primary uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );

}
