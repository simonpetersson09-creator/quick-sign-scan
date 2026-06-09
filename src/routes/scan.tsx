import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { scanStore } from "@/lib/scanStore";
import {
  canvasContrast,
  canvasLaplacianVariance,
  detectDocumentQuad,
  detectPaperByThreshold,
  getLastDetectDiagnostics,
  laplacianVariance,
  MIN_DOCUMENT_CONFIDENCE,
  MIN_EDGE_TIGHTNESS_FOR_CAPTURE,
  measureQuadGeometry,
  orderQuad,
  Point,
  emaQuad,
  maxCornerDelta,
  refineQuadCorners,
  computeHiResEdgeTightness,
  warpQuadToRect,
  autoOrientAndDeskewDocument,
  whitenBackground,
  boostInkContrast,
} from "@/lib/perspective";
import { useT } from "@/lib/i18n";
import { Camera, CameraOff, X, RefreshCw, ArrowLeft, ArrowRight, Zap, ZapOff, Settings } from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { isNative, openNativeSettings } from "@/lib/native-init";

function triggerCaptureHaptic() {
  Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate(30); } catch {}
    }
  });
}

type Status =
  | "starting"
  | "searching"
  | "uncertain"
  | "align"
  | "hold"
  | "focusing"
  | "moveBack"
  | "lowLight"
  | "tooFar"
  | "tooClose"
  | "tilt"
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

function isUsableImageDataUrl(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|jpg|png|webp);base64,/.test(value) &&
    value.length > 1024
  );
}

