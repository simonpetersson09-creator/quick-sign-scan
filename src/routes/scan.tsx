import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { scanStore } from "@/lib/scanStore";
import {
  detectDocumentQuad,
  Point,
  emaQuad,
  enhancePaper,
  maxCornerDelta,
  warpQuadToRect,
} from "@/lib/perspective";
import { Camera, X } from "lucide-react";

type Status =
  | "starting"
  | "searching"
  | "uncertain"
  | "align"
  | "hold"
  | "ready"
  | "capturing"
  | "error";

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Skanna dokument" }] }),
  component: ScanPage,
});

// Stability requirements — the document must be locked in on all 4 corners
// for a sustained period before the camera captures, so we never fire too early.
const STABLE_DELTA = 0.008; // normalized 0..1 — max corner movement to count as stable
const DETECT_FRAMES = 8;    // consecutive detections before we even consider it found
const HOLD_FRAMES = 18;     // ~0.6s — "Håll stilla" phase
const READY_FRAMES = 45;    // ~1.5s — "Dokument hittat" lock-in
const STABLE_FRAMES = 75;   // ~2.5s total before auto-capture

function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const polyRef = useRef<SVGPolygonElement | null>(null);
  const cornerRefs = useRef<SVGCircleElement[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectCanvas = useRef<HTMLCanvasElement | null>(null);

  const lastRawQuad = useRef<[Point, Point, Point, Point] | null>(null);
  const smoothQuad = useRef<[Point, Point, Point, Point] | null>(null); // normalized 0..1
  const detectionMeta = useRef<ReturnType<typeof detectDocumentQuad> | null>(null);
  const stableCount = useRef(0);
  const detectCount = useRef(0);
  const missCount = useRef(0);
  const capturedRef = useRef(false);

  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);

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
      if (!capturedRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function detect() {
    if (capturedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    if (!detectCanvas.current) detectCanvas.current = document.createElement("canvas");
    const dc = detectCanvas.current;
    const dw = 200;
    const dh = Math.round((vh / vw) * dw);
    if (dc.width !== dw || dc.height !== dh) {
      dc.width = dw;
      dc.height = dh;
    }
    const ctx = dc.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, dw, dh);
    const { data } = ctx.getImageData(0, 0, dw, dh);

    const detection = detectDocumentQuad(data, dw, dh);
    const corners = detection?.corners ?? null;

    if (!corners) {
      stableCount.current = 0;
      detectCount.current = Math.max(0, detectCount.current - 1);
      detectionMeta.current = null;
      missCount.current++;
      if (detectCount.current === 0) {
        smoothQuad.current = null;
        lastRawQuad.current = null;
        drawOverlay(null, false);
      }
      setStatus((s) => (s === "starting" ? s : missCount.current > 45 ? "uncertain" : "searching"));
      return;
    }

    detectCount.current++;
    missCount.current = 0;
    detectionMeta.current = detection;

    // Normalize to 0..1
    const norm = corners.map((p) => ({ x: p.x / dw, y: p.y / dh })) as
      [Point, Point, Point, Point];

    // Stronger smoothing — slower lock-in, more reliable corners
    const smoothed = emaQuad(smoothQuad.current, norm, 0.22);
    smoothQuad.current = smoothed;

    const last = lastRawQuad.current;
    lastRawQuad.current = norm;
    const delta = last ? maxCornerDelta(norm, last) : 1;

    if (delta < STABLE_DELTA) stableCount.current++;
    else stableCount.current = Math.max(0, stableCount.current - 3);

    // Wait for enough consecutive detections before showing anything as "found".
    if (detectCount.current < DETECT_FRAMES) {
      drawOverlay(smoothed, false);
      setStatus("searching");
      return;
    }

    if (stableCount.current < HOLD_FRAMES) {
      drawOverlay(smoothed, false);
      setStatus("align");
    } else if (stableCount.current < READY_FRAMES) {
      drawOverlay(smoothed, false);
      setStatus("hold");
    } else if (stableCount.current < STABLE_FRAMES) {
      drawOverlay(smoothed, true);
      setStatus("ready");
    } else {
      drawOverlay(smoothed, true);
      setStatus("capturing");
      capture(smoothed);
    }
  }


  function drawOverlay(
    quad: [Point, Point, Point, Point] | null,
    active: boolean,
  ) {
    const svg = svgRef.current;
    const poly = polyRef.current;
    if (!svg || !poly) return;

    if (!quad) {
      poly.setAttribute("points", "");
      poly.style.opacity = "0";
      cornerRefs.current.forEach((c) => c && (c.style.opacity = "0"));
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = rect.width;
    const h = rect.height;
    if (svg.getAttribute("viewBox") !== `0 0 ${w} ${h}`) {
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }

    // Account for object-fit: cover scaling between video and container
    const video = videoRef.current!;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(w / vw, h / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;
    const offX = (w - dispW) / 2;
    const offY = (h - dispH) / 2;

    const pts = quad
      .map((p) => `${offX + p.x * dispW},${offY + p.y * dispH}`)
      .join(" ");
    poly.setAttribute("points", pts);
    poly.style.opacity = "1";
    poly.setAttribute("stroke", active ? "var(--success)" : "rgba(255,255,255,0.95)");
    poly.setAttribute("fill", active ? "color-mix(in oklab, var(--success) 18%, transparent)" : "rgba(255,255,255,0.06)");

    quad.forEach((p, i) => {
      const c = cornerRefs.current[i];
      if (!c) return;
      c.setAttribute("cx", String(offX + p.x * dispW));
      c.setAttribute("cy", String(offY + p.y * dispH));
      c.setAttribute("fill", active ? "var(--success)" : "white");
      c.style.opacity = "1";
    });
  }

  async function capture(normQuad: [Point, Point, Point, Point]) {
    if (capturedRef.current) return;
    capturedRef.current = true;
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Convert normalized corners to source pixel coordinates
    const srcQuad = normQuad.map((p) => ({
      x: p.x * vw,
      y: p.y * vh,
    })) as [Point, Point, Point, Point];

    // Output: portrait A4 aspect 1:√2
    const outW = 1000;
    const outH = Math.round(outW * Math.SQRT2);

    // Yield to UI so the "capturing" state renders
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const warped = warpQuadToRect(video, vw, vh, srcQuad, outW, outH);

    // Paper enhancement: normalize lighting and stretch whites so the
    // document looks like a clean scanned A4 (white paper, dark ink).
    enhancePaper(warped);

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = vw;
    sourceCanvas.height = vh;
    sourceCanvas.getContext("2d")!.drawImage(video, 0, 0, vw, vh);

    const dataUrl = warped.toDataURL("image/jpeg", 0.92);
    const sourceDataUrl = sourceCanvas.toDataURL("image/jpeg", 0.86);
    const meta = detectionMeta.current;
    scanStore.set({
      imageDataUrl: dataUrl,
      sourceDataUrl,
      detection: meta ? {
        corners: normQuad,
        a4Ratio: meta.a4Ratio,
        confidence: meta.confidence,
        debug: meta.debug,
      } : null,
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    navigate({ to: "/preview" });
  }

  function manualCapture() {
    // Require a detected document — never capture the raw camera frame,
    // otherwise the preview shows an un-cropped photo instead of a scan.
    const q = smoothQuad.current;
    if (!q || !detectionMeta.current || detectCount.current < DETECT_FRAMES) return;
    setStatus("capturing");
    capture(q);
  }


  const statusText: Record<Status, string> = {
    starting: "Startar kamera…",
    searching: "Sök efter dokument",
    uncertain: "Kunde inte identifiera dokumentets kanter tillräckligt säkert.",
    align: "Rikta in dokumentet",
    hold: "Håll stilla…",
    ready: "Dokument hittat",
    capturing: "Skannar och rätar upp…",
    error: "Fel",
  };

  const statusActive = status === "ready" || status === "capturing";

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col">
      <div ref={containerRef} className="absolute inset-0">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/25 pointer-events-none" />
        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
        >
          <polygon
            ref={polyRef}
            points=""
            strokeWidth={3}
            style={{ transition: "opacity 150ms, stroke 200ms, fill 200ms" }}
            strokeLinejoin="round"
          />
          {[0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              ref={(el) => {
                if (el) cornerRefs.current[i] = el;
              }}
              r={7}
              fill="white"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={1.5}
              style={{ opacity: 0, transition: "opacity 150ms, fill 200ms" }}
            />
          ))}
        </svg>
      </div>

      {/* Top bar */}
      <div className="relative pt-safe px-5 flex items-center justify-between">
        <button
          onClick={() => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            navigate({ to: "/" });
          }}
          className="h-10 w-10 rounded-full bg-black/55 backdrop-blur flex items-center justify-center"
          aria-label="Avbryt"
        >
          <X className="h-5 w-5" />
        </button>
        <div
          className={`px-4 py-2 rounded-full text-[13px] font-medium backdrop-blur transition ${
            statusActive
              ? "bg-success/90 text-success-foreground"
              : "bg-black/55 text-white"
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
          disabled={
            status === "starting" ||
            status === "error" ||
            status === "capturing" ||
            !smoothQuad.current ||
            !detectionMeta.current ||
            detectCount.current < DETECT_FRAMES
          }
          className="h-16 w-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 disabled:opacity-40"
          aria-label="Fotografera manuellt"
        >
          <Camera className="h-7 w-7" />
        </button>
        <p className="text-xs text-white/75 text-center max-w-[260px]">
          Lägg A4-dokumentet på en jämn, kontrasterande yta. Bilden tas automatiskt när hörnen är stabila.
        </p>

      </div>
    </div>
  );
}
