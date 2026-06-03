import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { scanStore } from "@/lib/scanStore";
import {
  detectDocumentQuad,
  MIN_DOCUMENT_CONFIDENCE,
  Point,
  emaQuad,
  enhancePaper,
  maxCornerDelta,
  warpQuadToRect,
} from "@/lib/perspective";
import { useT } from "@/lib/i18n";
import { Camera, CameraOff, X, RefreshCw, ArrowLeft } from "lucide-react";

type Status =
  | "starting"
  | "searching"
  | "uncertain"
  | "align"
  | "hold"
  | "ready"
  | "capturing"
  | "error";

type ErrorType = "permission_denied" | "not_found" | "unknown";

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Skanna dokument" }] }),
  component: ScanPage,
});

// Stability requirements — the document must be locked in on all 4 corners
// for a sustained period before the camera captures, so we never fire too early.
const STABLE_DELTA = 0.016; // normalized 0..1 — max smoothed corner movement to count as stable
const DETECT_FRAMES = 5; // consecutive detections before we even consider it found
const HOLD_FRAMES = 18; // ~0.6s — "Håll stilla" phase
const READY_FRAMES = 45; // ~1.5s — "Dokument hittat" lock-in
const STABLE_FRAMES = 75; // ~2.5s total before auto-capture