function canvasToSafeImageDataUrl(
  canvas: HTMLCanvasElement,
  quality = 0.82,
  maxLongEdge = 2200,
): string | null {
  const encode = (c: HTMLCanvasElement) => {
    try {
      const url = c.toDataURL("image/jpeg", quality);
      return isUsableImageDataUrl(url) ? url : null;
    } catch {
      return null;
    }
  };

  const direct = encode(canvas);
  if (direct) return direct;

  const longEdge = Math.max(canvas.width, canvas.height);
  if (!longEdge) return null;
  const scale = Math.min(1, maxLongEdge / longEdge);
  const fallback = document.createElement("canvas");
  fallback.width = Math.max(1, Math.round(canvas.width * scale));
  fallback.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = fallback.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, fallback.width, fallback.height);
  ctx.drawImage(canvas, 0, 0, fallback.width, fallback.height);
  return encode(fallback);
}

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
const HOLD_FRAMES = 7; // ~0.23s — "Håll stilla" phase
const READY_FRAMES = 14; // ~0.45s — "Dokument hittat" lock-in
const STABLE_FRAMES = 22; // ~0.72s total before auto-capture
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
const SHARPNESS_CAPTURE_MIN = 60;
const BLUR_HINT_FRAMES = 75; // ~2.5s of blur before suggesting "move back"
// Lighting gate — mean luminance below this is "too dark to scan reliably".
// Lowered from 55 to 38: detection itself is now tolerant of dim scenes
// (adaptive contrast stretch inside detectDocumentQuad), so we only flag
// genuinely very-low-light frames where the user really needs more light.
const BRIGHTNESS_MIN = 38;
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
  const router = useRouter();
  // Warm the /preview route bundle on mount so the dynamic import is already
  // cached when the user taps "Done". Without this, the bundle is fetched on
  // navigation — and if the dev server (or a flaky network) returns a 504 /
  // chunk-load error, the root errorComponent does a hard reload, which
  // wipes the in-memory scanStore and surfaces the empty preview state.
  useEffect(() => {
    router.preloadRoute({ to: "/preview" }).catch(() => {});
    router.preloadRoute({ to: "/place" }).catch(() => {});
  }, [router]);
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
  // Higher-resolution detection canvas — used for an opportunistic refinement
  // pass when the cheap 280px detection is borderline or near-lock. Improves
  // corner precision for documents that don't fill much of the frame.
  // Feature flag: multi-scale (520px) full detection pass. Disabled — the
  // extra detect destabilised lock. Kept off; not used.
  const ENABLE_HI_RES_DETECT = false;
  // Feature flag: gate the prefer-bias toward the previously smoothed quad.
  // Only bias the detector once we already have a confident, tight lock —
  // before that, search freely so we don't get stuck on a noisy contour.
  const ENABLE_PREFER_BIAS_GATE = true;
  const PREFER_BIAS_MIN_CONF = 0.55;
  const PREFER_BIAS_MIN_EDGE = 0.45;
  // Feature flag: live local corner refinement on the full-res video frame,
  // around the already-detected 280px quad. Never changes the quad shape,
  // only nudges each corner ±a few px toward the strongest local edge.
  const ENABLE_LIVE_CORNER_REFINE = false;
  const hiDetectCanvas = useRef<HTMLCanvasElement | null>(null);
  const lastRefineAtRef = useRef(0);
  const HI_DETECT_WIDTH = 520;
  const REFINE_COOLDOWN_MS = 140;
  // Feature flag: recompute edgeTightness directly from the full-res video
  // for the already-detected quad. Never changes the quad or its corners;
  // only swaps in a higher hi-res tightness value when it is strictly better
  // than the 280px-derived one. Goal: small/far documents whose edges are
  // perfectly sharp in the original video but undersampled in the 280px
  // detect frame can still pass capture-gates.
  const ENABLE_HIRES_TIGHTNESS_RECOMPUTE = true;
  const HIRES_TIGHT_COOLDOWN_MS = 140;
  const lastHiResTightAtRef = useRef(0);
  const lastHiResTightLogAtRef = useRef(0);
  // Feature flag: bump the detection frame width from the historical 280px
  // to give small/far A4 documents more pixels on the short side. Pure
  // resolution change — no algorithm/threshold changes, no multi-scale.
  // Set to false to instantly revert to the previous 280px behaviour if
  // we see regressions (false locks, slower frames, etc.).
  const ENABLE_DETECT_HIRES = true;
  const DETECT_WIDTH = ENABLE_DETECT_HIRES ? 360 : 280;
  // Feature flag: candidate-memory across recent frames. Cluster the last N
  // detections by corner similarity (+ areaRatio / a4Ratio) so an ambiguous
  // scene (multiple competing quads frame-to-frame) delays auto-capture
  // instead of locking onto whichever quad happened to win the last frame.
  // Never changes the warp pipeline, min-area, or which quad is drawn —
  // only gates `stableCount` when more than one candidate has real support.
  const ENABLE_CANDIDATE_MEMORY = true;
  const CANDIDATE_HISTORY_MAX = 15;
  const CANDIDATE_CLUSTER_DELTA = 0.05; // normalized corner distance
  const CANDIDATE_AREA_TOL = 0.18;
  const CANDIDATE_A4_TOL = 0.25;
  const CANDIDATE_AMBIGUITY_RATIO = 0.55; // 2nd cluster vs best
  // Feature flag: generous overlay detection. The live document frame is
  // allowed to display as soon as a candidate passes structural gates
  // (area / A4 ratio / perspective / sides / polygon-fill / not-touching-
  // frame). Auto-capture still requires the full strict pipeline
  // (edgeTightness, sharpness, brightness, stability, confidence, no
  // ambiguity). Goal: user sees that the document is found at longer
  // distance, but no photo is taken until quality is good.
  const ENABLE_GENEROUS_OVERLAY = true;
  const lastOverlayLogAtRef = useRef(0);
  // Throttle detection to ~22 Hz. The full pipeline (Canny + Sobel + snap)
  // is too heavy to run at 60 fps on mid-range mobile — it starves the UI
  // thread and the camera's continuous autofocus callback, which actually
  // makes captures BLURRIER. ~45 ms cadence keeps the polygon feeling live
  // while giving the GPU/ISP room to breathe.
  const DETECT_INTERVAL_MS = 45;
  const lastDetectAtRef = useRef(0);
  const lastRejectLogAtRef = useRef(0);
  const lastAdaptiveLogAtRef = useRef(0);
  const lastGateLogAtRef = useRef(0);
  // Capture-gate diagnostics — populated each frame the document frame is
  // visible. Lets the debug overlay show exactly which gate is blocking
  // auto-capture (stability, sharpness, light, motion, cooldown, edge,
  // confidence, ambiguity) without affecting any production behavior.
  const captureGateRef = useRef<{
    reason: string | null;
    stable: number;
    stableTarget: number;
    sharpness: number;
    sharpnessMin: number;
    brightness: number;
    brightnessMin: number;
    motionMag: number;
    motionAvail: boolean;
    confidence: number;
    edgeTightness: number;
    a4Diff: number;
    areaRatio: number;
    cooldownMs: number;
  } | null>(null);

  const lastRawQuad = useRef<[Point, Point, Point, Point] | null>(null);
  const smoothQuad = useRef<[Point, Point, Point, Point] | null>(null); // normalized 0..1
  // Multi-frame quad voting: stash the last N smoothed normalized quads. At
  // capture time we take the per-corner median across this window so a
  // single jittery frame can't pull the warp off the paper. Pure refinement —
  // never gates capture, only smooths the corners that get warped.
  const recentSmoothQuadsRef = useRef<Array<[Point, Point, Point, Point]>>([]);
  const QUAD_VOTE_WINDOW = 7;
  const detectionMeta = useRef<ReturnType<typeof detectDocumentQuad> | null>(null);
  type CandidateEntry = {
    norm: [Point, Point, Point, Point];
    conf: number;
    areaRatio: number;
    a4Ratio: number;
    edge: number;
    t: number;
  };
  const candidateHistoryRef = useRef<CandidateEntry[]>([]);
  const ambiguousFramesRef = useRef(0);
  const stableCount = useRef(0);
  const detectCount = useRef(0);
  const missCount = useRef(0);
  const capturedRef = useRef(false);
  const sharpnessRef = useRef(0);
  const blurFramesRef = useRef(0);
  const captureRetryRef = useRef(0);
  const tooFarFramesRef = useRef(0);
  const lockedRef = useRef(false);
  const lockBreakFramesRef = useRef(0);
  const brightnessRef = useRef(255);
  const lowLightFramesRef = useRef(0);
  const exposureLockedRef = useRef(false);
  const trackCapsRef = useRef<Record<string, unknown>>({});
  // Auto-capture is "armed" only after this timestamp — used to enforce a short
  // re-aim pause after a saved page so the camera doesn't immediately snap
  // the same document again.
  const armedAtRef = useRef(0);
  const REARM_DELAY_MS = 1200;
  // Gyro / motion stability — exponential moving average of |acceleration|
  // (gravity removed). Stays near 0 when the phone is held still; spikes on
  // jitter. Used as an extra gate before auto-capture so we never snap a
  // shaky frame even if the detected quad looks stable.
  const motionMagRef = useRef(0);
  const motionAvailableRef = useRef(false);
  const MOTION_STILL_THRESHOLD = 0.45; // m/s² — empirical, tolerates breathing
  // Document-targeted exposure metering. We periodically nudge the camera to
  // expose for the paper itself (point-of-interest on the quad centroid, plus
  // a brightness-driven exposureCompensation fallback) so a backlit window or
  // a dark desk doesn't pull metering off the page.
  const lastMeterAtRef = useRef(0);
  const docLumRef = useRef(0);
  const ecAppliedRef = useRef(0);
  const METER_INTERVAL_MS = 600;
  const METER_TARGET_LUM = 165;

  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const [status, setStatus] = useState<Status>("starting");
  const [progress, setProgress] = useState(0); // 0..1 — visual lock-in progress
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ErrorType | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [pageCount, setPageCount] = useState(() => scanStore.getPages().length);
  const [lastThumbnail, setLastThumbnail] = useState<string | null>(() => {
    const pages = scanStore.getPages();
    return scanStore.get().imageDataUrl ?? pages[pages.length - 1] ?? null;
  });
  const [savedOverlay, setSavedOverlay] = useState<{
    dataUrl: string;
    visible: boolean;
  } | null>(null);
  const [captureStage, setCaptureStage] = useState<{
    label: string;
    progress: number;
  } | null>(null);
  const stageTimerRef = useRef<number | null>(null);
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
  const cameraStartTokenRef = useRef(0);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // capability missing or denied — hide the button
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const stopCamera = useCallback((reason: string) => {
    const pages = scanStore.getPages();
    console.info("[scan] stopCamera called", {
      reason,
      pages: pages.length,
      hasImageDataUrl: Boolean(scanStore.get().imageDataUrl),
      tracks: streamRef.current?.getVideoTracks().length ?? 0,
    });
    streamRef.current?.getVideoTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const stopDetachedVideoStream = useCallback((stream: MediaStream, reason: string) => {
    console.info("[scan] stopCamera called", {
      reason,
      detached: true,
      pages: scanStore.getPages().length,
      tracks: stream.getVideoTracks().length,
    });
    stream.getVideoTracks().forEach((track) => track.stop());
  }, []);

  // Exposure lock: when the doc is "ready" lock exposure so brightness doesn't
  // shift in the milliseconds before capture. Release it as soon as we're no
  // longer ready so the next document gets a fresh metering.
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const caps = trackCapsRef.current as { exposureMode?: string[] };
    if (!Array.isArray(caps.exposureMode)) return;
    const shouldLock = status === "ready" || status === "capturing";
    if (shouldLock === exposureLockedRef.current) return;
    if (shouldLock && caps.exposureMode.includes("manual")) {
      track
        .applyConstraints({ advanced: [{ exposureMode: "manual" } as MediaTrackConstraintSet] })
        .then(() => { exposureLockedRef.current = true; })
        .catch(() => {});
    } else if (!shouldLock && caps.exposureMode.includes("continuous")) {
      track
        .applyConstraints({ advanced: [{ exposureMode: "continuous" } as MediaTrackConstraintSet] })
        .then(() => { exposureLockedRef.current = false; })
        .catch(() => {});
    }
  }, [status]);

  // Meter exposure toward the detected document. Throttled to METER_INTERVAL_MS
  // so we don't thrash the camera ISP. Uses pointsOfInterest when available;
  // also nudges exposureCompensation based on the measured paper luminance
  // (target ~165) so backlit pages get brightened and over-lit pages dimmed.
  function meterTowardsDoc(nx: number, ny: number, docLum: number) {
    if (lockedRef.current || exposureLockedRef.current) return;
    const now = performance.now();
    if (now - lastMeterAtRef.current < METER_INTERVAL_MS) return;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const caps = trackCapsRef.current as {
      pointsOfInterest?: unknown;
      exposureCompensation?: { min?: number; max?: number; step?: number };
    };
    const advanced: MediaTrackConstraintSet[] = [];
    if (caps.pointsOfInterest !== undefined) {
      advanced.push({
        pointsOfInterest: [{ x: nx, y: ny }],
      } as unknown as MediaTrackConstraintSet);
    }
    const ec = caps.exposureCompensation;
    if (ec && typeof ec.min === "number" && typeof ec.max === "number") {
      const step = Math.max(0.1, ec.step ?? 0.33);
      const diff = METER_TARGET_LUM - docLum;
      const magnitude = Math.min(Math.abs(diff) / 40, 1);
      const delta = Math.sign(diff) * magnitude * step * 2;
      const next = Math.max(ec.min, Math.min(ec.max, ecAppliedRef.current + delta));
      if (Math.abs(next - ecAppliedRef.current) >= step * 0.5) {
        ecAppliedRef.current = next;
        advanced.push({ exposureCompensation: next } as unknown as MediaTrackConstraintSet);
      }
    }
    if (!advanced.length) return;
    lastMeterAtRef.current = now;
    track.applyConstraints({ advanced }).catch(() => {});
  }




  const startCamera = useCallback(
    async (options: StartCameraOptions = {}) => {
      const startToken = ++cameraStartTokenRef.current;
      const isStaleStart = () => cancelledRef.current || startToken !== cameraStartTokenRef.current;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (options.restartStream || streamRef.current) stopCamera("restart-before-startCamera");
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

      if (isStaleStart()) return;

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
        if (isStaleStart()) {
          stopDetachedVideoStream(stream, "startCamera-cancelled-after-getUserMedia");
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
          trackCapsRef.current = caps;
          setTorchAvailable(Boolean((caps as { torch?: boolean }).torch));
          setTorchOn(false);
          exposureLockedRef.current = false;
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
          if (isStaleStart()) {
            stopDetachedVideoStream(stream, "startCamera-cancelled-after-video-ready");
            streamRef.current = null;
            return;
          }
          setCameraReady(videoEl.videoWidth > 0 && videoEl.videoHeight > 0);
        }
        if (isStaleStart()) {
          stopDetachedVideoStream(stream, "startCamera-cancelled-before-loop");
          streamRef.current = null;
          return;
        }
        setStatus("searching");
        loop();
      } catch (e) {
        if (isStaleStart()) return;
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
    [t, stopCamera, stopDetachedVideoStream],
  );

  useEffect(() => {
    cancelledRef.current = false;
    startCamera();

    // Listen to device motion as a stillness signal. iOS 13+ requires an
    // explicit permission request (gated behind a user gesture) — we ask
    // once on mount and silently fall back if denied; the scanner still
    // works without gyro data, just without this extra gate.
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration ?? e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
      motionAvailableRef.current = true;
      // EMA — heavy weight on history so brief spikes still register but
      // sustained calm wins quickly.
      motionMagRef.current = motionMagRef.current * 0.7 + mag * 0.3;
    };
    type IOSMotionEvent = typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const dme = (typeof DeviceMotionEvent !== "undefined"
      ? (DeviceMotionEvent as IOSMotionEvent)
      : null);
    if (dme?.requestPermission) {
      dme.requestPermission()
        .then((res) => {
          if (res === "granted") window.addEventListener("devicemotion", onMotion);
        })
        .catch(() => {});
    } else if (typeof window !== "undefined" && "DeviceMotionEvent" in window) {
      window.addEventListener("devicemotion", onMotion);
    }

    return () => {
      cancelledRef.current = true;
      capturedRef.current = true; // stop RAF loop
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopCamera("scan-unmount");
      window.removeEventListener("devicemotion", onMotion);
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
    const now = performance.now();

    if (!detectCanvas.current) detectCanvas.current = document.createElement("canvas");
    const dc = detectCanvas.current;
    const dw = DETECT_WIDTH;
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

    // Bias detection toward the previously-locked quad (in pixel coords) so
    // the frame doesn't hop between competing objects between rendered frames.
    // BUT: only after we already have a confident, tight lock — otherwise we
    // risk locking the detector onto a noisy/wrong contour from previous frames.
    const prevSmooth = smoothQuad.current;
    const prevMeta = detectionMeta.current;
    const prevConfidentEnough =
      !ENABLE_PREFER_BIAS_GATE ||
      (prevMeta !== null &&
        prevMeta.confidence >= PREFER_BIAS_MIN_CONF &&
        prevMeta.debug.edgeTightness >= PREFER_BIAS_MIN_EDGE);
    const preferQuad =
      prevSmooth && prevConfidentEnough
        ? (prevSmooth.map((p) => ({ x: p.x * dw, y: p.y * dh })) as [Point, Point, Point, Point])
        : undefined;
    let detection = detectDocumentQuad(data, dw, dh, { prefer: preferQuad, allowOverlay: ENABLE_GENEROUS_OVERLAY });
    // Separate live-detection (overlay) from capture-readiness. A detection
    // returned with readyForCapture=false has only passed structural gates
    // and is shown to coach the user — auto-capture must not fire.
    const detectedForOverlay = !!detection;
    const readyForCapture = !!detection && detection.readyForCapture !== false;
    const reasonNotReady = detection?.reasonNotReady;

    // Optional hi-res local corner refinement on the full video frame. Does
    // NOT run a new detection — only nudges already-detected corners toward
    // local edges. Cannot change the quad shape; clamped to ±a few px.
    if (
      ENABLE_LIVE_CORNER_REFINE &&
      detection &&
      now - lastRefineAtRef.current >= REFINE_COOLDOWN_MS
    ) {
      lastRefineAtRef.current = now;
      try {
        const sx = vw / dw;
        const sy = vh / dh;
        const quadFull = detection.corners.map((p) => ({
          x: p.x * sx,
          y: p.y * sy,
        })) as [Point, Point, Point, Point];
        const refinedFull = refineQuadCorners(video, vw, vh, quadFull);
        detection = {
          ...detection,
          corners: refinedFull.map((p) => ({
            x: p.x / sx,
            y: p.y / sy,
          })) as [Point, Point, Point, Point],
        };
      } catch {
        // ignore — keep original 280px corners
      }
    }

    // Hi-res edge-tightness recompute (Step B). Uses the EXISTING quad —
    // no new detection, no new corners. Measures how tight each side of
    // the (already-found) quad sits on a strong gradient in the full-res
    // video, then swaps in the hi-res value only if it is better. This
    // helps small/far A4 documents whose edges are sharp in 1920×1080 but
    // undersampled in the 280px detect frame.
    if (
      ENABLE_HIRES_TIGHTNESS_RECOMPUTE &&
      detection &&
      now - lastHiResTightAtRef.current >= HIRES_TIGHT_COOLDOWN_MS
    ) {
      lastHiResTightAtRef.current = now;
      try {
        const sx = vw / dw;
        const sy = vh / dh;
        const quadFull = detection.corners.map((p) => ({
          x: p.x * sx,
          y: p.y * sy,
        })) as [Point, Point, Point, Point];
        const hi = computeHiResEdgeTightness(video, vw, vh, quadFull);
        const origTight = detection.debug.edgeTightness ?? 0;
        if (hi && hi.tightness > origTight) {
          const wasBlockedByTightness =
            !detection.readyForCapture &&
            (detection.reasonNotReady === "edgeTightnessLow" ||
              detection.reasonNotReady === "edgeTightnessLowAdaptive");
          // Threshold mirrors capture-gate: 0.45 normally; 0.34 if the
          // 280px path already qualified for adaptive treatment.
          const adaptive = getLastDetectDiagnostics().adaptiveUsed;
          const tightThresh = adaptive ? adaptive.threshold : MIN_EDGE_TIGHTNESS_FOR_CAPTURE;
          const clearsGate = hi.tightness >= tightThresh;
          detection = {
            ...detection,
            debug: { ...detection.debug, edgeTightness: hi.tightness },
            ...(wasBlockedByTightness && clearsGate
              ? { readyForCapture: true, reasonNotReady: undefined }
              : {}),
          };
          if (debugEnabled && now - lastHiResTightLogAtRef.current > 750) {
            lastHiResTightLogAtRef.current = now;
            // eslint-disable-next-line no-console
            console.log("[scan] hires-tightness", {
              orig: +origTight.toFixed(3),
              hires: +hi.tightness.toFixed(3),
              perSide: hi.perSide.map((v) => +v.toFixed(2)),
              samples: hi.samples,
              threshold: +tightThresh.toFixed(2),
              clearedGate: wasBlockedByTightness && clearsGate,
            });
          }
        }
      } catch {
        // ignore — keep 280px-derived tightness
      }
    }

    // Reference unused hi-res symbols so TS doesn't complain when flags off.
    void ENABLE_HI_RES_DETECT;
    void HI_DETECT_WIDTH;
    void hiDetectCanvas;

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
      // Throttled diagnostic log — why didn't *any* candidate pass?
      if (debugEnabled && now - lastRejectLogAtRef.current > 750) {
        lastRejectLogAtRef.current = now;
        const d = getLastDetectDiagnostics();
        // eslint-disable-next-line no-console
        console.log("[scan] no-lock", {
          candidates: d.candidateCount,
          rejects: d.rejects,
          bestRejected: d.bestRejected,
        });
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

    // Throttled log when adaptive-edge-tightness path accepted a candidate.
    if (debugEnabled) {
      const adaptive = getLastDetectDiagnostics().adaptiveUsed;
      if (adaptive && adaptive.accepted && now - lastAdaptiveLogAtRef.current > 750) {
        lastAdaptiveLogAtRef.current = now;
        // eslint-disable-next-line no-console
        console.log("[scan] adaptive-edge-tightness", adaptive);
      }
    }

    // Normalize to 0..1
    const norm = corners.map((p) => ({ x: p.x / dw, y: p.y / dh })) as [Point, Point, Point, Point];

    // ===== Generous overlay branch (feature-flagged) =====
    // The detection passed structural gates but NOT the strict capture
    // gates (edgeTightness / contrast / brightness / etc.). Show the
    // document frame to the user so they can see it IS being found, and
    // coach them with a reason. Auto-capture is blocked here by design.
    if (ENABLE_GENEROUS_OVERLAY && !readyForCapture) {
      // Gentle EMA so the overlay glides instead of jittering.
      const smoothed = emaQuad(smoothQuad.current, norm, 0.5);
      smoothQuad.current = smoothed;
      lastRawQuad.current = norm;
      stableCount.current = 0;
      lockedRef.current = false;
      lockBreakFramesRef.current = 0;
      setProgress(0);
      drawOverlay(smoothed, "hold");

      const areaRatio = detection?.debug.areaRatio ?? 0;
      const a4Ratio = detection?.a4Ratio ?? Math.SQRT2;
      const a4Diff = Math.min(
        Math.abs(a4Ratio - Math.SQRT2),
        Math.abs(a4Ratio - 1 / Math.SQRT2),
      );
      // Map reasonNotReady (+ live metrics) to actionable hint.
      let nextStatus: Status = "align";
      if (
        reasonNotReady === "interiorTooDark" ||
        reasonNotReady === "lowPaperBgContrast" ||
        !isBrightEnough
      ) {
        nextStatus = "lowLight";
      } else if (
        reasonNotReady === "edgeTightnessLow" ||
        reasonNotReady === "edgeTightnessLowAdaptive" ||
        reasonNotReady === "edgeScoreLow"
      ) {
        // Weak edges almost always mean "document too far away" for A4.
        if (areaRatio > 0 && areaRatio < 0.22) nextStatus = "tooFar";
        else if (a4Diff > 0.3) nextStatus = "tilt";
        else nextStatus = "align";
      } else if (areaRatio > 0 && areaRatio < 0.22) {
        nextStatus = "tooFar";
      } else if (a4Diff > 0.3) {
        nextStatus = "tilt";
      } else {
        nextStatus = "hold";
      }
      setStatus(nextStatus);

      if (debugEnabled && now - lastOverlayLogAtRef.current > 750) {
        lastOverlayLogAtRef.current = now;
        // eslint-disable-next-line no-console
        console.log("[scan] detection", {
          detectedForOverlay,
          readyForCapture,
          reasonNotReady,
          areaRatio,
          a4Ratio,
          edgeTightness: detection?.debug.edgeTightness,
          edgeScore: detection?.debug.edgeScore,
          a4Score: detection?.debug.a4Score,
          confidence: detection?.confidence,
          nextStatus,
        });
      }
      return;
    }


    // Candidate memory — record this detection so we can spot scenes where
    // multiple competing quads keep flickering frame-to-frame. We never
    // change which quad we draw or warp; we only gate `stableCount` later
    // if the cluster picture is ambiguous.
    if (ENABLE_CANDIDATE_MEMORY && detection) {
      const hist = candidateHistoryRef.current;
      hist.push({
        norm: norm.map((p) => ({ x: p.x, y: p.y })) as [Point, Point, Point, Point],
        conf: detection.confidence,
        areaRatio: detection.debug.areaRatio ?? 0,
        a4Ratio: detection.a4Ratio ?? Math.SQRT2,
        edge: detection.debug.edgeTightness ?? 0,
        t: now,
      });
      // Drop oldest + entries older than ~1s.
      while (hist.length > CANDIDATE_HISTORY_MAX) hist.shift();
      while (hist.length && now - hist[0].t > 1000) hist.shift();
    }

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
    // Push to the voting ring buffer (only the most recent frames count).
    const buf = recentSmoothQuadsRef.current;
    buf.push(smoothed.map((p) => ({ x: p.x, y: p.y })) as [Point, Point, Point, Point]);
    if (buf.length > QUAD_VOTE_WINDOW) buf.shift();

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

    // Sample interior luminance of the detected paper and meter the camera
    // toward that region so backlight/dark surroundings don't bias exposure.
    {
      const ix0 = Math.max(0, Math.floor(minSx + padX));
      const ix1 = Math.min(dw, Math.ceil(maxSx - padX));
      const iy0 = Math.max(0, Math.floor(minSy + padY));
      const iy1 = Math.min(dh, Math.ceil(maxSy - padY));
      let dLumSum = 0;
      let dLumCount = 0;
      for (let y = iy0; y < iy1; y += 6) {
        for (let x = ix0; x < ix1; x += 6) {
          const i = (y * dw + x) * 4;
          dLumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          dLumCount++;
        }
      }
      const docLum = dLumCount ? dLumSum / dLumCount : meanLum;
      docLumRef.current = docLum;
      const cxN = (minSx + maxSx) / 2 / dw;
      const cyN = (minSy + maxSy) / 2 / dh;
      meterTowardsDoc(cxN, cyN, docLum);
    }
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

    // Derive richer hints from detector diagnostics that are already
    // computed each frame — avoids new algorithm work but lets us tell
    // the user exactly why we're not auto-capturing yet.
    const areaRatio = detection?.debug.areaRatio ?? 0;
    const edgeTightness = detection?.debug.edgeTightness ?? 0;
    const a4Ratio = detection?.a4Ratio ?? Math.SQRT2;
    const a4Diff = Math.min(
      Math.abs(a4Ratio - Math.SQRT2),
      Math.abs(a4Ratio - 1 / Math.SQRT2),
    );
    // Soft thresholds, intentionally looser than the hard capture gates
    // so we coach the user *before* the auto-capture is blocked.
    // "Too far" uses persistence: nag only once the doc has been small
    // for ~1s, so we don't flicker hints while the user is still framing.
    if (areaRatio > 0 && areaRatio < 0.18) tooFarFramesRef.current++;
    else tooFarFramesRef.current = 0;
    const tooFar =
      areaRatio > 0 &&
      (areaRatio < 0.12 || (areaRatio < 0.18 && tooFarFramesRef.current > 25));
    const tooClose = areaRatio > 0.88;
    const tilted = a4Diff > 0.35;
    const looseEdges = edgeTightness > 0 && edgeTightness < 0.45;

    // ===== Capture-gate diagnostics =====
    // Evaluate every gate the auto-capture branch will use, so we can
    // surface the *exact* reason capture is being blocked even when the
    // document frame already looks correct on screen. Pure observation —
    // no behavior change.
    const isShakyNow =
      motionAvailableRef.current && motionMagRef.current > MOTION_STILL_THRESHOLD;
    const cooldownMs = Math.max(0, armedAtRef.current - performance.now());
    let captureBlockedBy: string | null = null;
    if (!isBrightEnough && lowLightFramesRef.current > 15) captureBlockedBy = "light";
    else if (stableCount.current < HOLD_FRAMES) captureBlockedBy = "stability:framing";
    else if (!isSharp) captureBlockedBy = "sharpness";
    else if (stableCount.current < READY_FRAMES) captureBlockedBy = "stability:ready";
    else if (stableCount.current < STABLE_FRAMES) captureBlockedBy = "stability:stable";
    else if (cooldownMs > 0) captureBlockedBy = "cooldown";
    else if (isShakyNow) captureBlockedBy = "motion";
    // "ambiguous" is filled in below once it's computed.
    captureGateRef.current = {
      reason: captureBlockedBy,
      stable: stableCount.current,
      stableTarget: STABLE_FRAMES,
      sharpness: sharpnessRef.current,
      sharpnessMin: SHARPNESS_LIVE_MIN,
      brightness: brightnessRef.current,
      brightnessMin: BRIGHTNESS_MIN,
      motionMag: motionMagRef.current,
      motionAvail: motionAvailableRef.current,
      confidence: detection?.confidence ?? 0,
      edgeTightness,
      a4Diff,
      areaRatio,
      cooldownMs,
    };

    if (!isBrightEnough && lowLightFramesRef.current > 15) {
      drawOverlay(smoothed, "hold");
      setStatus("lowLight");
    } else if (stableCount.current < HOLD_FRAMES) {
      drawOverlay(smoothed, "hold");
      // While the user is still framing, prefer the most actionable hint.
      if (tooFar) setStatus("tooFar");
      else if (tooClose) setStatus("tooClose");
      else if (tilted) setStatus("tilt");
      else setStatus("align");
    } else if (!isSharp) {
      drawOverlay(smoothed, "hold");
      setStatus(blurFramesRef.current > BLUR_HINT_FRAMES ? "moveBack" : "focusing");
    } else if (stableCount.current < READY_FRAMES) {
      drawOverlay(smoothed, "hold");
      // Even when motion is stable, surface a framing problem before
      // the user keeps holding the phone for nothing.
      if (tooFar) setStatus("tooFar");
      else if (tooClose) setStatus("tooClose");
      else if (tilted) setStatus("tilt");
      else if (looseEdges) setStatus("align");
      else setStatus("hold");
    } else if (stableCount.current < STABLE_FRAMES) {
      drawOverlay(smoothed, "ready");
      setStatus("ready");
    } else {
      drawOverlay(smoothed, "ready");
      const isShaky =
        motionAvailableRef.current && motionMagRef.current > MOTION_STILL_THRESHOLD;
      // Candidate-memory ambiguity gate. If recent frames produced two
      // meaningfully different quads with similar support, hold off auto-
      // capture so we don't snap the wrong one.
      let ambiguous = false;
      if (ENABLE_CANDIDATE_MEMORY) {
        const hist = candidateHistoryRef.current;
        if (hist.length >= 6) {
          const clusters: { rep: CandidateEntry; count: number }[] = [];
          for (const e of hist) {
            let placed = false;
            for (const c of clusters) {
              if (
                maxCornerDelta(e.norm, c.rep.norm) <= CANDIDATE_CLUSTER_DELTA &&
                Math.abs(e.areaRatio - c.rep.areaRatio) <= CANDIDATE_AREA_TOL &&
                Math.abs(e.a4Ratio - c.rep.a4Ratio) <= CANDIDATE_A4_TOL
              ) {
                c.count++;
                placed = true;
                break;
              }
            }
            if (!placed) clusters.push({ rep: e, count: 1 });
          }
          clusters.sort((a, b) => b.count - a.count);
          if (
            clusters.length >= 2 &&
            clusters[1].count >= Math.max(3, Math.ceil(clusters[0].count * CANDIDATE_AMBIGUITY_RATIO))
          ) {
            ambiguous = true;
          }
        }
        ambiguousFramesRef.current = ambiguous
          ? ambiguousFramesRef.current + 1
          : 0;
      }
      if (performance.now() < armedAtRef.current) {
        // Re-aim cooldown after a saved page — show "ready" but don't snap yet.
        setStatus("ready");
        stableCount.current = Math.min(stableCount.current, STABLE_FRAMES - 1);
        if (captureGateRef.current) captureGateRef.current.reason = "cooldown";
      } else if (isShaky) {
        // Phone is moving — keep "ready" but don't auto-capture this frame.
        setStatus("ready");
        stableCount.current = Math.min(stableCount.current, STABLE_FRAMES - 1);
        if (captureGateRef.current) captureGateRef.current.reason = "motion";
      } else if (ambiguous) {
        // Competing candidates — wait for one to win.
        setStatus("ready");
        stableCount.current = Math.min(stableCount.current, STABLE_FRAMES - 1);
        if (captureGateRef.current) captureGateRef.current.reason = "ambiguous";
      } else {
        setStatus("capturing");
        if (captureGateRef.current) captureGateRef.current.reason = null;
        capture(smoothed);
      }
    }

    // Throttled log of capture-gate state (debug only). Fires whenever we
    // saw a document but didn't actually call capture() this frame.
    if (debugEnabled && captureGateRef.current?.reason && now - lastGateLogAtRef.current > 750) {
      lastGateLogAtRef.current = now;
      // eslint-disable-next-line no-console
      console.log("[scan] capture-gate", captureGateRef.current);
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
    triggerCaptureHaptic();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (debugEnabled) {
      setDebugInfo((d) => ({ ...d, vw, vh, ready: true, lastCapture: Date.now() }));
    }

    // Show the just-taken raw frame immediately so the user sees that the
    // photo is done — no need to keep the phone still. Processing status
    // (deskew → enhance → preview) is layered on top.
    try {
      const snap = document.createElement("canvas");
      const SNAP_W = Math.min(vw, 720);
      snap.width = SNAP_W;
      snap.height = Math.max(1, Math.round((vh / vw) * SNAP_W));
      snap.getContext("2d")!.drawImage(video, 0, 0, snap.width, snap.height);
      const snapUrl = snap.toDataURL("image/jpeg", 0.7);
      if (savedTimer1Ref.current) window.clearTimeout(savedTimer1Ref.current);
      if (savedTimer2Ref.current) window.clearTimeout(savedTimer2Ref.current);
      if (savedTimer3Ref.current) window.clearTimeout(savedTimer3Ref.current);
      setSavedOverlay({ dataUrl: snapUrl, visible: true });
      setCaptureStage({ label: t("capStageShot"), progress: 0.05 });
      if (stageTimerRef.current) window.clearTimeout(stageTimerRef.current);
      stageTimerRef.current = window.setTimeout(() => {
        if (cancelledRef.current) return;
        setCaptureStage({ label: t("capStageDeskew"), progress: 0.25 });
      }, 400);
    } catch {
      // snapshot is best-effort; processing continues regardless
    }

    // Sortera alltid hörnen i exakt ordning TL, TR, BR, BL innan warp.
    // Multi-frame voting: median of the last N smoothed quads (per corner).
    // En enstaka skakig frame kan inte längre dra warp-hörnen av pappret.
    const votes = recentSmoothQuadsRef.current;
    const overlayQuadNorm = smoothQuad.current; // exactly what overlay drew
    let votedQuad: [Point, Point, Point, Point] = normQuad;
    let votingApplied = false;
    if (votes.length >= 3) {
      const orderedVotes = votes.map((v) => orderQuad(v));
      const median = (arr: number[]) => {
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      };
      votedQuad = [0, 1, 2, 3].map((i) => ({
        x: median(orderedVotes.map((q) => q[i].x)),
        y: median(orderedVotes.map((q) => q[i].y)),
      })) as [Point, Point, Point, Point];
      votingApplied = true;
    }
    const orderedNormQuad = orderQuad(votedQuad);

    logScanStage("warp-trace/1-detected-norm", {
      raw: formatQuad(normQuad),
      overlayLast: overlayQuadNorm ? formatQuad(overlayQuadNorm) : null,
      voteWindow: votes.length,
      votingApplied,
      votedQuadNorm: formatQuad(votedQuad),
      overlayVsVotedMaxDelta: overlayQuadNorm
        ? Math.max(
            ...orderQuad(overlayQuadNorm).map((p, i) =>
              Math.hypot(p.x - orderedNormQuad[i].x, p.y - orderedNormQuad[i].y),
            ),
          )
        : null,
    });

    // Text-safe mode: do not grow or shrink the detected crop. Growing shows
    // desk/background; shrinking risks cutting off real text near the edges.
    const EDGE_MARGIN = 0;
    const cx = (orderedNormQuad[0].x + orderedNormQuad[1].x + orderedNormQuad[2].x + orderedNormQuad[3].x) / 4;
    const cy = (orderedNormQuad[0].y + orderedNormQuad[1].y + orderedNormQuad[2].y + orderedNormQuad[3].y) / 4;
    const expandedNormQuad = orderedNormQuad.map((p) => ({
      x: Math.max(0, Math.min(1, cx + (p.x - cx) * (1 + EDGE_MARGIN))),
      y: Math.max(0, Math.min(1, cy + (p.y - cy) * (1 + EDGE_MARGIN))),
    })) as [Point, Point, Point, Point];

    // Convert hörn till källans pixelkoordinater i samma ordning.
    const srcQuad = expandedNormQuad.map((p) => ({
      x: p.x * vw,
      y: p.y * vh,
    })) as [Point, Point, Point, Point];
    const geometry = measureQuadGeometry(srcQuad);

    // Warpa alltid direkt till stående A4. Tidigare valde vi landscape-output
    // när den uppmätta quadens skärmbredd var större än höjden och roterade
    // sedan efteråt; det var källan till 90°-felet. Samma hörn används nu
    // direkt mot en stående A4-duk — ingen separat 90°-rotation behövs.
    // 200 DPI A4 (210 mm × 297 mm) ≈ 1654 × 2339 px. Document-scan quality:
    // tydlig text och signaturer, men ~40 % av pixlarna jämfört med 300 DPI →
    // dramatiskt mindre JPEG/PDF utan synlig läsbarhetsförsämring.
    const outW = 1654;
    const outH = Math.round(outW * Math.SQRT2);


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
      // Burst capture: grab 3 frames over ~150ms and pick the sharpest.
      // Defeats micro-blur from hand jitter / autofocus hunt right at the
      // moment of capture. Sharpness is scored on a small downsample for speed;
      // only the best frame is kept at full resolution.
      let bestFrame: HTMLCanvasElement | null = null;
      let bestScore = -1;
      const scoreCanvas = document.createElement("canvas");
      const SCORE_W = 320;
      const scoreH = Math.max(1, Math.round((vh / vw) * SCORE_W));
      scoreCanvas.width = SCORE_W;
      scoreCanvas.height = scoreH;
      const scoreCtx = scoreCanvas.getContext("2d", { willReadFrequently: true })!;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 50));
        }
        scoreCtx.drawImage(video, 0, 0, SCORE_W, scoreH);
        const score = canvasLaplacianVariance(scoreCanvas);
        if (score > bestScore) {
          bestScore = score;
          const frame = document.createElement("canvas");
          frame.width = vw;
          frame.height = vh;
          frame.getContext("2d")!.drawImage(video, 0, 0, vw, vh);
          bestFrame = frame;
        }
      }
      logScanStage("burst-capture", { bestSharpness: bestScore });

      // Subpixel corner refinement on the full-res frame just before warp.
      // Keep this conservative: it can only nudge individual corners ±5px.
      const refineSource = bestFrame ?? video;
      let refinedSrcQuad = srcQuad;
      try {
        refinedSrcQuad = refineQuadCorners(refineSource, vw, vh, srcQuad);
        logScanStage("subpixel-refine", {
          before: formatQuad(srcQuad),
          after: formatQuad(refinedSrcQuad),
        });
      } catch (e) {
        console.warn("[scan] subpixel refine failed, using raw quad", e);
      }

      // Threshold-based paper lock — Otsu + largest bright connected
      // component + min-area oriented bounding box. Used to snap the crop
      // tight to the actual paper edges so the wood/desk background doesn't
      // appear around the warped page. Only adopted when its centroid is
      // near the detected quad (sanity check) and its area is within a
      // plausible range relative to the detected quad.
      try {
        const thrQuad = detectPaperByThreshold(refineSource, vw, vh);
        if (thrQuad) {
          const cx = (refinedSrcQuad[0].x + refinedSrcQuad[1].x + refinedSrcQuad[2].x + refinedSrcQuad[3].x) / 4;
          const cy = (refinedSrcQuad[0].y + refinedSrcQuad[1].y + refinedSrcQuad[2].y + refinedSrcQuad[3].y) / 4;
          const tx = (thrQuad[0].x + thrQuad[1].x + thrQuad[2].x + thrQuad[3].x) / 4;
          const ty = (thrQuad[0].y + thrQuad[1].y + thrQuad[2].y + thrQuad[3].y) / 4;
          const centroidDist = Math.hypot(cx - tx, cy - ty) / Math.hypot(vw, vh);
          // quad areas (shoelace)
          const quadArea = (q: typeof refinedSrcQuad) => {
            let s = 0;
            for (let i = 0; i < 4; i++) {
              const a = q[i];
              const b = q[(i + 1) % 4];
              s += a.x * b.y - b.x * a.y;
            }
            return Math.abs(s) / 2;
          };
          const aDet = quadArea(refinedSrcQuad);
          const aThr = quadArea(thrQuad);
          const areaRatio = aDet > 0 ? aThr / aDet : 0;
          const accept = centroidDist < 0.18 && areaRatio > 0.55 && areaRatio < 1.6;
          logScanStage("threshold-paper-lock", {
            applied: accept,
            centroidDist,
            areaRatio,
            before: formatQuad(refinedSrcQuad),
            candidate: formatQuad(thrQuad),
          });
          if (accept) refinedSrcQuad = thrQuad;
        } else {
          logScanStage("threshold-paper-lock", { applied: false, reason: "no-candidate" });
        }
      } catch (e) {
        console.warn("[scan] threshold paper lock failed", e);
      }

      // FINAL trace: this is the exact quad handed to warpQuadToRect.
      const finalSrcQuad = refinedSrcQuad;
      logScanStage("warp-trace/5-final-input", {
        srcPixels: formatQuad(finalSrcQuad),
        frameSize: { vw, vh },
        outSize: { outW, outH },
        usingBurstFrame: Boolean(bestFrame),
        srcFromOverlayDeltaPx: overlayQuadNorm
          ? Math.max(
              ...orderQuad(overlayQuadNorm).map((p, i) =>
                Math.hypot(p.x * vw - finalSrcQuad[i].x, p.y * vh - finalSrcQuad[i].y),
              ),
            )
          : null,
      });
      let warped = warpQuadToRect(bestFrame ?? video, vw, vh, finalSrcQuad, outW, outH);
      logScanStage("warp-trace/6-after-warp", {
        canvasSize: { w: warped.width, h: warped.height },
        aspect: warped.width / warped.height,
        orientation: warped.width >= warped.height ? "landscape" : "portrait",
      });
      logScanCanvas("after-perspective-transform", warped, debugEnabled);

      // Efter warp ska bilden redan ligga på en stående A4-yta. 90°-
      // auto-orientering är därför avstängd som standard; den kan slås på
      // explicit med ?enableAutoOrient=1 för felsökning, men används inte i
      // normalflödet.
      if (stageTimerRef.current) window.clearTimeout(stageTimerRef.current);
      setCaptureStage({ label: t("capStageEnhance"), progress: 0.5 });
      // Feature flags for stegvis felsökning av efter-warp-pipelinen.
      // Toggla via URL (?flag=1) eller localStorage ("docscan.<flag>"="1"):
      //   rawWarpOnly       → hoppa över ALLT efter warpQuadToRect
      //   enableAutoOrient  → slå på mild efter-deskew/A4-render för test
      //   noAutoOrient      → tvinga av autoOrientAndDeskewDocument
      //   noWhiten          → hoppa över whitenBackground
      //   noInkBoost        → hoppa över boostInkContrast
      const readFlag = (name: string): boolean => {
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.get(name) === "1") return true;
          if (window.localStorage.getItem(`docscan.${name}`) === "1") return true;
        } catch {}
        return false;
      };
      const rawWarpOnly = readFlag("rawWarpOnly");
      const enableAutoOrient = readFlag("enableAutoOrient") && !readFlag("noAutoOrient");
      const disableAutoOrient = rawWarpOnly || !enableAutoOrient;
      const disableWhiten = rawWarpOnly || readFlag("noWhiten");
      const disableInkBoost = rawWarpOnly || readFlag("noInkBoost");
      logScanStage("post-warp-flags", {
        rawWarpOnly,
        enableAutoOrient,
        disableAutoOrient,
        disableWhiten,
        disableInkBoost,
      });

      if (disableAutoOrient) {
        logScanStage("warp-trace/7-auto-orient", {
          skipped: true,
          reason: rawWarpOnly ? "raw-warp-only" : "disabled-by-default",
          inputSize: { w: warped.width, h: warped.height },
          outputSize: { w: warped.width, h: warped.height },
        });
      } else {
        try {
          const beforeW = warped.width;
          const beforeH = warped.height;
          let diag: unknown = null;
          warped = autoOrientAndDeskewDocument(warped, (d) => {
            diag = d;
          });
          logScanStage("warp-trace/7-auto-orient", {
            skipped: false,
            inputSize: { w: beforeW, h: beforeH },
            outputSize: { w: warped.width, h: warped.height },
            diagnostics: diag,
          });
          logScanCanvas("after-deskew", warped, debugEnabled);
          logScanStage("deskew", { skipped: false });
        } catch (e) {
          console.warn("[scan] autoOrientAndDeskewDocument failed; using warped frame", e);
          logScanStage("deskew", { skipped: true, reason: "exception" });
        }
      }

      // Mild flat-field whitening: shading correction + paper-level white
      // point (~250). Text strokes are mathematically protected via the
      // luminance-blend weight inside whitenBackground (T_NONE=110 keeps
      // dark pixels untouched), so no glyphs are bleached.
      setCaptureStage({ label: t("capStageEnhance"), progress: 0.75 });
      if (disableWhiten) {
        logScanStage("whiten-background", {
          applied: false,
          reason: rawWarpOnly ? "raw-warp-only" : "feature-flag",
        });
      } else {
        try {
          warped = whitenBackground(warped);
          logScanCanvas("after-whiten-background", warped, debugEnabled);
          logScanStage("whiten-background", { applied: true, mode: "flat-field-text-safe" });
        } catch (e) {
          console.warn("[scan] whitenBackground failed; keeping warped frame", e);
          logScanStage("whiten-background", { applied: false, reason: "exception" });
        }
      }

      // Local ink-contrast boost — mild unsharp mask gated to dark pixels
      // (L<=150). Sharpens thin/light text (footers, body 8–9pt) without
      // amplifying background sensor noise on the now-white paper.
      if (disableInkBoost) {
        logScanStage("ink-boost", {
          applied: false,
          reason: rawWarpOnly ? "raw-warp-only" : "feature-flag",
        });
      } else {
        try {
          warped = boostInkContrast(warped);
          logScanCanvas("after-ink-boost", warped, debugEnabled);
          logScanStage("ink-boost", { applied: true });
        } catch (e) {
          console.warn("[scan] boostInkContrast failed; keeping previous frame", e);
          logScanStage("ink-boost", { applied: false, reason: "exception" });
        }
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
      if (postSharpness < SHARPNESS_CAPTURE_MIN) {
        console.info("[scan] post-capture sharpness below target; keeping captured page", {
          value: postSharpness,
          threshold: SHARPNESS_CAPTURE_MIN,
        });
      }
      // Post-capture contrast gate. A washed-out / blown-out frame with
      // almost no luma variance is almost certainly a misfire (lens cover,
      // pointed at a uniform surface, severe over-exposure). Retry rather
      // than save a blank page. Threshold is intentionally low so any real
      // document with text or signatures sails through.
      const postContrast = canvasContrast(warped);
      logScanStage("post-capture-contrast", {
        value: postContrast,
        threshold: 12,
        retries: captureRetryRef.current,
      });
      if (postContrast < 3) {
        throw new Error("Processed scan is nearly blank; falling back to raw camera frame");
      }
      captureRetryRef.current = 0;

      // Use high-quality JPEG so tiny footer/header text survives PDF output.
      const JPEG_QUALITY = 0.94;
      setCaptureStage({ label: t("capStagePreview"), progress: 0.88 });
      const dataUrl = canvasToSafeImageDataUrl(warped, JPEG_QUALITY);
      if (!dataUrl) {
        throw new Error("Unable to encode scanned page");
      }
      // sourceDataUrl används inte för PDF — håll den liten så minnet inte
      // sväller när användaren skannar många sidor.
      const sourceCanvas = document.createElement("canvas");
      const SRC_MAX = 800;
      const srcScale = Math.min(1, SRC_MAX / Math.max(vw, vh));
      sourceCanvas.width = Math.round(vw * srcScale);
      sourceCanvas.height = Math.round(vh * srcScale);
      sourceCanvas
        .getContext("2d")!
        .drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
      const sourceDataUrl = canvasToSafeImageDataUrl(sourceCanvas, 0.6, 900) ?? dataUrl;

      logScanCanvas("final-image-to-pdf", warped, debugEnabled);
      logScanStage("pdf-input", {
        sameDataUrlUsedForPreviewAndPdf: true,
        imageWidth: warped.width,
        imageHeight: warped.height,
        format: "JPEG",
        quality: JPEG_QUALITY,
        approxKB: Math.round(dataUrl.length * 0.75 / 1024),
      });
      const session = scanStore.addPage(dataUrl, {
        sourceDataUrl,
        detection: {
          corners: orderedNormQuad,
          a4Ratio: meta.a4Ratio,
          confidence: meta.confidence,
          debug: meta.debug,
        },
      });
      finishPageCapture(dataUrl, scanStore.getPages().length || session.pages.length);
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
    triggerCaptureHaptic();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    canvas.getContext("2d")!.drawImage(video, 0, 0, vw, vh);
    const dataUrl = canvasToSafeImageDataUrl(canvas, 0.82);
    if (!dataUrl) {
      capturedRef.current = false;
      setStatus("searching");
      return;
    }
    // Use full-frame "quad" so downstream code has valid corners.
    const fullQuad: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const session = scanStore.addPage(dataUrl, {
      sourceDataUrl: dataUrl,
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
    finishPageCapture(dataUrl, scanStore.getPages().length || session.pages.length);
  }

  // After a successful capture: show the cropped A4 page briefly, then go to
  // preview. Returning to live search after the first page looked like the
  // scanner had reset, and could also trigger a second unwanted capture.
  function finishPageCapture(dataUrl: string, count: number) {
    setPageCount(count);
    setLastThumbnail(dataUrl);

    // Reset detection state so auto-capture starts fresh for the next page.
    stableCount.current = 0;
    detectCount.current = 0;
    missCount.current = 0;
    smoothQuad.current = null;
    recentSmoothQuadsRef.current = [];
    lastRawQuad.current = null;
    detectionMeta.current = null;
    blurFramesRef.current = 0;
    captureRetryRef.current = 0;
    tooFarFramesRef.current = 0;
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
    if (stageTimerRef.current) window.clearTimeout(stageTimerRef.current);
    setCaptureStage({ label: t("savingPage"), progress: 1 });

    // Phase 2 (~700ms): hand off the captured page to preview while the scan
    // session is still hot in memory. Multi-page scanning continues from
    // preview via "Add page".
    savedTimer1Ref.current = window.setTimeout(() => {
      if (cancelledRef.current) return;
      finishScanning();
    }, 700);
  }


  function finishScanning() {
    if (savedTimer1Ref.current) window.clearTimeout(savedTimer1Ref.current);
    if (savedTimer2Ref.current) window.clearTimeout(savedTimer2Ref.current);
    if (savedTimer3Ref.current) window.clearTimeout(savedTimer3Ref.current);
    const storePages = scanStore.getPages().filter(isUsableImageDataUrl);
    const pages = storePages.length ? storePages : isUsableImageDataUrl(lastThumbnail) ? [lastThumbnail] : [];
    console.info("[scan] scanStore.getPages before Done", {
      pages: pages.length,
      firstPageExists: Boolean(pages[0]),
      lastPageExists: Boolean(pages[pages.length - 1]),
      imageDataUrlExists: Boolean(scanStore.get().imageDataUrl),
    });
    if (!pages.length) {
      setPageCount(0);
      setLastThumbnail(null);
      setStatus("searching");
      return;
    }
    cancelledRef.current = true;
    cameraStartTokenRef.current += 1;
    stopCamera("done-to-preview");
    scanStore.set({ pages, imageDataUrl: pages[pages.length - 1] });
    scanStore.savePreviewHandoff(pages, pages.length - 1);
    navigate({
      to: "/preview",
      replace: true,
      state: (prev) => ({
        ...prev,
        // Keep large base64 images out of history.state. The in-memory store
        // is the source of truth; bloating history can silently fail on mobile
        // and leave /preview with an empty image.
        scanPages: undefined,
        scanActiveIndex: pages.length - 1,
      }),
    });
  }

  function startOverScan() {
    scanStore.clear("start over scan");
    setLastThumbnail(null);
    setPageCount(0);
    setStatus("searching");
    startCamera({ restartStream: true });
  }
  // Suppress unused warning — kept for potential future re-entry point.
  void startOverScan;

  function cancelScan() {
    stopCamera("cancel-scan");
    scanStore.clear("cancel scan");
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
    tooFar: t("statusTooFar"),
    tooClose: t("statusTooClose"),
    tilt: t("statusTilt"),
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
        {/* Tap-to-cancel layer — only catches taps during ready countdown so user can abort auto-capture */}
        {status === "ready" && (
          <button
            type="button"
            aria-label={t("cancel")}
            onClick={() => {
              stableCount.current = 0;
              lockedRef.current = false;
              setProgress(0);
              setStatus("align");
            }}
            className="absolute inset-0 z-10 bg-transparent"
          />
        )}
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
        {torchAvailable ? (
          <button
            onClick={toggleTorch}
            className={`h-10 w-10 rounded-full backdrop-blur flex items-center justify-center transition ${
              torchOn ? "bg-yellow-400 text-black" : "bg-black/55 text-white"
            }`}
            aria-label="Torch"
            aria-pressed={torchOn}
          >
            {torchOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
          </button>
        ) : (
          <div className="w-10" />
        )}
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
          className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/95 px-6"
          style={{
            opacity: savedOverlay.visible ? 1 : 0,
            transition: "opacity 380ms ease-out",
          }}
        >
          <div
            className="relative overflow-hidden rounded-xl bg-white shadow-2xl"
            style={{
              width: "min(70vw, 280px)",
              aspectRatio: "1 / 1.414",
            }}
          >
            <img
              src={savedOverlay.dataUrl}
              alt=""
              className="block w-full h-full object-cover"
            />
          </div>
          <div className="flex flex-col items-center gap-3 text-white w-full max-w-[280px]">
            <p className="text-[16px] font-semibold tracking-tight text-center drop-shadow">
              {captureStage?.label ?? t("savingPage")}
            </p>
            <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{
                  width: `${Math.round((captureStage?.progress ?? 1) * 100)}%`,
                  transition: "width 320ms ease-out",
                }}
              />
            </div>
            <p className="text-[12px] text-white/85 tabular-nums">
              {Math.round((captureStage?.progress ?? 1) * 100)}%
              <span className="mx-2 opacity-50">·</span>
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
          {(() => {
            const d = getLastDetectDiagnostics();
            const reasons = Object.entries(d.rejects).sort((a, b) => b[1] - a[1]).slice(0, 3);
            const br = d.bestRejected;
            return (
              <>
                <div className="mt-1 border-t border-white/20 pt-1">
                  cands: {d.candidateCount} · rejects:
                </div>
                {reasons.length === 0 ? (
                  <div>  (none)</div>
                ) : (
                  reasons.map(([k, n]) => (
                    <div key={k}>  {k}: {n}</div>
                  ))
                )}
                {br && (
                  <div className="mt-0.5">
                    best-rej [{br.reason}]: area={br.areaRatio.toFixed(2)} edge={br.edgeScore.toFixed(2)} tight={br.edgeTightness.toFixed(2)} a4={br.a4Score.toFixed(2)} off={br.meanEdgeOffset.toFixed(1)}px ctr={br.contrast.toFixed(0)}
                  </div>
                )}
              </>
            );
          })()}
          {(() => {
            const g = captureGateRef.current;
            if (!g) return null;
            return (
              <>
                <div className="mt-1 border-t border-white/20 pt-1">
                  cap-gate: <span className={g.reason ? "text-amber-300" : "text-emerald-300"}>{g.reason ?? "READY ✓"}</span>
                </div>
                <div>
                  stable: {g.stable}/{g.stableTarget} · sharp: {g.sharpness.toFixed(0)}/{g.sharpnessMin}
                </div>
                <div>
                  bright: {g.brightness.toFixed(0)}/{g.brightnessMin} · motion: {g.motionAvail ? g.motionMag.toFixed(2) : "n/a"}
                </div>
                <div>
                  conf: {g.confidence.toFixed(2)} · tight: {g.edgeTightness.toFixed(2)}
                </div>
                <div>
                  a4Δ: {g.a4Diff.toFixed(2)} · area: {g.areaRatio.toFixed(2)} · cd: {g.cooldownMs > 0 ? g.cooldownMs.toFixed(0) + "ms" : "—"}
                </div>
              </>
            );
          })()}
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
                <>
                  {isNative() && (
                    <button
                      onClick={() => openNativeSettings()}
                      className="w-full rounded-xl bg-white text-black py-3.5 px-4 font-semibold text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
                    >
                      <Settings className="h-4 w-4" strokeWidth={2} />
                      {t("openSettings")}
                    </button>
                  )}
                  <button
                    onClick={() =>
                      startCamera({ restartStream: true, skipPermissionPreflight: true })
                    }
                    className={`w-full rounded-xl py-3.5 px-4 font-semibold text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition ${
                      isNative()
                        ? "bg-white/10 text-white"
                        : "bg-white text-black"
                    }`}
                  >
                    <RefreshCw className="h-4 w-4" strokeWidth={2} />
                    {t("retry")}
                  </button>
                </>
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
