import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";

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


export const Route = createFileRoute("/send")({
  head: () => ({ meta: [{ title: "Skicka" }] }),
  component: SendPage,
});

function SendPage() {
  const navigate = useNavigate();
  const t = useT();
  const sendEmailFn = useServerFn(sendScanEmail);
  // Read settings on mount only — avoids SSR/hydration mismatch since
  // loadSettings() touches localStorage.
  const [settings, setSettings] = useState(() => ({
    defaultRecipient: "",
    defaultSubject: "",
    defaultMessage: "",
    recipients: [] as { email: string; label?: string }[],
  }));
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setTo(s.defaultRecipient);
    setSubject(s.defaultSubject || t("defaultSubjectInitial"));
    setMessage(s.defaultMessage || t("defaultMessageInitial"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const emailSchema = useMemo(() => makeEmailSchema(t), [t]);
  const trimmedTo = to.trim();
  const emailValid = emailSchema.safeParse(trimmedTo).success;

  // Scan data is intentionally not wiped on ordinary route unmounts; explicit
  // completion/cancel actions clear it instead.
  useEffect(() => {
    return () => {
      // Don't wipe if user successfully sent (done effect already clears),
      // but ensure abandoned flows leave nothing behind.
    };
  }, []);



  useEffect(() => {
    const s = scanStore.get();
    if (!s.imageDataUrl) {
      navigate({ to: "/" });
      return;
    }
    // Rebuild the PDF every time the page mounts. We deliberately do NOT
    // persist the rendered PDF — only the source image + signature live
    // in sessionStorage to stay under the iOS quota.
    const allPages = s.pages.length > 0 ? s.pages : [s.imageDataUrl];
    const sig =
      s.signatureDataUrl && s.signaturePosition
        ? {
            dataUrl: s.signatureDataUrl,
            x: s.signaturePosition.x,
            y: s.signaturePosition.y,
          }
        : null;
    (async () => {
      const url = await buildPdf(allPages, sig);
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
    setTimeout(() => {
      console.info("[send] revokeObjectURL called", { reason: "download pdf temp url" });
      URL.revokeObjectURL(fileUrl);
    }, 10000);
    return { blob, filename };
  }

  async function send() {
    if (!pdfUrl) return;
    const parsed = emailSchema.safeParse(trimmedTo);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? t("invalidEmail"));
      return;
    }
    const recipient = parsed.data;

    setEmailError(null);
    setSending(true);
    setInfo(null);
    try {
      const recipients = settings.recipients.filter((r) => r.email !== recipient);
      recipients.unshift({ email: recipient });
      saveSettings({
        ...settings,
        defaultSubject: subject,
        defaultMessage: message,
        recipients: recipients.slice(0, 15),
      });

      const filename = `${(subject || "dokument").replace(/[^\w\-]+/g, "_")}.pdf`;
      const pdfBase64 = pdfUrl.includes(",") ? pdfUrl.split(",")[1] : pdfUrl;

      const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
      const approxMb = approxBytes / (1024 * 1024);
      // Privacy: do not log document size in a way that could fingerprint
      // a specific document. A coarse bucket is enough for support.
      if (approxMb > 5) {
        setInfo(t("largePdfWarning", { mb: approxMb.toFixed(1) }));
      }

      let result: SendScanEmailResult;
      try {
        result = (await sendEmailFn({
          data: {
            to: recipient,
            subject: subject || t("defaultSubjectFallback"),
            message: message || "",
            filename,
            pdfBase64,
            
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
          scanStore.clear("email sent");
          navigate({ to: "/" });
        }, 2200);
      } else {
        console.error(`[send] failed code=${result.code} status=${result.status ?? "n/a"}`);
        setInfo(t(`err_${result.code}`) ?? t("err_unknown"));
      }
    } catch (e) {
      console.error(`[send] unexpected error: ${e instanceof Error ? e.name : "unknown"}`);
      setInfo(t("err_unknown"));
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
          <h2 className="text-xl font-semibold mt-5">{t("done")}</h2>
          <p className="text-muted-foreground mt-2 text-sm">{t("doneCleared")}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={t("sendTitle")} back="/review">
      <div className="flex flex-col gap-4 mt-2">
        <Field label={t("fieldTo")}>
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
              setEmailError(r.success ? null : r.error.issues[0]?.message ?? t("invalidEmail"));
            }}
            placeholder={t("placeholderTo")}
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

        <Field label={t("fieldSubject")}>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input"
          />
        </Field>

        <Field label={t("fieldMessage")}>
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
            {sending ? t("preparing") : t("sendPdf")}
          </span>
        </PrimaryButton>
        <PrimaryButton
          variant="secondary"
          onClick={() => downloadPdf()}
          disabled={!pdfUrl}
          className="h-12 text-[15px]"
        >
          {t("downloadPdf")}
        </PrimaryButton>
        {info ? (
          <p className="text-center text-xs text-destructive mt-1">{info}</p>
        ) : (
          <p className="text-center text-xs text-muted-foreground mt-1">
            {t("sendFootnote")}
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