function ScanPage() {
  const t = useT();
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
  const [errorType, setErrorType] = useState<ErrorType | null>(null);

  const startCamera = useCallback(async () => {
    setStatus("starting");
    setError(null);
    setErrorType(null);

    // Try to read the current permission state. On browsers where this is
    // unsupported or limited (notably Safari/iOS), we fall through and just
    // call getUserMedia — which either resolves immediately (granted) or
    // shows the native prompt (first time).
    let knownState: PermissionState | null = null;
    try {
      // @ts-expect-error - "camera" is not in all TS lib versions
      const status = await navigator.permissions?.query?.({ name: "camera" });
      if (status?.state === "granted" || status?.state === "denied" || status?.state === "prompt") {
        knownState = status.state;
      }
    } catch {
      // Permissions API not available or doesn't support "camera" — ignore
      // and rely on getUserMedia. Never treat this as "denied".
    }

    // If we *know* permission is denied, skip the getUserMedia call which
    // would otherwise re-trigger nothing on iOS and silently fail.
    if (knownState === "denied") {
      setErrorType("permission_denied");
      setError(t("errPermissionDenied"));
      setStatus("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("searching");
      loop();
    } catch (e) {
      console.error(`[scan] camera error: ${(e as Error)?.name ?? "unknown"}`);
      const err = e as Error;
      if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setErrorType("not_found");
        setError(t("errNotFound"));
      } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        // Could be a real denial OR a dismissed prompt on Safari/iOS.
        // Re-check Permissions API: only show "denied" if we can confirm it.
        // If state is still "prompt" (user dismissed), stay in a recoverable
        // error state instead of falsely accusing them of blocking the camera.
        let confirmed: PermissionState | null = null;
        try {
          // @ts-expect-error - "camera" is not in all TS lib versions
          const status = await navigator.permissions?.query?.({ name: "camera" });
          if (status?.state) confirmed = status.state as PermissionState;
        } catch {
          // ignore
        }
        if (confirmed === "prompt") {
          // User dismissed the prompt — not a hard denial. Allow retry.
          setErrorType("unknown");
          setError(t("errUnknown"));
        } else {
          setErrorType("permission_denied");
          setError(t("errPermissionDenied"));
        }
      } else {
        setErrorType("unknown");
        setError(t("errUnknown"));
      }
      setStatus("error");
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    startCamera();
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
    const norm = corners.map((p) => ({ x: p.x / dw, y: p.y / dh })) as [Point, Point, Point, Point];

    // Stronger smoothing — slower lock-in, more reliable corners
    const previousSmooth = smoothQuad.current;
    const smoothed = emaQuad(smoothQuad.current, norm, 0.22);
    smoothQuad.current = smoothed;

    const last = lastRawQuad.current;
    lastRawQuad.current = norm;
    const delta = previousSmooth
      ? maxCornerDelta(smoothed, previousSmooth)
      : last
        ? maxCornerDelta(norm, last)
        : 1;

    if (delta < STABLE_DELTA) stableCount.current++;
    else stableCount.current = Math.max(0, stableCount.current - 1);

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

  function drawOverlay(quad: [Point, Point, Point, Point] | null, active: boolean) {
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

    const pts = quad.map((p) => `${offX + p.x * dispW},${offY + p.y * dispH}`).join(" ");
    poly.setAttribute("points", pts);
    poly.style.opacity = "1";
    poly.setAttribute("stroke", active ? "var(--success)" : "rgba(255,255,255,0.95)");
    poly.setAttribute(
      "fill",
      active ? "color-mix(in oklab, var(--success) 18%, transparent)" : "rgba(255,255,255,0.06)",
    );

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
    const meta = detectionMeta.current;
    if (!meta || meta.confidence < MIN_DOCUMENT_CONFIDENCE) {
      stableCount.current = 0;
      setStatus("uncertain");
      return;
    }
    capturedRef.current = true;
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Inset corners ~1.8% toward centroid as a safety margin so background,
    // bordskanter eller skuggor utanför pappret aldrig läcker in i resultatet.
    const cx = (normQuad[0].x + normQuad[1].x + normQuad[2].x + normQuad[3].x) / 4;
    const cy = (normQuad[0].y + normQuad[1].y + normQuad[2].y + normQuad[3].y) / 4;
    const INSET = 0.018;
    const inset = normQuad.map((p) => ({
      x: p.x + (cx - p.x) * INSET,
      y: p.y + (cy - p.y) * INSET,
    })) as [Point, Point, Point, Point];

    // Convert insatta hörn till källans pixelkoordinater
    const srcQuad = inset.map((p) => ({
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
    scanStore.set({
      imageDataUrl: dataUrl,
      sourceDataUrl,
      detection: {
        corners: normQuad,
        a4Ratio: meta.a4Ratio,
        confidence: meta.confidence,
        debug: meta.debug,
      },
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    navigate({ to: "/preview" });
  }

  function manualCapture() {
    // Require a detected document — never capture the raw camera frame,
    // otherwise the preview shows an un-cropped photo instead of a scan.
    const q = smoothQuad.current;
    if (
      !q ||
      !detectionMeta.current ||
      detectionMeta.current.confidence < MIN_DOCUMENT_CONFIDENCE ||
      detectCount.current < DETECT_FRAMES
    )
      return;
    setStatus("capturing");
    capture(q);
  }

  const statusText: Record<Status, string> = {
    starting: t("statusStarting"),
    searching: t("statusSearching"),
    uncertain: t("statusUncertain"),
    align: t("statusAlign"),
    hold: t("statusHold"),
    ready: t("statusReady"),
    capturing: t("statusCapturing"),
    error: t("statusError"),
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
          aria-label={t("cancel")}
        >
          <X className="h-5 w-5" />
        </button>
        <div
          className={`px-4 py-2 rounded-full text-[13px] font-medium backdrop-blur transition ${
            statusActive ? "bg-success/90 text-success-foreground" : "bg-black/55 text-white"
          }`}
        >
          {statusText[status]}
        </div>
        <div className="w-10" />
      </div>

      <div className="flex-1" />

      {/* Bottom hint / manual capture */}
      <div className="relative pb-safe px-5 pt-4 flex flex-col items-center gap-3">
        {error && status !== "error" && <p className="text-center text-sm text-red-200 max-w-xs">{error}</p>}
        <button
          onClick={manualCapture}
          disabled={
            status === "starting" ||
            status === "error" ||
            status === "capturing" ||
            !smoothQuad.current ||
            !detectionMeta.current ||
            detectionMeta.current.confidence < MIN_DOCUMENT_CONFIDENCE ||
            detectCount.current < DETECT_FRAMES
          }
          className="h-16 w-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 disabled:opacity-40"
          aria-label={t("manualCapture")}
        >
          <Camera className="h-7 w-7" />
        </button>
        <p className="text-xs text-white/75 text-center max-w-[260px]">
          {t("scanHint")}
        </p>
      </div>

      {/* Permission / error overlay */}
      {status === "error" && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm px-6">
          <div className="flex flex-col items-center text-center max-w-sm gap-5">
            <div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center">
              <CameraOff className="h-8 w-8 text-white/90" strokeWidth={1.5} />
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-white tracking-tight">
                {errorType === "permission_denied"
                  ? t("errPermissionTitle")
                  : errorType === "not_found"
                    ? t("errNotFoundTitle")
                    : t("errUnknownTitle")}
              </h2>
              <p className="text-[15px] text-white/70 leading-relaxed">
                {errorType === "permission_denied"
                  ? t("errPermissionDesc")
                  : error}
              </p>
            </div>

            {errorType === "permission_denied" && (
              <div className="w-full rounded-xl bg-white/8 border border-white/10 p-4 text-left">
                <p className="text-[13px] font-medium text-white/90 mb-2">{t("howToEnable")}</p>
                <PlatformInstructions />
              </div>
            )}

            <div className="flex flex-col w-full gap-3 mt-1">
              {errorType === "permission_denied" && (
                <button
                  onClick={startCamera}
                  className="w-full rounded-xl bg-white text-black py-3.5 px-4 font-semibold text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2} />
                  {t("retry")}
                </button>
              )}
              <button
                onClick={() => {
                  streamRef.current?.getTracks().forEach((tr) => tr.stop());
                  navigate({ to: "/" });
                }}
                className="w-full rounded-xl bg-white/10 text-white py-3.5 px-4 font-medium text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                {t("backHome")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformInstructions() {
  const t = useT();
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  const renderStep = (key: string) => {
    const raw = t(key);
    const parts = raw.split(/(\{b\}.*?\{\/b\})/g);
    return (
      <>
        {parts.map((p, i) =>
          p.startsWith("{b}") ? (
            <strong key={i} className="text-white/85">
              {p.slice(3, -4)}
            </strong>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </>
    );
  };

  const keys = isIOS
    ? ["iosStep1", "iosStep2", "iosStep3", "iosStep4", "iosStep5"]
    : isAndroid
      ? ["andStep1", "andStep2", "andStep3", "andStep4"]
      : ["genStep1", "genStep2", "genStep3", "genStep4", "genStep5"];

  return (
    <ol className="text-[13px] text-white/65 leading-relaxed list-decimal list-inside space-y-1">
      {keys.map((k) => (
        <li key={k}>{renderStep(k)}</li>
      ))}
    </ol>
  );
}
