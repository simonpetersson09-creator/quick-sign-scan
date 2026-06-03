import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { useT } from "@/lib/i18n";
import { PenLine, Send } from "lucide-react";

export const Route = createFileRoute("/place")({
  head: () => ({ meta: [{ title: "Placera signatur" }] }),
  component: PlacePage,
});

function PlacePage() {
  const t = useT();
  const navigate = useNavigate();
  const [image, setImage] = useState<string | null>(null);
  const [sigPos, setSigPos] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.86 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const img = scanStore.get().imageDataUrl;
    if (!img) {
      navigate({ to: "/" });
      return;
    }
    setImage(img);
    // Suggested signature line — bottom center of the warped A4
    scanStore.set({ signaturePosition: { x: 0.5, y: 0.86 } });
  }, [navigate]);

  function moveTo(e: React.PointerEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
    setSigPos({ x, y });
    scanStore.set({ signaturePosition: { x, y } });
  }

  function goSign() {
    scanStore.set({ signaturePosition: sigPos });
    navigate({ to: "/sign" });
  }
  function goSend() {
    scanStore.set({ signatureDataUrl: null, signaturePosition: null });
    navigate({ to: "/review" });
  }

  if (!image) return null;

  return (
    <AppShell title={t("placeTitle")} back="/preview">
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        {t("placeHint")}
      </p>
      <div className="flex-1 flex items-center justify-center">
        <div
          ref={containerRef}
          onPointerDown={moveTo}
          className="relative rounded-2xl overflow-hidden shadow-[var(--shadow-card)] border border-border bg-white touch-none select-none"
          style={{ width: "min(82vw, 360px)", aspectRatio: "1 / 1.414" }}
        >
          <img src={image} alt="Skannat dokument" className="absolute inset-0 w-full h-full object-cover" />
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${sigPos.x * 100}%`, top: `${sigPos.y * 100}%` }}
          >
            <div className="w-32 h-10 rounded-md border-2 border-dashed border-primary/80 bg-primary/10 flex items-center justify-center">
              <PenLine className="h-4 w-4 text-primary" />
              <span className="ml-1 text-[11px] font-medium text-primary">Signatur</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={goSign}>
          <span className="inline-flex items-center justify-center gap-2">
            <PenLine className="h-5 w-5" /> Signera dokument
          </span>
        </PrimaryButton>
        <PrimaryButton variant="secondary" onClick={goSend}>
          <span className="inline-flex items-center justify-center gap-2">
            <Send className="h-5 w-5" /> Skicka utan signatur
          </span>
        </PrimaryButton>
      </div>
    </AppShell>
  );
}
