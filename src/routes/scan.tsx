import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { scanStore } from "@/lib/scanStore";
import {
  autoOrientAndDeskewDocument,
  canvasLaplacianVariance,
  cleanPaperEdges,
  detectDocumentQuad,
  laplacianVariance,
  MIN_DOCUMENT_CONFIDENCE,
  MIN_EDGE_TIGHTNESS_FOR_CAPTURE,
  measureQuadGeometry,
  orderQuad,
  Point,
  emaQuad,
  enhancePaper,
  maxCornerDelta,
  warpQuadToRect,
} from "@/lib/perspective";
import type { DocumentAlignmentDiagnostics } from "@/lib/perspective";
import { useT } from "@/lib/i18n";
import { Camera, CameraOff, X, RefreshCw, ArrowLeft, ArrowRight } from "lucide-react";

type Status =
  | "starting"
  | "searching"
  | "uncertain"
  | "align"
  | "hold"
  | "focusing"
  | "moveBack"
  | "lowLight"
  | "ready"
  | "capturing"
  | "saved"
  | "error";

type ErrorType =
  | "permission_denied"
  | "not_found"
  | "iframe_blocked"
  | "insecure_context"
  | "unknown";

function isInIframe() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Skanna dokument" }] }),
  component: ScanPage,
});

// Stability requirements — the document must be locked in on all 4 corners
// for a sustained period before the camera captures, so we never fire too early.
// STABLE_DELTA är medvetet tillåtande: små handrörelser (några pixlar i 280px
// detekteringsramen) ska inte bryta stabiliteten — skärpe- och ljusgrindarna
// nedan ser till att kvaliteten ändå hålls hög.
const STABLE_DELTA = 0.035; // normalized 0..1 — tål små handvibrationer
const DETECT_FRAMES = 3; // mjukare intro innan ramen visas
const HOLD_FRAMES = 9; // ~0.3s — "Håll stilla" phase
const READY_FRAMES = 20; // ~0.65s — "Dokument hittat" lock-in
const STABLE_FRAMES = 32; // ~1.05s total before auto-capture
// Adaptive smoothing — mjukare och mindre ryckig rörelse på ramen.
// Lägre alpha = långsammare följning = lugnare upplevelse.
const ALPHA_PRE_LOCK = 0.18;
const ALPHA_POST_LOCK = 0.07;
const OUTLIER_DELTA = 0.13; // raw frames further than this from smoothed are rejected
const LOCK_BREAK_DELTA = 0.2; // sustained delta this large breaks the lock and re-detects
// Sharpness gates — Laplacian variance computed on a 280px detect frame
// (in-camera) and the warped doc (post-capture). Tuned conservatively så
// en suddig sida aldrig sparas, oavsett hur snabbt användaren rör mobilen.
const SHARPNESS_LIVE_MIN = 35;
const SHARPNESS_CAPTURE_MIN = 80;
const BLUR_HINT_FRAMES = 75; // ~2.5s of blur before suggesting "move back"
// Lighting gate — mean luminance below this is "too dark to scan reliably"
const BRIGHTNESS_MIN = 55;
// A4 ratio gate at capture — ett A4 som fotograferas snett kan få en
// projicerad proportion långt från sqrt(2). Vi accepterar generös perspektiv-
// skevhet här eftersom warp-steget rätar upp dokumentet ändå; den verkliga
// kvalitetskontrollen är skärpa + ljus + post-capture Laplacian.
const A4_RATIO_TOLERANCE = 0.6;

type StartCameraOptions = {
  restartStream?: boolean;
  skipPermissionPreflight?: boolean;
};

