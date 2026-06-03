import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { loadSettings, saveSettings } from "@/lib/settings";
import { buildPdf, dataUrlToBlob } from "@/lib/pdf";
import {
  sendScanEmail,
  type SendErrorCode,
  type SendScanEmailResult,
} from "@/lib/email.functions";
import { useT } from "@/lib/i18n";
import { Check, Mail } from "lucide-react";

function makeEmailSchema(t: (k: string) => string) {
  return z
    .string()
    .trim()
    .min(1, { message: t("enterEmail") })
    .max(255, { message: t("emailTooLong") })
    .email({ message: t("invalidEmail") });
}

const optionalEmailSchema = z
  .string()
  .trim()
  .max(255)
  .email()
  .optional()
  .or(z.literal(""));

export const Route = createFileRoute("/send")({
  head: () => ({ meta: [{ title: "Skicka" }] }),
  component: SendPage,
});

function SendPage() {
  const navigate = useNavigate();
  const t = useT();
  const sendEmailFn = useServerFn(sendScanEmail);
  const settings = useMemo(() => loadSettings(), []);
  const [to, setTo] = useState(settings.defaultRecipient);
  const [subject, setSubject] = useState(settings.defaultSubject);
  const [message, setMessage] = useState(settings.defaultMessage);
  const [replyTo, setReplyTo] = useState(settings.userEmail);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const emailSchema = useMemo(() => makeEmailSchema(t), [t]);
  const trimmedTo = to.trim();
  const emailValid = emailSchema.safeParse(trimmedTo).success;

  // Surface a discreet toast when sessionStorage refuses to persist
  // (typically iOS Safari's ~5 MB quota for very large scans).
  useEffect(() => {
    const unsubscribe = scanStore.onQuotaExceeded(() => {
      toast.warning(t("scanTooLargeTitle"), {
        description: t("scanTooLargeDesc"),
        duration: 6000,
      });
    });
    return () => {
      unsubscribe();
    };
  }, [t]);

  useEffect(() => {
    const s = scanStore.get();
    if (!s.imageDataUrl) {
      navigate({ to: "/" });
      return;
    }
    // Rebuild the PDF every time the page mounts. We deliberately do NOT
    // persist the rendered PDF — only the source image + signature live
    // in sessionStorage to stay under the iOS quota.
    const imageDataUrl = s.imageDataUrl;
    const sig =
      s.signatureDataUrl && s.signaturePosition
        ? {
            dataUrl: s.signatureDataUrl,
            x: s.signaturePosition.x,
            y: s.signaturePosition.y,
          }
        : null;
    (async () => {
      const url = await buildPdf(imageDataUrl, sig);
      setPdfUrl(url);
    })();
  }, [navigate]);

  function downloadPdf(): { blob: Blob; filename: string } | null {
    if (!pdfUrl) return null;
    const filename = `${(subject || "dokument").replace(/[^\w\-]+/g, "_")}.pdf`;
    const blob = dataUrlToBlob(pdfUrl);
    const fileUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = fileUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(fileUrl), 10000);
    return { blob, filename };
  }

  async function send() {
    if (!pdfUrl) return;
    const parsed = emailSchema.safeParse(trimmedTo);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "Ogiltig e-postadress");
      return;
    }
    const recipient = parsed.data;

    // Reply-To is optional. Only forward it if it parses as a valid email.
    const replyParsed = optionalEmailSchema.safeParse(replyTo);
    const replyToValue =
      replyParsed.success && replyParsed.data && replyParsed.data.length > 0
        ? replyParsed.data
        : undefined;

    setEmailError(null);
    setSending(true);
    setInfo(null);
    try {
      const recipients = settings.recipients.filter((r) => r.email !== recipient);
      recipients.unshift({ email: recipient });
      saveSettings({
        ...settings,
        recipients: recipients.slice(0, 8),
        // Remember the user's reply-to address for next time.
        userEmail: replyToValue ?? settings.userEmail,
      });

      const filename = `${(subject || "dokument").replace(/[^\w\-]+/g, "_")}.pdf`;
      const pdfBase64 = pdfUrl.includes(",") ? pdfUrl.split(",")[1] : pdfUrl;

      const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
      const approxMb = approxBytes / (1024 * 1024);
      console.log(
        `[send] PDF size: ~${approxMb.toFixed(2)} MB (${approxBytes} bytes)`,
      );
      if (approxMb > 5) {
        setInfo(
          `Varning: PDF:en är ${approxMb.toFixed(1)} MB. Stora bilagor kan blockeras av mottagarens server – om utskicket misslyckas, använd "Ladda ned PDF" och skicka manuellt.`,
        );
      }

      let result: SendScanEmailResult;
      try {
        result = (await sendEmailFn({
          data: {
            to: recipient,
            subject: subject || "Skannat dokument",
            message: message || "",
            filename,
            pdfBase64,
            ...(replyToValue ? { replyTo: replyToValue } : {}),
          },
        })) as SendScanEmailResult;
      } catch (e) {
        // Input-schema rejection or transport failure — surface a clear code.
        const msg = e instanceof Error ? e.message : String(e);
        const code: SendErrorCode =
          msg === "attachment_too_large" ? "attachment_too_large" : "network_error";
        result = { ok: false, code, detail: msg };
      }

      if (result.ok) {
        setDone(true);
        setTimeout(() => {
          scanStore.clear();
          navigate({ to: "/" });
        }, 2200);
      } else {
        console.error("[send] failed:", result);
        setInfo(ERROR_MESSAGES[result.code] ?? ERROR_MESSAGES.unknown);
      }
    } catch (e) {
      console.error(e);
      setInfo(ERROR_MESSAGES.unknown);
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
            inputMode="email"
            autoComplete="email"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              if (emailError) setEmailError(null);
            }}
            onBlur={() => {
              if (!trimmedTo) return;
              const r = emailSchema.safeParse(trimmedTo);
              setEmailError(r.success ? null : r.error.issues[0]?.message ?? "Ogiltig e-postadress");
            }}
            placeholder="namn@exempel.se"
            aria-invalid={!!emailError}
            className="input"
          />
          {emailError && (
            <p className="text-xs text-destructive mt-1.5 ml-1">{emailError}</p>
          )}
          {settings.recipients.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto -mx-1 px-1">
              {settings.recipients.map((r) => (
                <button
                  key={r.email}
                  onClick={() => {
                    setTo(r.email);
                    setEmailError(null);
                  }}
                  className="shrink-0 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium"
                >
                  {r.email}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Din e-post (svar går hit)">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="du@exempel.se (valfritt)"
            className="input"
          />
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

      <div className="pt-5 flex flex-col gap-3">
        <PrimaryButton onClick={send} disabled={!emailValid || !pdfUrl || sending}>
          <span className="inline-flex items-center justify-center gap-2">
            <Mail className="h-5 w-5" />
            {sending ? "Förbereder…" : "Skicka PDF"}
          </span>
        </PrimaryButton>
        <PrimaryButton
          variant="secondary"
          onClick={() => downloadPdf()}
          disabled={!pdfUrl}
          className="h-12 text-[15px]"
        >
          Ladda ned PDF
        </PrimaryButton>
        {info ? (
          <p className="text-center text-xs text-destructive mt-1">{info}</p>
        ) : (
          <p className="text-center text-xs text-muted-foreground mt-1">
            PDF:en bifogas och skickas direkt från servern till mottagaren.
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
