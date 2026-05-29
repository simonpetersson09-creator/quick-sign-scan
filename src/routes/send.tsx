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
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const s = scanStore.get();
    if (!s.imageDataUrl) {
      navigate({ to: "/" });
      return;
    }
    if (s.pdfDataUrl) {
      setPdfUrl(s.pdfDataUrl);
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
    setInfo(null);
    try {
      const recipients = settings.recipients.filter((r) => r.email !== to);
      recipients.unshift({ email: to });
      saveSettings({ ...settings, recipients: recipients.slice(0, 8) });

      const filename = `${(subject || "dokument").replace(/[^\w\-]+/g, "_")}.pdf`;
      const blob = dataUrlToBlob(pdfUrl);
      const file = new File([blob], filename, { type: "application/pdf" });

      // Prefer native share (iOS Safari supports sharing files — user can pick Mail)
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
        share?: (data: ShareData & { files?: File[] }) => Promise<void>;
      };
      let shared = false;
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        try {
          await nav.share({
            files: [file],
            title: subject,
            text: `${message}\n\nTill: ${to}`,
          });
          shared = true;
        } catch (err) {
          // User cancelled — don't fall through
          if ((err as DOMException)?.name === "AbortError") {
            setSending(false);
            return;
          }
          console.warn("Share failed, falling back", err);
        }
      }

      if (!shared) {
        // Fallback: download PDF and open default mail client.
        // mailto cannot attach files — user must attach manually.
        const fileUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = fileUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(fileUrl), 5000);

        const body = `${message}\n\nBifoga PDF:en "${filename}" som just laddats ned.`;
        const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        // Use a click on an anchor — more reliable than location.href on some browsers
        const ma = document.createElement("a");
        ma.href = mailto;
        ma.rel = "noopener";
        document.body.appendChild(ma);
        ma.click();
        ma.remove();
      }

      setDone(true);
      setTimeout(() => {
        scanStore.clear();
        navigate({ to: "/" });
      }, 1800);
    } catch (e) {
      console.error(e);
      setInfo("Kunde inte skicka. Försök igen eller bifoga den nedladdade PDF:en manuellt.");
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
    <AppShell title="Skicka via e-post" back="/review">
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
        {info ? (
          <p className="text-center text-xs text-destructive mt-3">{info}</p>
        ) : (
          <p className="text-center text-xs text-muted-foreground mt-3">
            På iPhone öppnas delningsmenyn — välj Mail. Annars laddas PDF:en ned och din e-postapp öppnas.
          </p>
        )}
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