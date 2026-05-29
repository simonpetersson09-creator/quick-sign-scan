import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import {
  analyzeDocumentQuality,
  QualityReport,
  VERDICT_MESSAGE,
} from "@/lib/quality";
import { Check, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/preview")({
  head: () => ({ meta: [{ title: "Förhandsgranska" }] }),
  component: PreviewPage,
});

function PreviewPage() {
  const navigate = useNavigate();
  const [image, setImage] = useState<string | null>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [analyzing, setAnalyzing] = useState(true);

  useEffect(() => {
    const img = scanStore.get().imageDataUrl;
    if (!img) {
      navigate({ to: "/" });
      return;
    }
    setImage(img);
    setAnalyzing(true);
    analyzeDocumentQuality(img)
      .then((r) => {
        setReport(r);
      })
      .catch(() => {
        setReport(null);
      })
      .finally(() => setAnalyzing(false));
  }, [navigate]);

  function retake() {
    scanStore.set({ imageDataUrl: null, signatureDataUrl: null, signaturePosition: null, pdfDataUrl: null });
    navigate({ to: "/scan" });
  }

  function accept() {
    navigate({ to: "/place" });
  }

  if (!image) return null;

  const ok = report?.verdict === "ok";

  return (
    <AppShell title="Förhandsgranska" back="/">
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        Kontrollera att dokumentet är skarpt och komplett.
      </p>

      <div className="flex items-center justify-center">
        <div
          className="rounded-2xl overflow-hidden shadow-[var(--shadow-card)] border border-border bg-white"
          style={{ width: "min(78vw, 340px)", aspectRatio: "1 / 1.414" }}
        >
          <img src={image} alt="Skannat dokument" className="w-full h-full object-cover" />
        </div>
      </div>

      <div
        className={`mt-5 rounded-2xl p-4 border transition ${
          analyzing
            ? "bg-card border-border"
            : ok
              ? "bg-success/10 border-success/30"
              : "bg-accent/40 border-accent"
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
              analyzing
                ? "bg-secondary text-muted-foreground"
                : ok
                  ? "bg-success text-success-foreground"
                  : "bg-foreground/80 text-background"
            }`}
          >
            {analyzing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : ok ? (
              <Check className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold">
              {analyzing
                ? "Analyserar kvalitet…"
                : report
                  ? VERDICT_MESSAGE[report.verdict]
                  : "Kunde inte analysera"}
            </div>
            {report && (
              <div className="text-[12px] text-muted-foreground mt-0.5">
                {ok
                  ? "Du kan gå vidare till signering."
                  : "Du kan ändå använda bilden, eller ta om den."}
              </div>
            )}
          </div>
        </div>

        {report && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4">
            <Metric
              label="Skärpa"
              ok={report.sharpness >= 55}
              value={Math.round(report.sharpness)}
            />
            <Metric
              label="Kontrast"
              ok={report.contrast >= 28}
              value={Math.round(report.contrast)}
            />
            <Metric
              label="Ljus"
              ok={report.brightness >= 95 && report.brightness <= 240}
              value={Math.round(report.brightness)}
            />
            <Metric
              label="Komplett"
              ok={report.inkBands.every((b) => b >= 0.003)}
              value={`${Math.round(report.inkBands.reduce((a, b) => a + b, 0) * 100)}%`}
            />
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={accept} disabled={analyzing}>
          <span className="inline-flex items-center justify-center gap-2">
            Använd dokument <ArrowRight className="h-5 w-5" />
          </span>
        </PrimaryButton>
        <PrimaryButton variant="secondary" onClick={retake}>
          <span className="inline-flex items-center justify-center gap-2">
            <RefreshCw className="h-5 w-5" /> Ta om bild
          </span>
        </PrimaryButton>
      </div>
    </AppShell>
  );
}

function Metric({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-destructive/80"}`}
        />
        <span className="font-medium tabular-nums">{value}</span>
      </span>
    </div>
  );
}
