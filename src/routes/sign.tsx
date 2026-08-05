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
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  // Mittpunkt för kvadratisk utjämning + senaste pennbredd, så att strecket
  // varierar mjukt med hastigheten istället för att vara en jämntjock linje.
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const lastWidth = useRef(2.2);
  const [hasInk, setHasInk] = useState(false);

  // Pennkarakteristik: snabba drag ger tunnare streck, långsamma ger tjockare
  // — samma beteende som en riktig kulspets/reservoarpenna.
  const PEN_MIN_W = 0.9;
  const PEN_MAX_W = 3.4;
  const PEN_VELOCITY_SCALE = 1.6; // px/ms där pennan når sin tunnaste bredd
  const PEN_SMOOTHING = 0.35; // 0 = trögt, 1 = hoppigt



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
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp || performance.now() };
  }

  function start(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = getPoint(e);
    last.current = p;
    lastMid.current = { x: p.x, y: p.y };
    // Starta med en medelbred spets och en liten "nedsättningsprick" så att
    // korta streck och punkter faktiskt syns.
    lastWidth.current = (PEN_MIN_W + PEN_MAX_W) / 2;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, lastWidth.current / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();
    if (!hasInk) setHasInk(true);
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current || !last.current || !lastMid.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = getPoint(e);
    const prev = last.current;

    // Hastighet i px/ms → mål-bredd. Snabbt = tunt, långsamt = tjockt.
    const dt = Math.max(1, p.t - prev.t);
    const speed = Math.hypot(p.x - prev.x, p.y - prev.y) / dt;
    const norm = Math.min(1, speed / PEN_VELOCITY_SCALE);
    const target = PEN_MAX_W - (PEN_MAX_W - PEN_MIN_W) * norm;
    // Lågpassfiltrera bredden så övergångarna blir mjuka, inte hackiga.
    const width = lastWidth.current + (target - lastWidth.current) * PEN_SMOOTHING;

    // Kvadratisk kurva via mittpunkter ger en jämn, handskriven linje
    // istället för synliga raka segment mellan pointer-events.
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(lastMid.current.x, lastMid.current.y);
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
    ctx.lineWidth = width;
    ctx.stroke();

    lastMid.current = mid;
    lastWidth.current = width;
    last.current = p;
    if (!hasInk) setHasInk(true);
  }

  function end() {
    drawing.current = false;
    last.current = null;
    lastMid.current = null;
  }


  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  function done() {
    try {
      const canvas = canvasRef.current;
      if (!canvas) {
        console.error("[sign] done: canvas ref missing");
        return;
      }
      const dataUrl = trimCanvas(canvas);
      if (!dataUrl || !dataUrl.startsWith("data:image/")) {
        console.error("[sign] done: trimCanvas returned invalid dataUrl", { dataUrl });
        return;
      }
      // Ensure a signature position exists — otherwise /review will hide
      // the signature silently. Default to a sensible spot near the bottom
      // of the current/last page if /place hasn't set one yet.
      const existing = scanStore.get().signaturePosition;
      const patch: { signatureDataUrl: string; signaturePosition?: { x: number; y: number } } = {
        signatureDataUrl: dataUrl,
      };
      if (!existing) patch.signaturePosition = { x: 0.5, y: 0.86 };
      scanStore.set(patch);
      navigate({ to: "/review" });
    } catch (err) {
      console.error("[sign] done failed", err);
    }
  }

  return (
    <AppShell title={t("signTitle")} back="/place" className="h-dvh overflow-hidden">
      <div className="mt-auto" />
      <p className="text-sm text-muted-foreground mt-4 text-center">
        {t("signHint")}
      </p>

      <div className="mt-2 relative rounded-2xl bg-card border border-border shadow-[var(--shadow-soft)] overflow-hidden" style={{ aspectRatio: "16 / 9" }}>
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

      <div className="flex gap-3 pt-5">
        <PrimaryButton
          variant="secondary"
          onClick={clear}
          disabled={!hasInk}
          className="w-[30%] inline-flex items-center justify-center gap-1.5"
        >
          <RotateCcw className="h-4 w-4" /> {t("clear")}
        </PrimaryButton>
        <PrimaryButton onClick={done} disabled={!hasInk} className="w-[70%]">
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
