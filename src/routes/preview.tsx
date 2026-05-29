import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { analyzeDocumentQuality, QualityReport, VERDICT_MESSAGE } from "@/lib/quality";
import { Check, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/preview")({
  head: () => ({ meta: [{ title: "Förhandsgranska" }] }),
  component: PreviewPage,
});

function PreviewPage() {
  const navigate = useNavigate();
  const [image, setImage] = useState<string | null>(null);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [detection, setDetection] = useState<ReturnType<typeof scanStore.get>["detection"]>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [analyzing, setAnalyzing] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);

  useEffect(() => {
    const img = scanStore.get().imageDataUrl;
    if (!img) {
      navigate({ to: "/" });
      return;
    }
    const session = scanStore.get();
    setImage(img);
    setSourceImage(session.sourceDataUrl);
    setDetection(session.detection);
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
    scanStore.set({
      imageDataUrl: null,
      sourceDataUrl: null,
      detection: null,
      signatureDataUrl: null,
      signaturePosition: null,
      pdfDataUrl: null,
    });
    navigate({ to: "/scan" });
  }

  function accept() {
    navigate({ to: "/place" });
  }

  if (!image) return null;

  const ok = report?.verdict === "ok";
  const canUse = !!detection && !analyzing;
  const polygonPoints = detection?.corners.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");

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
          <img
            src={image}
            alt="Skannat dokument"
            className="w-full h-full object-contain bg-white"
          />
        </div>
      </div>

      {!detection && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium">
          Kunde inte identifiera dokumentets kanter.
        </div>
      )}

      {sourceImage && detection && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-sm font-semibold">Identifierad polygon</span>
            <button
              type="button"
              onClick={() => setDebugOpen((v) => !v)}
              className="text-xs font-medium text-primary"
            >
              {debugOpen ? "Dölj debug" : "Visa debug"}
            </button>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-border bg-background">
            <img
              src={sourceImage}
              alt="Originalbild med identifierad dokumentpolygon"
              className="block w-full h-auto"
            />
            <svg
              className="absolute inset-0 h-full w-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polygon
                points={polygonPoints}
                fill="color-mix(in oklab, var(--success) 16%, transparent)"
                stroke="var(--success)"
                strokeWidth="0.9"
                vectorEffect="non-scaling-stroke"
              />
              {detection.corners.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x * 100}
                  cy={p.y * 100}
                  r="1.5"
                  fill="var(--success)"
                  stroke="var(--background)"
                  strokeWidth="0.45"
                />
              ))}
            </svg>
          </div>
          {debugOpen && (
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
              <Metric
                label="A4-ratio"
                ok={Math.abs(detection.a4Ratio - Math.SQRT2) < 0.18}
                value={detection.a4Ratio.toFixed(2)}
              />
              <Metric
                label="Confidence"
                ok={detection.confidence >= 0.58}
                value={`${Math.round(detection.confidence * 100)}%`}
              />
              <Metric
                label="Kandidater"
                ok={detection.debug.candidateCount > 0}
                value={detection.debug.candidateCount}
              />
              <Metric
                label="A4-score"
                ok={detection.debug.a4Score >= 0.55}
                value={`${Math.round(detection.debug.a4Score * 100)}%`}
              />
              <Metric
                label="Kant-score"
                ok={detection.debug.edgeScore >= 0.34}
                value={`${Math.round(detection.debug.edgeScore * 100)}%`}
              />
              <Metric
                label="Text-score"
                ok={detection.debug.textScore >= 0.2}
                value={`${Math.round(detection.debug.textScore * 100)}%`}
              />
              <Metric
                label="Yta"
                ok={detection.debug.areaRatio >= 0.1 && detection.debug.areaRatio <= 0.9}
                value={`${Math.round(detection.debug.areaRatio * 100)}%`}
              />
              <Metric
                label="Raka sidor"
                ok={detection.debug.sideDeviation < 0.08}
                value={detection.debug.sideDeviation.toFixed(3)}
              />
              <Metric
                label="Perspektiv"
                ok={detection.debug.perspectiveError < 0.95}
                value={detection.debug.perspectiveError.toFixed(2)}
              />
              <Metric label="Canny-tröskel" ok value={Math.round(detection.debug.edgeThreshold)} />
            </div>
          )}
        </div>
      )}

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
        <PrimaryButton onClick={accept} disabled={!canUse}>
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

function Metric({ label, ok, value }: { label: string; ok: boolean; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-success" : "bg-destructive/80"}`} />
        <span className="font-medium tabular-nums">{value}</span>
      </span>
    </div>
  );
}
