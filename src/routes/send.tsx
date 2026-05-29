import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { loadSettings, saveSettings } from "@/lib/settings";
import { buildPdf, dataUrlToBlob } from "@/lib/pdf";
import { Check, Mail } from "lucide-react";

export const Route = createFileRoute("/send")({
  head: () => ({ meta: [{ title: "Skicka" }] }),
  component: SendPage,
});

function SendPage() {
  const navigate = useNavigate();
  const settings = useMemo(() => loadSettings(), []);
  const [to, setTo] = useState(settings.defaultRecipient);
  const [subject, setSubject] = useState(settings.defaultSubject);
  const [message, setMessage] = useState(settings.defaultMessage);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const s = scanStore.get();
    if (!s.imageDataUrl) {
      navigate({ to: "/" });
  useEffect(() => {
    const s = scanStore.get();
    if (!s.imageDataUrl) {
      navigate({ to: "/" });
      return;
    }
    const imageDataUrl = s.imageDataUrl;
    (async () => {
      const sig = s.signatureDataUrl && s.signaturePosition
        ? { dataUrl: s.signatureDataUrl, x: s.signaturePosition.x, y: s.signaturePosition.y }
        : null;
      const url = await buildPdf(imageDataUrl, sig);
      setPdfUrl(url);
      scanStore.set({ pdfDataUrl: url });
    })();
  }, [navigate]);
  async function send() {
    if (!pdfUrl || !to) return;
    setSending(true);
    try {
      // Save recipient to recents
      const recipients = settings.recipients.filter((r) => r.email !== to);
      recipients.unshift({ email: to });
      saveSettings({ ...settings, recipients: recipients.slice(0, 8) });

      // Trigger download of PDF + open mail client (best web experience)
      const blob = dataUrlToBlob(pdfUrl);
      const fileUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = `${(subject || "dokument").replace(/[^\w\-]+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(fileUrl);

      const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message + "\n\n(Bifoga PDF:en som just laddats ned.)")}`;
      window.location.href = mailto;

      setDone(true);
      setTimeout(() => {
        scanStore.clear();
        navigate({ to: "/" });
      }, 1500);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-full bg-success/15 flex items-center justify-center">
            <Check className="h-8 w-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold mt-5">Klart</h2>
          <p className="text-muted-foreground mt-2 text-sm">Dokumentet har raderats från appen.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Skicka via e-post" back="/preview">
      <div className="flex flex-col gap-4 mt-2">
        <Field label="Till">
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="namn@exempel.se"
            className="input"
          />
          {settings.recipients.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto -mx-1 px-1">
              {settings.recipients.map((r) => (
                <button
                  key={r.email}
                  onClick={() => setTo(r.email)}
                  className="shrink-0 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium"
                >
                  {r.email}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Ämne">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Meddelande">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="input resize-none"
          />
        </Field>
      </div>

      <div className="flex-1" />

      <div className="pt-5">
        <PrimaryButton onClick={send} disabled={!to || !pdfUrl || sending}>
          <span className="inline-flex items-center justify-center gap-2">
            <Mail className="h-5 w-5" />
            {sending ? "Förbereder…" : "Skicka PDF"}
          </span>
        </PrimaryButton>
        <p className="text-center text-xs text-muted-foreground mt-3">
          PDF:en laddas ned och din e-postapp öppnas.
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
