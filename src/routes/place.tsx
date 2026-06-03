import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { useT } from "@/lib/i18n";
import { PenLine, Send, Minus, Plus, Maximize2 } from "lucide-react";

export const Route = createFileRoute("/place")({
  head: () => ({ meta: [{ title: "Placera signatur" }] }),
  component: PlacePage,
});

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

function PlacePage() {
  const t = useT();
  const navigate = useNavigate();
  const [image, setImage] = useState<string | null>(null);
  const [sigPos, setSigPos] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.86 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const img = scanStore.get().imageDataUrl;
    if (!img) {
      navigate({ to: "/" });
      return;
    }
    setImage(img);
    scanStore.set({ signaturePosition: { x: 0.5, y: 0.86 } });
  }, [navigate]);

  // Pointer state — distinguish tap (place signature) from drag (pan when zoomed).
  const pointer = useRef<{
    id: number | null;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  }>({ id: null, startX: 0, startY: 0, startPanX: 0, startPanY: 0, moved: false });

  function clampPan(nx: number, ny: number, z: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: nx, y: ny };
    const maxX = (rect.width * (z - 1)) / 2;
    const maxY = (rect.height * (z - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, nx)),
      y: Math.max(-maxY, Math.min(maxY, ny)),
    };
  }

  function placeAtClient(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert screen point → doc-normalized coords, accounting for zoom+pan.
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const localX = (clientX - rect.left - cx - pan.x) / zoom + cx;
    const localY = (clientY - rect.top - cy - pan.y) / zoom + cy;
    const x = Math.max(0.03, Math.min(0.97, localX / rect.width));
    const y = Math.max(0.03, Math.min(0.97, localY / rect.height));
    setSigPos({ x, y });
    scanStore.set({ signaturePosition: { x, y } });
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointer.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
    };
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (pointer.current.id !== e.pointerId) return;
    const dx = e.clientX - pointer.current.startX;
    const dy = e.clientY - pointer.current.startY;
    if (!pointer.current.moved && Math.hypot(dx, dy) > 6) {
      pointer.current.moved = true;
    }
    if (pointer.current.moved && zoom > 1) {
      setPan(clampPan(pointer.current.startPanX + dx, pointer.current.startPanY + dy, zoom));
    }
  }
  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    if (pointer.current.id !== e.pointerId) return;
    if (!pointer.current.moved) {
      placeAtClient(e.clientX, e.clientY);
    }
    pointer.current.id = null;
  }

  function changeZoom(next: number) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +next.toFixed(2)));
    setZoom(z);
    setPan((p) => clampPan(p.x, p.y, z));
  }
  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
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
      <p className="text-sm text-muted-foreground mt-1 mb-3">{t("placeHint")}</p>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-0">
        <div
          ref={containerRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="relative rounded-2xl overflow-hidden shadow-[var(--shadow-card)] border border-border bg-muted/30 touch-none select-none"
          style={{ width: "min(82vw, 360px)", aspectRatio: "1 / 1.414" }}
        >
          <div
            className="absolute inset-0 p-3"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: pointer.current.id === null ? "transform 120ms ease" : "none",
            }}
          >
            <div className="relative w-full h-full">
              <img
                src={image}
                alt={t("scannedAlt")}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none bg-white shadow-sm"
                draggable={false}
              />
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ left: `${sigPos.x * 100}%`, top: `${sigPos.y * 100}%` }}
              >
              <div
                className="rounded-md border-2 border-dashed border-primary/80 bg-primary/10 flex items-center justify-center"
                style={{
                  // Keep signature box visually constant regardless of zoom.
                  width: `${128 / zoom}px`,
                  height: `${40 / zoom}px`,
                }}
              >
                <PenLine className="text-primary" style={{ width: 16 / zoom, height: 16 / zoom }} />
                <span
                  className="ml-1 font-medium text-primary"
                  style={{ fontSize: `${11 / zoom}px` }}
                >
                  {t("signatureLabel")}
                </span>
              </div>
            </div>
            </div>
          </div>
        </div>



        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
          <ZoomButton
            onClick={() => changeZoom(zoom - ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            aria-label={t("zoomOut")}
          >
            <Minus className="h-4 w-4" />
          </ZoomButton>
          <span className="px-3 text-xs font-medium tabular-nums w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <ZoomButton
            onClick={() => changeZoom(zoom + ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            aria-label={t("zoomIn")}
          >
            <Plus className="h-4 w-4" />
          </ZoomButton>
          <ZoomButton onClick={resetView} disabled={zoom === 1 && pan.x === 0 && pan.y === 0} aria-label="Reset">
            <Maximize2 className="h-4 w-4" />
          </ZoomButton>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={goSign}>
          <span className="inline-flex items-center justify-center gap-2">
            <PenLine className="h-5 w-5" /> {t("signDocument")}
          </span>
        </PrimaryButton>
        <PrimaryButton variant="secondary" onClick={goSend}>
          <span className="inline-flex items-center justify-center gap-2">
            <Send className="h-5 w-5" /> {t("sendWithoutSignature")}
          </span>
        </PrimaryButton>
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
