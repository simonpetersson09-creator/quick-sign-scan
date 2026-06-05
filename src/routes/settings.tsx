import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { X, Crown, RotateCcw, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { loadSettings, saveSettings, type AppSettings } from "@/lib/settings";
import { useT, useLang } from "@/lib/i18n";
import { usePremium, useUsage } from "@/hooks/usePremium";
import { purchasePremium, restorePremium } from "@/lib/premium";


export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Inställningar" }] }),
  component: SettingsPage,
});

// SSR-safe initial state (matches what loadSettings returns on the server).
const initial: AppSettings = {
  defaultRecipient: "",
  defaultSubject: "Dokument",
  defaultMessage: "Hej,\n\nBifogar dokumentet.\n\nVänliga hälsningar",
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
    <AppShell title={t("settingsTitle")} back="/" className="h-dvh overflow-hidden">
      <div className="flex flex-col gap-5 mt-2">

        <PremiumSection />



        <Field label={t("defaultRecipientLabel")}>
          <input
            type="email"
            value={s.defaultRecipient}
            onChange={(e) => update("defaultRecipient", e.target.value)}
            placeholder={t("placeholderTo")}
            className="input"
          />
        </Field>

        <Field label={t("defaultSubjectLabel")}>
          <input
            value={s.defaultSubject}
            onChange={(e) => update("defaultSubject", e.target.value)}
            className="input"
          />
        </Field>

        <Field label={t("defaultMessageLabel")}>
          <textarea
            value={s.defaultMessage}
            onChange={(e) => update("defaultMessage", e.target.value)}
            rows={5}
            className="input resize-none"
          />
        </Field>

        {hydrated && s.recipients.length > 0 && (
          <Field label={t("recentRecipients")}>
            <div className="flex flex-wrap gap-2">
              {s.recipients.map((r) => (
                <span
                  key={r.email}
                  className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium"
                >
                  {r.email}
                  <button
                    type="button"
                    onClick={() => removeRecipient(r.email)}
                    aria-label={t("removeRecipient")}
                    className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-foreground/10 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={clearAllRecipients}
                className="self-start text-xs font-medium text-destructive hover:underline"
              >
                {t("clearRecipients")}
              </button>
              <p className="text-[11px] text-muted-foreground ml-1">
                {t("recipientsFootnote")}
              </p>
            </div>
          </Field>
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
        .input {
          width: 100%;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px 16px;
          font-size: 16px;
          color: var(--foreground);
          outline: none;
          transition: border-color 150ms;
        }
        .input:focus { border-color: var(--primary); }
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
    if (!r.ok && r.reason !== "unsupported") setInfo(t("premium_purchase_failed"));
  }

  async function restore() {
    setInfo(null);
    setBusy("restore");
    const r = await restorePremium();
    setBusy(null);
    if (!r.ok) setInfo(t("premium_restore_failed"));
    else if (!r.active) setInfo(t("premium_restore_none"));
  }

  return (
    <section className="rounded-2xl bg-card border border-border p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
            <Crown className="h-4 w-4 text-primary" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold tracking-tight text-foreground">
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
      </div>

      <div className="text-[12px] text-muted-foreground ml-0.5">
        {isActive ? (
          <>
            <div>{t("premium_unlimited")}</div>
            {status.state === "active" && status.expiryDate && (
              <div className="mt-0.5">
                {status.willRenew === false
                  ? t("premium_status_no_renew", { date: formatDate(status.expiryDate) })
                  : t("premium_status_expires", { date: formatDate(status.expiryDate) })}
              </div>
            )}
          </>
        ) : (
          <div>
            {t("premium_free_remaining", {
              remaining: String(remaining),
              limit: String(limit),
            })}
          </div>
        )}
      </div>

      {!isActive && (
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={buy}
            disabled={busy !== null || unsupported}
            className="rounded-xl bg-primary text-primary-foreground h-11 px-4 transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy === "buy" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Crown className="h-4 w-4" />
            )}
            <span className="text-[14px] font-semibold">{t("premium_buy_cta")}</span>
          </button>
          <button
            type="button"
            onClick={restore}
            disabled={busy !== null || unsupported}
            className="rounded-xl bg-background text-foreground border border-border h-10 px-4 transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy === "restore" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            <span className="text-[13px] font-medium">{t("premium_restore")}</span>
          </button>
        </div>
      )}

      {isActive && (
        <a
          href="https://apps.apple.com/account/subscriptions"
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-[12px] font-medium text-primary hover:underline mt-1"
        >
          {t("premium_manage_apple")}
        </a>
      )}

      {info && <p className="text-[12px] text-destructive">{info}</p>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground ml-1">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
