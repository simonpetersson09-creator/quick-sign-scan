import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { loadSettings, saveSettings } from "@/lib/settings";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Inställningar" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [s, setS] = useState(() => loadSettings());
  const [saved, setSaved] = useState(false);

  function update<K extends keyof typeof s>(k: K, v: (typeof s)[K]) {
    setS({ ...s, [k]: v });
    setSaved(false);
  }

  function save() {
    saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <AppShell title="Inställningar" back="/">
      <div className="flex flex-col gap-5 mt-2">
        <Field label="Standardmottagare">
          <input
            type="email"
            value={s.defaultRecipient}
            onChange={(e) => update("defaultRecipient", e.target.value)}
            placeholder="namn@exempel.se"
            className="input"
          />
        </Field>

        <Field label="Standardämne">
          <input
            value={s.defaultSubject}
            onChange={(e) => update("defaultSubject", e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Standardmeddelande">
          <textarea
            value={s.defaultMessage}
            onChange={(e) => update("defaultMessage", e.target.value)}
            rows={5}
            className="input resize-none"
          />
        </Field>

        <Field label="Sparad signatur">
          {s.savedSignature ? (
            <div className="rounded-2xl border border-border bg-card p-3 flex items-center justify-between">
              <img src={s.savedSignature} alt="" className="h-12 object-contain" />
              <button
                onClick={() => update("savedSignature", null)}
                className="text-destructive p-2"
                aria-label="Ta bort signatur"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground text-center">
              Ingen signatur sparad ännu. Du kan spara en signatur när du signerar ett dokument.
            </div>
          )}
        </Field>

        {s.recipients.length > 0 && (
          <Field label="Senaste mottagare">
            <div className="flex flex-wrap gap-2">
              {s.recipients.map((r) => (
                <span key={r.email} className="px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                  {r.email}
                </span>
              ))}
            </div>
          </Field>
        )}
      </div>

      <div className="flex-1" />

      <div className="pt-6">
        <PrimaryButton onClick={save}>
          {saved ? "Sparat ✓" : "Spara inställningar"}
        </PrimaryButton>
        <p className="text-center text-xs text-muted-foreground mt-3">
          Inga dokument sparas — endast dina inställningar.
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