function ScanPage() {
  const t = useT();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const polyRef = useRef<SVGPolygonElement | null>(null);
  const glowRef = useRef<SVGPolygonElement | null>(null);
  const tracePolyRef = useRef<SVGPolygonElement | null>(null);
  const cornerRefs = useRef<SVGCircleElement[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectCanvas = useRef<HTMLCanvasElement | null>(null);
  // Throttle detection to ~22 Hz. The full pipeline (Canny + Sobel + snap)
  // is too heavy to run at 60 fps on mid-range mobile — it starves the UI
  // thread and the camera's continuous autofocus callback, which actually
  // makes captures BLURRIER. ~45 ms cadence keeps the polygon feeling live
  // while giving the GPU/ISP room to breathe.
  const DETECT_INTERVAL_MS = 45;
  const lastDetectAtRef = useRef(0);

  const lastRawQuad = useRef<[Point, Point, Point, Point] | null>(null);
  const smoothQuad = useRef<[Point, Point, Point, Point] | null>(null); // normalized 0..1
  const detectionMeta = useRef<ReturnType<typeof detectDocumentQuad> | null>(null);
  const stableCount = useRef(0);
  const detectCount = useRef(0);
  const missCount = useRef(0);
  const capturedRef = useRef(false);
  const sharpnessRef = useRef(0);
  const blurFramesRef = useRef(0);
  const captureRetryRef = useRef(0);
  const lockedRef = useRef(false);
  const lockBreakFramesRef = useRef(0);
  const brightnessRef = useRef(255);
  const lowLightFramesRef = useRef(0);

  const [status, setStatus] = useState<Status>("starting");
  const [progress, setProgress] = useState(0); // 0..1 — visual lock-in progress
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ErrorType | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [pageCount, setPageCount] = useState(() => scanStore.get().pages.length);
  const [lastThumbnail, setLastThumbnail] = useState<string | null>(
    () => scanStore.get().imageDataUrl ?? null,
  );
  const [savedOverlay, setSavedOverlay] = useState<{
    dataUrl: string;
    visible: boolean;
  } | null>(null);
  const savedTimer1Ref = useRef<number | null>(null);
  const savedTimer2Ref = useRef<number | null>(null);
  const savedTimer3Ref = useRef<number | null>(null);
  const [debugInfo, setDebugInfo] = useState<{
    vw: number;
    vh: number;
    dpr: number;
    ready: boolean;
    lastCapture: number | null;
  }>({ vw: 0, vh: 0, dpr: 1, ready: false, lastCapture: null });
  const debugEnabled =
    typeof window !== "undefined" && /[?&]debug=1\b/.test(window.location.search);
  const cancelledRef = useRef(false);

  const startCamera = useCallback(
    async (options: StartCameraOptions = {}) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (options.restartStream || streamRef.current) {
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
      }
      capturedRef.current = false;
      sharpnessRef.current = 0;
      blurFramesRef.current = 0;
      captureRetryRef.current = 0;
      lockedRef.current = false;
      lockBreakFramesRef.current = 0;
      brightnessRef.current = 255;
      lowLightFramesRef.current = 0;
      stableCount.current = 0;
      detectCount.current = 0;
      missCount.current = 0;
      smoothQuad.current = null;
      lastRawQuad.current = null;
      detectionMeta.current = null;
      setProgress(0);
      setCameraReady(false);
      drawOverlay(null, "search");
      setStatus("starting");
      setError(null);
      setErrorType(null);

      // Secure context check — getUserMedia only works on HTTPS/localhost.
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setErrorType("insecure_context");
        setError(t("errUnknown"));
        setStatus("error");
        return;
      }

      // getUserMedia is not available at all (older browsers, restricted contexts).
      if (!navigator.mediaDevices?.getUserMedia) {
        // In an iframe without allow="camera" Chrome strips mediaDevices entirely.
        setErrorType(isInIframe() ? "iframe_blocked" : "unknown");
        setError(t("errUnknown"));
        setStatus("error");
        return;
      }

      // Try to read the current permission state. On browsers where this is
      // unsupported or limited (notably Safari/iOS), we fall through and just
      // call getUserMedia — which either resolves immediately (granted) or
      // shows the native prompt (first time).
      let knownState: PermissionState | null = null;
      if (!options.skipPermissionPreflight) {
        try {
          const status = await navigator.permissions?.query?.({ name: "camera" as PermissionName });
          if (
            status?.state === "granted" ||
            status?.state === "denied" ||
            status?.state === "prompt"
          ) {
            knownState = status.state;
          }
        } catch {
          // ignore
        }
      }

      if (cancelledRef.current) return;

      if (knownState === "denied") {
        setErrorType("permission_denied");
        setError(t("errPermissionDenied"));
        setStatus("error");
        return;
      }

      try {
        // Race getUserMedia against a 15s timeout — on iOS Safari the promise
        // can hang indefinitely if the user dismisses the permission prompt
        // without choosing. Without a timeout the UI is stuck on "starting".
        const gumPromise = navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            // @ts-expect-error — non-standard but honored on iOS/Android
            focusMode: "continuous",
          },
          audio: false,
        });
        const stream = await Promise.race([
          gumPromise,
          new Promise<MediaStream>((_, reject) =>
            setTimeout(
              () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
              15000,
            ),
          ),
        ]);
        // If the user navigated away while getUserMedia was pending, immediately
        // shut down the stream so the camera light never lingers.
        if (cancelledRef.current) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        // Try to lock the rear camera into continuous autofocus and request
        // the highest resolution the device will give us. These constraints
        // are non-standard but honored by mobile Safari/Chrome — failing here
        // is fine, we fall back to the default focus behavior.
        try {
          const track = stream.getVideoTracks()[0];
          const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
          const advanced: MediaTrackConstraintSet[] = [];
          if (Array.isArray(caps.focusMode) && (caps.focusMode as string[]).includes("continuous")) {
            advanced.push({ focusMode: "continuous" } as MediaTrackConstraintSet);
          }
          if (Array.isArray(caps.exposureMode) && (caps.exposureMode as string[]).includes("continuous")) {
            advanced.push({ exposureMode: "continuous" } as MediaTrackConstraintSet);
          }
          if (Array.isArray(caps.whiteBalanceMode) && (caps.whiteBalanceMode as string[]).includes("continuous")) {
            advanced.push({ whiteBalanceMode: "continuous" } as MediaTrackConstraintSet);
          }
          if (advanced.length) {
            await track.applyConstraints({ advanced }).catch(() => {});
          }
        } catch {
          // ignore — camera will still work with defaults
        }
        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          // Wait for the video to actually have frame data before allowing
          // detection / capture. Without this, the first ticks of the RAF
          // loop hit a 0x0 video and we draw a blank canvas.
          const waitReady = new Promise<void>((resolve) => {
            if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
              resolve();
              return;
            }
            const onReady = () => {
              if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
                videoEl.removeEventListener("loadedmetadata", onReady);
                videoEl.removeEventListener("canplay", onReady);
                resolve();
              }
            };
            videoEl.addEventListener("loadedmetadata", onReady);
            videoEl.addEventListener("canplay", onReady);
          });
          try {
            await videoEl.play();
          } catch {
            // iOS Safari can reject play() if the gesture context was lost.
          }
          // Race readiness against a short timeout — if metadata never arrives
          // we still let detect() bail safely on its own readyState check.
          await Promise.race([waitReady, new Promise<void>((r) => setTimeout(r, 4000))]);
          if (cancelledRef.current) {
            stream.getTracks().forEach((tr) => tr.stop());
            streamRef.current = null;
            return;
          }
          setCameraReady(videoEl.videoWidth > 0 && videoEl.videoHeight > 0);
        }
        if (cancelledRef.current) {
          stream.getTracks().forEach((tr) => tr.stop());
          streamRef.current = null;
          return;
        }
        setStatus("searching");
        loop();
      } catch (e) {
        if (cancelledRef.current) return;
        console.error(`[scan] camera error: ${(e as Error)?.name ?? "unknown"}`);
        const err = e as Error;
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setErrorType("not_found");
          setError(t("errNotFound"));
        } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          // In a sandboxed iframe without allow="camera", Chrome rejects with
          // NotAllowedError immediately and never shows a prompt. Detect that
          // case so we can surface a useful "open in new tab" path instead of
          // accusing the user of having denied permission they never saw.
          if (isInIframe()) {
            setErrorType("iframe_blocked");
            setError(t("errUnknown"));
          } else {
            let confirmed: PermissionState | null = null;
            try {
              const status = await navigator.permissions?.query?.({
                name: "camera" as PermissionName,
              });
              if (status?.state) confirmed = status.state as PermissionState;
            } catch {
              // ignore
            }
            if (confirmed === "prompt") {
              setErrorType("unknown");
              setError(t("errUnknown"));
            } else {
              setErrorType("permission_denied");
              setError(t("errPermissionDenied"));
            }
          }
        } else {
          setErrorType("unknown");
          setError(t("errUnknown"));
        }
        setStatus("error");
      }
    },
    [t],
  );

  useEffect(() => {
    cancelledRef.current = false;
    startCamera();
    return () => {
      cancelledRef.current = true;
      capturedRef.current = true; // stop RAF loop
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loop() {
    const tick = () => {
      const now = performance.now();
      if (now - lastDetectAtRef.current >= DETECT_INTERVAL_MS) {
        lastDetectAtRef.current = now;
        detect();
      }
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
    const dw = 280;
    const dh = Math.round((vh / vw) * dw);

    if (dc.width !== dw || dc.height !== dh) {
      dc.width = dw;
      dc.height = dh;
    }
    const ctx = dc.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, dw, dh);
    const { data } = ctx.getImageData(0, 0, dw, dh);

    // Cheap mean luminance over a center sample — drives the low-light gate.
    let lumSum = 0;
    let lumCount = 0;
    const sampleStep = 8;
    for (let y = Math.floor(dh * 0.15); y < dh * 0.85; y += sampleStep) {
      for (let x = Math.floor(dw * 0.15); x < dw * 0.85; x += sampleStep) {
        const i = (y * dw + x) * 4;
        lumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lumCount++;
      }
    }
    const meanLum = lumCount ? lumSum / lumCount : 255;
    brightnessRef.current = meanLum;
    const isBrightEnough = meanLum >= BRIGHTNESS_MIN;
    if (!isBrightEnough) lowLightFramesRef.current++;
    else lowLightFramesRef.current = Math.max(0, lowLightFramesRef.current - 2);

    const detection = detectDocumentQuad(data, dw, dh);
    const corners = detection?.corners ?? null;

    if (!corners) {
      stableCount.current = 0;
      detectCount.current = Math.max(0, detectCount.current - 1);
      detectionMeta.current = null;
      missCount.current++;
      lockedRef.current = false;
      lockBreakFramesRef.current = 0;
      if (detectCount.current === 0) {
        smoothQuad.current = null;
        lastRawQuad.current = null;
        drawOverlay(null, "search");
        setProgress(0);
      }
      setStatus((s) =>
        s === "starting"
          ? s
          : lowLightFramesRef.current > 30
            ? "lowLight"
            : missCount.current > 45
              ? "uncertain"
              : "searching",
      );
      return;
    }

    detectCount.current++;
    missCount.current = 0;
    detectionMeta.current = detection;

    // Normalize to 0..1
    const norm = corners.map((p) => ({ x: p.x / dw, y: p.y / dh })) as [Point, Point, Point, Point];

    // Outlier rejection — if a raw frame jumped wildly from the smoothed
    // estimate, treat it as noise and skip the update. Prevents the polygon
    // from twitching when one frame detects a wrong contour.
    const previousSmooth = smoothQuad.current;
    let rawDeltaFromSmooth = 0;
    if (previousSmooth) {
      rawDeltaFromSmooth = maxCornerDelta(norm, previousSmooth);
      if (rawDeltaFromSmooth > OUTLIER_DELTA && rawDeltaFromSmooth < LOCK_BREAK_DELTA) {
        // mild outlier — keep current smooth, don't add to stability either
        drawOverlay(previousSmooth, lockedRef.current ? "ready" : "hold");
        return;
      }
      if (rawDeltaFromSmooth >= LOCK_BREAK_DELTA) {
        // large movement — break the lock and re-track
        lockBreakFramesRef.current++;
        if (lockBreakFramesRef.current > 3) {
          lockedRef.current = false;
          lockBreakFramesRef.current = 0;
          stableCount.current = 0;
        }
      } else {
        lockBreakFramesRef.current = 0;
      }
    }

    // Adaptive smoothing — gentler once locked, so the on-screen polygon
    // barely moves frame-to-frame.
    const alpha = lockedRef.current ? ALPHA_POST_LOCK : ALPHA_PRE_LOCK;
    const smoothed = emaQuad(smoothQuad.current, norm, alpha);
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

    // Measure sharpness within the detected quad. If the doc is too blurry
    // we must not auto-capture — wait for continuous autofocus to settle.
    // We shrink the bbox toward the centroid by 18% so the Laplacian sees
    // mostly paper interior (text strokes), not the background bleeding
    // in from the corners of an angled A4 — which used to make the score
    // jumpy and inflate the "moveBack" hint.
    const xs = smoothed.map((p) => p.x * dw);
    const ys = smoothed.map((p) => p.y * dh);
    const minSx = Math.min(...xs);
    const maxSx = Math.max(...xs);
    const minSy = Math.min(...ys);
    const maxSy = Math.max(...ys);
    const padX = (maxSx - minSx) * 0.09;
    const padY = (maxSy - minSy) * 0.09;
    const sharpness = laplacianVariance(data, dw, dh, {
      x0: minSx + padX,
      y0: minSy + padY,
      x1: maxSx - padX,
      y1: maxSy - padY,
    });
    sharpnessRef.current = sharpness;
    const isSharp = sharpness >= SHARPNESS_LIVE_MIN;
    if (!isSharp) {
      blurFramesRef.current++;
      stableCount.current = Math.min(stableCount.current, READY_FRAMES - 1);
    } else {
      blurFramesRef.current = 0;
    }
    if (!isBrightEnough) {
      stableCount.current = Math.min(stableCount.current, READY_FRAMES - 1);
    }

    // Engage lock once we've reached the READY threshold with good conditions.
    if (stableCount.current >= READY_FRAMES && isSharp && isBrightEnough) {
      lockedRef.current = true;
    }

    // Progress 0..1 — fills up as the document stays stable, hits 1.0 right before capture.
    const pct = Math.max(0, Math.min(1, stableCount.current / STABLE_FRAMES));
    setProgress(pct);

    if (detectCount.current < DETECT_FRAMES) {
      drawOverlay(smoothed, "search");
      setStatus("searching");
      return;
    }

    if (!isBrightEnough && lowLightFramesRef.current > 15) {
      drawOverlay(smoothed, "hold");
      setStatus("lowLight");
    } else if (stableCount.current < HOLD_FRAMES) {
      drawOverlay(smoothed, "hold");
      setStatus("align");
    } else if (!isSharp) {
      drawOverlay(smoothed, "hold");
      setStatus(blurFramesRef.current > BLUR_HINT_FRAMES ? "moveBack" : "focusing");
    } else if (stableCount.current < READY_FRAMES) {
      drawOverlay(smoothed, "hold");
      setStatus("hold");
    } else if (stableCount.current < STABLE_FRAMES) {
      drawOverlay(smoothed, "ready");
      setStatus("ready");
    } else {
      drawOverlay(smoothed, "ready");
      setStatus("capturing");
      capture(smoothed);
    }
  }

  function drawOverlay(
    quad: [Point, Point, Point, Point] | null,
    phase: "search" | "hold" | "ready",
  ) {
    const svg = svgRef.current;
    const poly = polyRef.current;
    const glow = glowRef.current;
    const trace = tracePolyRef.current;
    if (!svg || !poly) return;

    if (!quad) {
      poly.setAttribute("points", "");
      poly.style.opacity = "0";
      if (glow) {
        glow.setAttribute("points", "");
        glow.style.opacity = "0";
      }
      if (trace) {
        trace.setAttribute("points", "");
        trace.style.opacity = "0";
      }
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
    if (glow) {
      glow.setAttribute("points", pts);
    }
    if (trace) {
      trace.setAttribute("points", pts);
    }

    // Soft Genius Scan-style palette — always warm yellow, only intensity
    // and glow change across phases. Searching = subtle hint, hold = clear
    // yellow frame, ready = thicker glowing yellow with animated trace.
    const YELLOW = "rgb(255,193,7)"; // amber — warm, soft
    const YELLOW_SOFT = "rgb(255,214,90)";

    const stroke = phase === "search" ? YELLOW_SOFT : YELLOW;
    const fill =
      phase === "ready"
        ? "color-mix(in oklab, rgb(255,193,7) 14%, transparent)"
        : phase === "hold"
          ? "color-mix(in oklab, rgb(255,193,7) 9%, transparent)"
          : "color-mix(in oklab, rgb(255,214,90) 5%, transparent)";

    poly.setAttribute("stroke", stroke);
    poly.setAttribute("fill", fill);
    poly.setAttribute("stroke-width", phase === "ready" ? "4.5" : phase === "hold" ? "3.5" : "2.5");
    poly.style.opacity = phase === "search" ? "0.85" : "1";

    if (glow) {
      // Outer halo that pulses softer in search, intensifies on hold/ready.
      glow.setAttribute("stroke", YELLOW);
      glow.setAttribute("stroke-width", phase === "ready" ? "14" : phase === "hold" ? "10" : "6");
      glow.style.opacity =
        phase === "ready" ? "0.45" : phase === "hold" ? "0.28" : "0.15";
    }

    if (trace) {
      // Bright traveling segment along the perimeter when ready — gives the
      // "scanning sweep" feel of Genius Scan.
      trace.setAttribute("stroke", "rgb(255,224,130)");
      trace.setAttribute("stroke-width", "5");
      trace.style.opacity = phase === "ready" ? "1" : "0";
    }

    // Hide corner dots entirely — Genius Scan-style frame is corner-free.
    cornerRefs.current.forEach((c) => c && (c.style.opacity = "0"));
  }


  async function capture(normQuad: [Point, Point, Point, Point]) {
    if (capturedRef.current) return;
    const meta = detectionMeta.current;
    if (!meta || meta.confidence < MIN_DOCUMENT_CONFIDENCE) {
      stableCount.current = 0;
      lockedRef.current = false;
      setStatus("uncertain");
      return;
    }
    // Tight-edge gate: the polygon must actually be snapped onto real
    // document edges. Stops auto-capture from firing when the frame is
    // still floating a few cm off the paper (e.g. on a uniform floor).
    if (meta.debug.edgeTightness < MIN_EDGE_TIGHTNESS_FOR_CAPTURE) {
      stableCount.current = 0;
      lockedRef.current = false;
      setStatus("align");
      return;
    }
    // Final A4 ratio gate — reject quads whose proportions diverge too far
    // from sqrt(2). Manual capture from `manualCapture` bypasses this since
    // user intent is explicit.
    const ratio = meta.a4Ratio;
    const a4Diff = Math.min(
      Math.abs(ratio - Math.SQRT2),
      Math.abs(ratio - 1 / Math.SQRT2),
    );
    if (a4Diff > A4_RATIO_TOLERANCE) {
      stableCount.current = 0;
      lockedRef.current = false;
      setStatus("align");
      return;
    }
    const video = videoRef.current;
    // Hard guard: refuse to capture unless the video element actually has
    // a current frame with real dimensions. Prevents black/empty captures
    // on slow iOS Safari startup where the stream is attached but no
    // frame has been decoded yet.
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setStatus("searching");
      return;
    }
    capturedRef.current = true;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (debugEnabled) {
      setDebugInfo((d) => ({ ...d, vw, vh, ready: true, lastCapture: Date.now() }));
    }

    // Sortera alltid hörnen i exakt ordning TL, TR, BR, BL innan warp.
    const orderedNormQuad = orderQuad(normQuad);

    // Convert hörn till källans pixelkoordinater i samma ordning.
    const srcQuad = orderedNormQuad.map((p) => ({
      x: p.x * vw,
      y: p.y * vh,
    })) as [Point, Point, Point, Point];
    const geometry = measureQuadGeometry(srcQuad);

    // För A4 ska output-ytan vara dokumentets verkliga proportion, inte
    // kamerans/canvasens proportion. Själva innehållet mappas fortfarande från
    // de fyra verkliga hörnen i srcQuad.
    const aspect = geometry.height >= geometry.width ? Math.SQRT2 : 1 / Math.SQRT2;
    // 300 DPI A4 (210 mm × 297 mm) ≈ 2480 × 3508 px. Print-quality output
    // for contracts, signatures and small text.
    const outW = 2480;
    const outH = Math.round(outW * aspect);


    logScanStage("camera-frame", { width: vw, height: vh, readyState: video.readyState });
    logScanStage("detected-corners", {
      normalized: formatQuad(orderedNormQuad),
      sourcePixels: formatQuad(srcQuad),
      confidence: meta.confidence,
      detectionDebug: meta.debug,
    });
    logScanStage("document-angle-before-warp", geometry);

    // Yield to UI so the "capturing" state renders
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // Wrap warp + enhance in try/catch. If anything throws (degenerate quad,
    // OOM, canvas error) we MUST still hand the user a usable scan and
    // navigate them onward — otherwise capturedRef is locked, the stream
    // is dead, and the only escape is the back button → tillbaka till start.
    try {
      let warped = warpQuadToRect(video, vw, vh, srcQuad, outW, outH);
      logScanCanvas("after-perspective-transform", warped, debugEnabled);

      // Paper enhancement: normalize lighting and stretch whites so the
      // document looks like a clean scanned A4 (white paper, dark ink).
      let alignmentDiagnostics: DocumentAlignmentDiagnostics | null = null;
      try {
        enhancePaper(warped);
        cleanPaperEdges(warped);
        warped = autoOrientAndDeskewDocument(warped, (diagnostics) => {
          alignmentDiagnostics = diagnostics;
        });
        logScanStage("deskew", alignmentDiagnostics);
      } catch (e) {
        console.error("[scan] enhance/orient failed, using raw warp", e);
      }

      // Post-capture sharpness gate. If the warped doc is blurry we abandon
      // this capture and let auto-focus retry — better to wait a second
      // longer than to save an unreadable PDF page. Bail after a few retries
      // so the user is never stuck.
      const postSharpness = canvasLaplacianVariance(warped);
      logScanStage("post-capture-sharpness", {
        value: postSharpness,
        threshold: SHARPNESS_CAPTURE_MIN,
        retries: captureRetryRef.current,
      });
      if (postSharpness < SHARPNESS_CAPTURE_MIN && captureRetryRef.current < 3) {
        captureRetryRef.current++;
        capturedRef.current = false;
        stableCount.current = 0;
        blurFramesRef.current = BLUR_HINT_FRAMES + 1;
        setProgress(0);
        setStatus("focusing");
        return;
      }
      captureRetryRef.current = 0;

      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = vw;
      sourceCanvas.height = vh;
      sourceCanvas.getContext("2d")!.drawImage(video, 0, 0, vw, vh);

      const dataUrl = warped.toDataURL("image/jpeg", 0.95);
      const sourceDataUrl = sourceCanvas.toDataURL("image/jpeg", 0.9);

      logScanCanvas("final-image-to-pdf", warped, debugEnabled);
      logScanStage("pdf-input", {
        sameDataUrlUsedForPreviewAndPdf: true,
        imageWidth: warped.width,
        imageHeight: warped.height,
        dataUrlBytes: dataUrl.length,
      });
      const existing = scanStore.get().pages;
      const nextPages = [...existing, dataUrl];
      scanStore.set({
        imageDataUrl: dataUrl,
        sourceDataUrl,
        pages: nextPages,
        detection: {
          corners: orderedNormQuad,
          a4Ratio: meta.a4Ratio,
          confidence: meta.confidence,
          debug: meta.debug,
        },
      });
      finishPageCapture(dataUrl, nextPages.length);
    } catch (e) {
      console.error("[scan] capture warp failed, falling back to raw frame", e);
      // Reset the lock so captureRawFrame can take over.
      capturedRef.current = false;
      captureRawFrame();
    }
  }

  function manualCapture() {
    // Prefer a detected document quad for a clean perspective-corrected scan.
    const v = videoRef.current;
    if (!cameraReady || !v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
    const q = smoothQuad.current;
    const hasGoodDetection =
      q &&
      detectionMeta.current &&
      detectionMeta.current.confidence >= MIN_DOCUMENT_CONFIDENCE &&
      detectCount.current >= DETECT_FRAMES;
    if (hasGoodDetection && q) {
      setStatus("capturing");
      capture(q);
    } else {
      // Fallback: no document detected — capture the raw frame as-is so the
      // user is never stuck if detection fails (poor lighting, low contrast,
      // textured background, etc). User can crop manually on the preview.
      setStatus("capturing");
      captureRawFrame();
    }
  }

  function captureRawFrame() {
    if (capturedRef.current) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    capturedRef.current = true;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    canvas.getContext("2d")!.drawImage(video, 0, 0, vw, vh);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    // Use full-frame "quad" so downstream code has valid corners.
    const fullQuad: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const existing = scanStore.get().pages;
    const nextPages = [...existing, dataUrl];
    scanStore.set({
      imageDataUrl: dataUrl,
      sourceDataUrl: dataUrl,
      pages: nextPages,
      detection: {
        corners: fullQuad,
        a4Ratio: 1,
        confidence: 0,
        debug: {
          edgeThreshold: 0,
          threshold: 0,
          candidateCount: 0,
          a4Score: 0,
          edgeScore: 0,
          brightnessScore: 0,
          textScore: 0,
          areaRatio: 1,
          sideDeviation: 0,
          perspectiveError: 0,
          polygonFill: 1,
        },
      },
    });
    finishPageCapture(dataUrl, nextPages.length);
  }

  // After a successful capture: show the cropped A4 page full-screen with a
  // small "Sparar sida…" spinner, then softly fade it out and resume the
  // camera for the next page. No black flash, no preview detour.
  function finishPageCapture(dataUrl: string, count: number) {
    setPageCount(count);
    setLastThumbnail(dataUrl);

    // Reset detection state so auto-capture starts fresh for the next page.
    stableCount.current = 0;
    detectCount.current = 0;
    missCount.current = 0;
    smoothQuad.current = null;
    lastRawQuad.current = null;
    detectionMeta.current = null;
    blurFramesRef.current = 0;
    captureRetryRef.current = 0;
    sharpnessRef.current = 0;
    lockedRef.current = false;
    lockBreakFramesRef.current = 0;
    lowLightFramesRef.current = 0;
    setProgress(0);
    drawOverlay(null, "search");

    setStatus("saved");

    // Phase 1: present the captured A4 page full-screen with the spinner.
    if (savedTimer1Ref.current) window.clearTimeout(savedTimer1Ref.current);
    if (savedTimer2Ref.current) window.clearTimeout(savedTimer2Ref.current);
    if (savedTimer3Ref.current) window.clearTimeout(savedTimer3Ref.current);
    setSavedOverlay({ dataUrl, visible: true });

    // Phase 2 (~1800ms): start the soft fade-out of the page overlay.
    savedTimer1Ref.current = window.setTimeout(() => {
      if (cancelledRef.current) return;
      setSavedOverlay((s) => (s ? { ...s, visible: false } : s));
    }, 1800);

    // Phase 3 (~2400ms): overlay finished fading — resume detection loop.
    savedTimer2Ref.current = window.setTimeout(() => {
      if (cancelledRef.current) return;
      capturedRef.current = false;
      setStatus("searching");
      loop();
    }, 2400);

    // Phase 4 (~2800ms): unmount the overlay node entirely.
    savedTimer3Ref.current = window.setTimeout(() => {
      if (cancelledRef.current) return;
      setSavedOverlay(null);
    }, 2800);
  }


  function finishScanning() {
    if (savedTimer1Ref.current) window.clearTimeout(savedTimer1Ref.current);
    if (savedTimer2Ref.current) window.clearTimeout(savedTimer2Ref.current);
    if (savedTimer3Ref.current) window.clearTimeout(savedTimer3Ref.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    navigate({ to: "/preview" });
  }

  function startOverScan() {
    scanStore.clear();
    setLastThumbnail(null);
    setPageCount(0);
    setStatus("searching");
    startCamera({ restartStream: true });
  }
  // Suppress unused warning — kept for potential future re-entry point.
  void startOverScan;

  function cancelScan() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    navigate({ to: "/" });
  }

  const statusText: Record<Status, string> = {
    starting: t("statusStarting"),
    searching: t("statusSearching"),
    uncertain: t("statusUncertain"),
    align: t("statusAlign"),
    hold: t("statusHold"),
    focusing: t("statusFocusing"),
    moveBack: t("statusMoveBack"),
    lowLight: t("statusLowLight"),
    ready: t("statusReady"),
    capturing: t("statusCapturing"),
    saved: t("statusSaved"),
    error: t("statusError"),
  };

  const statusActive = status === "ready" || status === "capturing" || status === "saved";

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col">
      <div ref={containerRef} className="absolute inset-0">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          // iOS Safari ignores playsInline unless it's also a literal attribute.
          {...({ "webkit-playsinline": "true", "x-webkit-airplay": "deny" } as Record<
            string,
            string
          >)}
          disablePictureInPicture
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) {
              setCameraReady(true);
              if (debugEnabled) {
                setDebugInfo((d) => ({
                  ...d,
                  vw: v.videoWidth,
                  vh: v.videoHeight,
                  dpr: window.devicePixelRatio || 1,
                  ready: true,
                }));
              }
            }
          }}
          onCanPlay={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) setCameraReady(true);
          }}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20 pointer-events-none" />
        {/* Detected document frame — soft, Genius Scan-style yellow with
            outer glow and an animated trace when ready. */}
        <svg
          ref={svgRef}
          className="absolute inset-0 z-20 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
        >
          {/* Outer soft glow halo */}
          <polygon
            ref={glowRef}
            points=""
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{
              opacity: 0,
              filter: "blur(6px)",
              transition: "opacity 220ms ease, stroke-width 220ms ease",
            }}
          />
          {/* Main frame */}
          <polygon
            ref={polyRef}
            points=""
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{
              opacity: 0,
              transition:
                "opacity 200ms ease, stroke 240ms ease, fill 240ms ease, stroke-width 220ms ease",
            }}
          />
          {/* Animated traveling segment — only visible when ready */}
          <polygon
            ref={tracePolyRef}
            points=""
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="22 78"
            style={{
              opacity: 0,
              transition: "opacity 240ms ease",
              animation: "scan-trace 1.6s linear infinite",
              filter: "drop-shadow(0 0 6px rgba(255,200,60,0.85))",
            }}
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
          onClick={cancelScan}
          className="h-10 w-10 rounded-full bg-black/55 backdrop-blur flex items-center justify-center"
          aria-label={t("cancel")}
        >
          <X className="h-5 w-5" />
        </button>
        <div
          className={`px-4 py-2 rounded-full text-[13px] font-medium backdrop-blur transition tabular-nums ${
            statusActive ? "bg-success/90 text-success-foreground" : "bg-black/55 text-white"
          }`}
        >
          {statusText[status]}
          {progress > 0 && status !== "capturing" && (
            <span className="ml-2 opacity-80">{Math.round(progress * 100)}%</span>
          )}
        </div>
        <div className="w-10" />
      </div>

      <div className="flex-1" />

      {/* Bottom hint / manual capture / page thumbnail */}
      <div className="relative pb-safe px-5 pt-4 flex flex-col items-center gap-3">
        {error && status !== "error" && (
          <p className="text-center text-sm text-red-200 max-w-xs">{error}</p>
        )}
        <div className="w-full flex items-end justify-between gap-3">
          {/* Left: thumbnail of last scanned page + counter */}
          <div className="w-20 flex flex-col items-center gap-1">
            {lastThumbnail ? (
              <button
                onClick={finishScanning}
                className="relative rounded-md overflow-hidden border-2 border-white/70 bg-white shadow-lg active:scale-95 transition"
                style={{ width: 56, aspectRatio: "1 / 1.414" }}
                aria-label={t("doneButton")}
              >
                <img
                  src={lastThumbnail}
                  alt=""
                  className="block w-full h-full object-cover"
                />
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-success text-success-foreground text-[11px] font-bold flex items-center justify-center tabular-nums shadow">
                  {pageCount}
                </span>
              </button>
            ) : (
              <div style={{ width: 56 }} />
            )}
            {pageCount > 0 && (
              <span className="text-[10px] text-white/70 tabular-nums">
                {pageCount} {pageCount === 1 ? t("pageSingular") : t("pagePlural")}
              </span>
            )}
          </div>

          {/* Center: capture button */}
          <div className="relative h-20 w-20 flex items-center justify-center shrink-0">
            <svg
              className="absolute inset-0 h-full w-full -rotate-90 pointer-events-none"
              viewBox="0 0 80 80"
              aria-hidden="true"
            >
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="3"
              />
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="rgb(255,193,7)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 36}
                strokeDashoffset={2 * Math.PI * 36 * (1 - progress)}
                style={{ transition: "stroke-dashoffset 120ms linear, opacity 200ms" }}
                opacity={progress > 0 ? 1 : 0}
              />
            </svg>
            <button
              onClick={manualCapture}
              disabled={
                !cameraReady || status === "starting" || status === "error" || status === "capturing"
              }
              className="h-16 w-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 disabled:opacity-40"
              aria-label={t("manualCapture")}
            >
              <Camera className="h-7 w-7" />
            </button>
          </div>

          {/* Right: Klar button (only when pages exist) */}
          <div className="w-20 flex justify-center">
            {pageCount > 0 ? (
              <button
                onClick={finishScanning}
                className="rounded-full bg-success text-success-foreground px-4 py-2.5 text-[14px] font-semibold tracking-tight shadow-lg active:scale-95 transition flex items-center gap-1"
              >
                {t("doneButton")}
              </button>
            ) : (
              <div className="w-12" />
            )}
          </div>
        </div>
        <p className="text-xs text-white/75 text-center max-w-[260px]">
          {pageCount > 0 ? t("scanHintMulti") : t("scanHint")}
        </p>
      </div>

      {/* Saved-page overlay — shows captured A4 full-screen with a small
          spinner + "Sparar sida…", then softly fades to reveal the camera. */}
      {savedOverlay && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black"
          style={{
            opacity: savedOverlay.visible ? 1 : 0,
            transition: "opacity 380ms ease-out",
          }}
        >
          <img
            src={savedOverlay.dataUrl}
            alt=""
            className="max-w-full max-h-full object-contain shadow-2xl"
            style={{ aspectRatio: "1 / 1.414" }}
          />
          <div className="absolute inset-0 bg-black/35" />
          <div className="absolute flex flex-col items-center gap-3 text-white">
            <div
              className="h-10 w-10 rounded-full border-[3px] border-white/30 border-t-white animate-spin"
              aria-hidden="true"
            />
            <p className="text-[15px] font-medium tracking-tight tabular-nums">
              {t("savingPage")}
            </p>
            <p className="text-[12px] text-white/80 tabular-nums">
              {pageCount} {pageCount === 1 ? t("pageSingular") : t("pagePlural")}
            </p>
          </div>
        </div>
      )}

      {/* Debug overlay — enable with ?debug=1 in the URL */}
      {debugEnabled && (
        <div className="absolute top-16 left-3 z-40 rounded-lg bg-black/80 text-white text-[11px] font-mono leading-tight px-3 py-2 pointer-events-none space-y-0.5">
          <div>
            video: {debugInfo.vw}×{debugInfo.vh}
          </div>
          <div>readyState: {videoRef.current?.readyState ?? 0}</div>
          <div>
            dpr: {debugInfo.dpr || (typeof window !== "undefined" ? window.devicePixelRatio : 1)}
          </div>
          <div>cameraReady: {String(cameraReady)}</div>
          <div>status: {status}</div>
          <div>
            detect: {detectCount.current} / stable: {stableCount.current}
          </div>
          <div>conf: {detectionMeta.current?.confidence?.toFixed(2) ?? "—"}</div>
          <div>
            tight:{" "}
            {detectionMeta.current?.debug.edgeTightness?.toFixed(2) ?? "—"} /{" "}
            offset:{" "}
            {detectionMeta.current?.debug.meanEdgeOffset !== undefined
              ? detectionMeta.current.debug.meanEdgeOffset.toFixed(1) + "px"
              : "—"}
          </div>
          <div>
            edge: {detectionMeta.current?.debug.edgeScore?.toFixed(2) ?? "—"} /{" "}
            a4: {detectionMeta.current?.debug.a4Score?.toFixed(2) ?? "—"} /{" "}
            area: {detectionMeta.current?.debug.areaRatio?.toFixed(2) ?? "—"}
          </div>
          <div>
            gate:{" "}
            {detectionMeta.current
              ? detectionMeta.current.confidence >= MIN_DOCUMENT_CONFIDENCE &&
                detectionMeta.current.debug.edgeTightness >= MIN_EDGE_TIGHTNESS_FOR_CAPTURE
                ? "READY ✓"
                : "no — needs tighter edges"
              : "—"}
          </div>
          <div>
            lastCapture:{" "}
            {debugInfo.lastCapture ? new Date(debugInfo.lastCapture).toLocaleTimeString() : "—"}
          </div>
        </div>
      )}


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
                    : errorType === "iframe_blocked"
                      ? "Förhandsvisning blockerar kameran"
                      : errorType === "insecure_context"
                        ? "Osäker anslutning"
                        : t("errUnknownTitle")}
              </h2>
              <p className="text-[15px] text-white/70 leading-relaxed">
                {errorType === "permission_denied"
                  ? t("errPermissionDesc")
                  : errorType === "iframe_blocked"
                    ? "Appen körs i Lovables förhandsvisning (en iframe) som inte tillåter kameraåtkomst. Öppna appen i en egen flik så kan webbläsaren be om kamerabehörighet."
                    : errorType === "insecure_context"
                      ? "Kameran kräver HTTPS. Öppna appen via en säker (https://) adress."
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
              {errorType === "iframe_blocked" && (
                <button
                  onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
                  className="w-full rounded-xl bg-white text-black py-3.5 px-4 font-semibold text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
                >
                  Öppna i ny flik
                </button>
              )}
              {errorType === "permission_denied" && (
                <button
                  onClick={() =>
                    startCamera({ restartStream: true, skipPermissionPreflight: true })
                  }
                  className="w-full rounded-xl bg-white text-black py-3.5 px-4 font-semibold text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2} />
                  {t("retry")}
                </button>
              )}
              {errorType !== "permission_denied" && errorType !== "iframe_blocked" && (
                <button
                  onClick={() =>
                    startCamera({ restartStream: true, skipPermissionPreflight: true })
                  }
                  className="w-full rounded-xl bg-white text-black py-3.5 px-4 font-semibold text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2} />
                  {t("retry")}
                </button>
              )}
              <button
                onClick={cancelScan}
                className="w-full rounded-xl bg-white/10 text-white py-3.5 px-4 font-medium text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                {pageCount > 0 ? t("back") : t("backHome")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatQuad(quad: [Point, Point, Point, Point]) {
  return quad.map((p, i) => ({
    label: ["TL", "TR", "BR", "BL"][i],
    x: Number(p.x.toFixed(4)),
    y: Number(p.y.toFixed(4)),
  }));
}

function logScanStage(stage: string, payload: unknown) {
  // eslint-disable-next-line no-console
  console.log(`[scan:${stage}]`, payload);
}

function logScanCanvas(stage: string, canvas: HTMLCanvasElement, includeImage: boolean) {
  const payload: { width: number; height: number; dataUrl?: string } = {
    width: canvas.width,
    height: canvas.height,
  };
  if (includeImage) payload.dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  logScanStage(stage, payload);
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
