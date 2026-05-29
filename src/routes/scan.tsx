import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { scanStore } from "@/lib/scanStore";
import { Camera, X } from "lucide-react";

type Status = "starting" | "searching" | "hold" | "found" | "capturing" | "error";

// Normalized bounding box in video coordinates (0..1)
interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Skanna dokument" }] }),
  component: ScanPage,
});

function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const bboxRef = useRef<BBox | null>(null);
  const smoothBboxRef = useRef<BBox | null>(null);
  const stableTicks = useRef(0);
  const lastBbox = useRef<BBox | null>(null);
  const rafRef = useRef<number | null>(null);
  const capturedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("searching");
        loop();
      } catch (e) {
        console.error(e);
        setError("Kunde inte öppna kameran. Kontrollera att du gett behörighet.");
        setStatus("error");
      }
    }
    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loop() {
    const tick = () => {
      detect();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  // Detect bright rectangular region (the paper) using a downscaled luminance pass.
  function detect() {
    if (capturedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    if (!detectCanvasRef.current) {
      detectCanvasRef.current = document.createElement("canvas");
    }
    const dc = detectCanvasRef.current;
    const dw = 160;
    const dh = Math.round((vh / vw) * dw);
    dc.width = dw;
    dc.height = dh;
    const ctx = dc.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, dw, dh);
    const { data } = ctx.getImageData(0, 0, dw, dh);

    // Mean luminance
    let sum = 0;
    const lum = new Float32Array(dw * dh);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      lum[j] = l;
      sum += l;
    }
    const mean = sum / (dw * dh);
    // Threshold = brighter than mean + margin (paper is the brightest region)
    const threshold = Math.max(140, mean + 20);

    // Find bbox of bright-enough pixels (with column/row counts to ignore noise)
    let minX = dw,
      minY = dh,
      maxX = -1,
      maxY = -1;
    let brightCount = 0;
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        if (lum[y * dw + x] > threshold) {
          brightCount++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    const minFill = dw * dh * 0.05; // need at least 5% bright pixels
    if (brightCount < minFill || maxX < 0) {
      // No document
      bboxRef.current = null;
      stableTicks.current = 0;
      smoothBboxRef.current = null;
      updateOverlay(null, false);
      setStatus((s) => (s === "starting" ? s : "searching"));
      return;
    }

    const bbox: BBox = {
      x: minX / dw,
      y: minY / dh,
      w: (maxX - minX + 1) / dw,
      h: (maxY - minY + 1) / dh,
    };

    // Smooth bbox with EMA for stable overlay
    const prev = smoothBboxRef.current;
    const a = 0.35;
    const smooth: BBox = prev
      ? {
          x: prev.x + (bbox.x - prev.x) * a,
          y: prev.y + (bbox.y - prev.y) * a,
          w: prev.w + (bbox.w - prev.w) * a,
          h: prev.h + (bbox.h - prev.h) * a,
        }
      : bbox;
    smoothBboxRef.current = smooth;

    // Stability check (relative to previous raw bbox)
    const last = lastBbox.current;
    const moved = last
      ? Math.abs(bbox.x - last.x) +
        Math.abs(bbox.y - last.y) +
        Math.abs(bbox.w - last.w) +
        Math.abs(bbox.h - last.h)
      : 1;
    lastBbox.current = bbox;
    bboxRef.current = bbox;

    // Need a reasonably large rectangle
    const bigEnough = bbox.w > 0.35 && bbox.h > 0.35;

    if (!bigEnough) {
      stableTicks.current = 0;
      updateOverlay(smooth, false);
      setStatus("searching");
      return;
    }

    if (moved < 0.04) stableTicks.current++;
    else stableTicks.current = Math.max(0, stableTicks.current - 1);

    if (stableTicks.current < 8) {
      updateOverlay(smooth, false);
      setStatus("hold");
    } else if (stableTicks.current < 14) {
      updateOverlay(smooth, true);
      setStatus("found");
    } else {
      updateOverlay(smooth, true);
      setStatus("capturing");
      capture(smooth);
    }
  }

  function updateOverlay(b: BBox | null, active: boolean) {
    const el = overlayRef.current;
    if (!el) return;
    if (!b) {
      el.style.opacity = "0";
      return;
    }
    el.style.opacity = "1";
    el.style.left = `${b.x * 100}%`;
    el.style.top = `${b.y * 100}%`;
    el.style.width = `${b.w * 100}%`;
    el.style.height = `${b.h * 100}%`;
    el.dataset.active = active ? "true" : "false";
  }

  async function capture(bbox: BBox) {
    if (capturedRef.current) return;
    capturedRef.current = true;
    const video = videoRef.current;
    if (!video) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Add a small margin around the detected paper
    const margin = 0.015;
    let bx = Math.max(0, bbox.x - margin);
    let by = Math.max(0, bbox.y - margin);
    let bw = Math.min(1 - bx, bbox.w + margin * 2);
    let bh = Math.min(1 - by, bbox.h + margin * 2);

    const sx = bx * vw;
    const sy = by * vh;
    const sw = bw * vw;
    const sh = bh * vh;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d")!;
    ctx.filter = "contrast(1.18) brightness(1.06) saturate(0.95)";
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    scanStore.set({ imageDataUrl: dataUrl });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    navigate({ to: "/preview" });
  }

  function manualCapture() {
    const b = smoothBboxRef.current ?? { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    setStatus("capturing");
    capture(b);
  }

  const statusText: Record<Status, string> = {
    starting: "Startar kamera…",
    searching: "Söker dokument…",
    hold: "Håll stilla",
    found: "Dokument hittat",
    capturing: "Skannar…",
    error: "Fel",
  };

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/30 pointer-events-none" />

      {/* Dynamic detection overlay — sits over the entire video area */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          ref={overlayRef}
          className="absolute rounded-md transition-opacity duration-200"
          style={{ opacity: 0 }}
        >
          <DynamicCorners />
        </div>
      </div>

      {/* Top bar */}
      <div className="relative pt-safe px-5 flex items-center justify-between">
        <button
          onClick={() => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            navigate({ to: "/" });
          }}
          className="h-10 w-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"
          aria-label="Avbryt"
        >
          <X className="h-5 w-5" />
        </button>
        <div
          className={`px-4 py-2 rounded-full text-[13px] font-medium backdrop-blur transition ${
            status === "found" || status === "capturing"
              ? "bg-success/90 text-success-foreground"
              : "bg-black/50 text-white"
          }`}
        >
          {statusText[status]}
        </div>
        <div className="w-10" />
      </div>

      <div className="flex-1" />

      {/* Bottom hint / manual capture */}
      <div className="relative pb-safe px-5 pt-4 flex flex-col items-center gap-3">
        {error && (
          <p className="text-center text-sm text-red-200 max-w-xs">{error}</p>
        )}
        <button
          onClick={manualCapture}
          disabled={status === "starting" || status === "error" || status === "capturing"}
          className="h-16 w-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 disabled:opacity-40"
          aria-label="Fotografera manuellt"
        >
          <Camera className="h-7 w-7" />
        </button>
        <p className="text-xs text-white/70">Fotograferas automatiskt när dokumentet sitter still</p>
      </div>
    </div>
  );
}

function DynamicCorners() {
  const stroke = 3;
  const len = 26;
  return (
    <div
      className="absolute inset-0 rounded-md"
      style={{ boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.85)" }}
    >
      {(["tl", "tr", "bl", "br"] as const).map((p) => (
        <span
          key={p}
          className="absolute"
          style={{
            width: len,
            height: len,
            borderColor: "var(--success)",
            borderStyle: "solid",
            borderTopWidth: p.startsWith("t") ? stroke : 0,
            borderBottomWidth: p.startsWith("b") ? stroke : 0,
            borderLeftWidth: p.endsWith("l") ? stroke : 0,
            borderRightWidth: p.endsWith("r") ? stroke : 0,
            top: p.startsWith("t") ? -1 : "auto",
            bottom: p.startsWith("b") ? -1 : "auto",
            left: p.endsWith("l") ? -1 : "auto",
            right: p.endsWith("r") ? -1 : "auto",
            borderRadius: 6,
          }}
        />
      ))}
    </div>
  );
}
