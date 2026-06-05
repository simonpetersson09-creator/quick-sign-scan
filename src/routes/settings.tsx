import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { loadSettings, saveSettings, type AppSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";


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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground ml-1">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
