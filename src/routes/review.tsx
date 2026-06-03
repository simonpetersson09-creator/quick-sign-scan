import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { buildPdf, dataUrlToBlob } from "@/lib/pdf";
import { useT } from "@/lib/i18n";
import { ArrowLeft, Camera, Check, Mail, Minus, PenLine, Plus } from "lucide-react";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Granska PDF" }] }),
  component: ReviewPage,
});

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

function ReviewPage() {
  const navigate = useNavigate();
  const t = useT();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [pages, setPages] = useState<number>(1);
  const [zoom, setZoom] = useState(1);
  const [approved, setApproved] = useState(false);

  const signed = useMemo(() => !!scanStore.get().signatureDataUrl, []);

  useEffect(() => {
    const s = scanStore.get();
    const img = s.imageDataUrl;
    if (!img) {
      navigate({ to: "/" });
      return;
    }
    (async () => {
      const sig =
        s.signatureDataUrl && s.signaturePosition
          ? { dataUrl: s.signatureDataUrl, x: s.signaturePosition.x, y: s.signaturePosition.y }
          : null;
      const url = await buildPdf(img, sig);
      setPdfUrl(url);
      scanStore.set({ pdfDataUrl: url });
      try {
        const blob = dataUrlToBlob(url);
        setSizeBytes(blob.size);
        // Rough page count from raw PDF text
        const text = await blob.text();
        const matches = text.match(/\/Type\s*\/Page[^s]/g);
        setPages(matches?.length || 1);
      } catch {
        setPages(1);
      }
    })();
  }, [navigate]);

  function proceed() {
    if (!approved || !pdfUrl) return;
    navigate({ to: "/send" });
  }

  return (
    <AppShell title={t("reviewTitle")} back="/sign">
      {/* Status row */}
      <div className="mt-1 mb-3 flex flex-wrap items-center gap-2">
        <StatusChip tone="success" label={t("documentReady")} />
        <StatusChip
          tone={signed ? "success" : "muted"}
          label={signed ? t("signed") : t("notSigned")}
        />
        <StatusChip tone="muted" label={`${pages} ${pages === 1 ? t("pageSingular") : t("pagePlural")}`} />
        <StatusChip
          tone="muted"
          label={sizeBytes ? formatBytes(sizeBytes) : "…"}
        />
      </div>

      {/* PDF preview with zoom */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div
          className="relative w-full max-w-[420px] flex-1 min-h-0 overflow-auto rounded-2xl border border-border bg-muted/40 shadow-[var(--shadow-card)]"
        >
          <div
            className="mx-auto my-3 bg-white shadow-sm"
            style={{
              width: `${Math.round(320 * zoom)}px`,
              aspectRatio: "1 / 1.414",
              transition: "width 150ms ease",
            }}
          >
            {pdfUrl ? (
              <iframe
                src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit&zoom=page-fit`}
                title="PDF-förhandsvisning"
                className="w-full h-full block"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                Skapar PDF…
              </div>
            )}
          </div>
        </div>

        {/* Zoom controls */}
        <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
          <ZoomButton
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zooma ut"
          >
            <Minus className="h-4 w-4" />
          </ZoomButton>
          <span className="px-3 text-xs font-medium tabular-nums w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <ZoomButton
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zooma in"
          >
            <Plus className="h-4 w-4" />
          </ZoomButton>
        </div>
      </div>

      {/* Approval + actions */}
      <div className="pt-5 flex flex-col gap-3">
        <label className="flex items-start gap-3 px-1 select-none cursor-pointer">
          <span
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
              approved ? "bg-primary border-primary" : "border-border bg-card"
            }`}
          >
            {approved && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
          </span>
          <input
            type="checkbox"
            className="sr-only"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          <span className="text-sm text-foreground/80 leading-snug">
            Jag har granskat dokumentet och godkänner att det skickas.
          </span>
        </label>

        <PrimaryButton onClick={proceed} disabled={!approved || !pdfUrl}>
          <span className="inline-flex items-center justify-center gap-2">
            <Mail className="h-5 w-5" /> Fortsätt till e-post
          </span>
        </PrimaryButton>

        <div className="grid grid-cols-2 gap-3">
          <PrimaryButton
            variant="secondary"
            onClick={() => navigate({ to: "/place" })}
            className="h-12 text-[15px]"
          >
            <span className="inline-flex items-center justify-center gap-2">
              <PenLine className="h-4 w-4" /> Flytta signatur
            </span>
          </PrimaryButton>
          <PrimaryButton
            variant="secondary"
            onClick={() => {
              scanStore.clear();
              navigate({ to: "/scan" });
            }}
            className="h-12 text-[15px]"
          >
            <span className="inline-flex items-center justify-center gap-2">
              <Camera className="h-4 w-4" /> Ta om bild
            </span>
          </PrimaryButton>
        </div>

        <button
          onClick={() => navigate({ to: "/sign" })}
          className="inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition py-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Tillbaka till signering
        </button>
      </div>
    </AppShell>
  );
}

function ZoomButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground/80 hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition"
    >
      {children}
    </button>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "muted";
}) {
  const cls =
    tone === "success"
      ? "bg-success/12 text-success border-success/20"
      : "bg-secondary text-secondary-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}
    >
      {tone === "success" && <Check className="h-3 w-3" />}
      {label}
    </span>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
