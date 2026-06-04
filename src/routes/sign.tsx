import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
// settings import removed — signatures are never persisted
import { useT } from "@/lib/i18n";
import { RotateCcw } from "lucide-react";

export const Route = createFileRoute("/sign")({
  head: () => ({ meta: [{ title: "Signera" }] }),
  component: SignPage,
});

function SignPage() {
  const t = useT();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const setup = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Preserve existing strokes across resize/rotation
      const prev = hasInk ? canvas.toDataURL() : null;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2.5;
      if (prev) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
        img.src = prev;
      }
    };
    setup();
    const ro = new ResizeObserver(() => setup());
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getPoint(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = getPoint(e);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  }
  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  function done() {
    const dataUrl = trimCanvas(canvasRef.current!);
    scanStore.set({ signatureDataUrl: dataUrl });
    navigate({ to: "/review" });
  }

  return (
    <AppShell title={t("signTitle")} back="/place">
      <p className="text-sm text-muted-foreground mt-1">
        {t("signHint")}
      </p>

      <div className="mt-4 relative rounded-2xl bg-card border border-border shadow-[var(--shadow-soft)] overflow-hidden" style={{ aspectRatio: "16 / 9" }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute inset-0 w-full h-full touch-none"
        />
        {!hasInk && (
          <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
            <span className="text-xs text-muted-foreground">{t("signHere")}</span>
          </div>
        )}
        <div className="absolute left-4 right-4 bottom-3 border-b border-dashed border-muted-foreground/40 pointer-events-none" />
      </div>

      <div className="mt-2 flex justify-end">
        <button
          onClick={clear}
          disabled={!hasInk}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground disabled:opacity-40 px-2 py-1"
        >
          <RotateCcw className="h-4 w-4" /> {t("clear")}
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={done} disabled={!hasInk}>
          {t("doneContinue")}
        </PrimaryButton>
      </div>
    </AppShell>
  );

}

// Crop a canvas to the bounding box of its non-transparent pixels with
// a small padding, so the exported signature image only contains the
// actual ink and isn't distorted or clipped when placed on the PDF.
function trimCanvas(src: HTMLCanvasElement): string {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext("2d")!;
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return src.toDataURL("image/png");
  }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const px = data.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3];
      if (a > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src.toDataURL("image/png");
  const pad = Math.round(Math.min(w, h) * 0.04);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")!.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}
