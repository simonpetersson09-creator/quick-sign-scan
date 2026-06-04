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
  | "ready"
  | "capturing"
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
const STABLE_DELTA = 0.02; // normalized 0..1 — max smoothed corner movement to count as stable
const DETECT_FRAMES = 2; // show the detected frame quickly once all 4 corners exist
const HOLD_FRAMES = 15; // ~0.5s — "Håll stilla" phase
const READY_FRAMES = 35; // ~1.2s — "Dokument hittat" lock-in
const STABLE_FRAMES = 60; // ~2.0s total before auto-capture
// Sharpness gates — Laplacian variance computed on a 200px detect frame
// (in-camera) and the warped doc (post-capture). Tuned conservatively so a
// blurry doc never gets saved.
const SHARPNESS_LIVE_MIN = 35;
const SHARPNESS_CAPTURE_MIN = 80;
const BLUR_HINT_FRAMES = 75; // ~2.5s of blur before suggesting "move back"

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
  const sharpnessRef = useRef(0);
  const blurFramesRef = useRef(0);
  const captureRetryRef = useRef(0);

  const [status, setStatus] = useState<Status>("starting");
  const [progress, setProgress] = useState(0); // 0..1 — visual lock-in progress
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ErrorType | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [pageCount, setPageCount] = useState(() => scanStore.get().pages.length);
  const [justCaptured, setJustCaptured] = useState<string | null>(null);
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
      stableCount.current = 0;
      detectCount.current = 0;
      missCount.current = 0;
      smoothQuad.current = null;
      lastRawQuad.current = null;
      detectionMeta.current = null;
      setProgress(0);
      setCameraReady(false);
      drawOverlay(null, false);
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
        setProgress(0);
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

    // Measure sharpness within the detected quad. If the doc is too blurry
    // we must not auto-capture — wait for continuous autofocus to settle.
    let xs = smoothed.map((p) => p.x * dw);
    let ys = smoothed.map((p) => p.y * dh);
    const sharpness = laplacianVariance(data, dw, dh, {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    });
    sharpnessRef.current = sharpness;
    const isSharp = sharpness >= SHARPNESS_LIVE_MIN;
    if (!isSharp) {
      blurFramesRef.current++;
      // Hold back stability progress while the camera is still refocusing.
      stableCount.current = Math.min(stableCount.current, READY_FRAMES - 1);
    } else {
      blurFramesRef.current = 0;
    }

    // Progress 0..1 — fills up as the document stays stable, hits 1.0 right before capture.
    const pct = Math.max(0, Math.min(1, stableCount.current / STABLE_FRAMES));
    setProgress(pct);

    // Wait for enough consecutive detections before moving to "found" status.
    // The frame itself is drawn as soon as a 4-corner quad exists, otherwise it
    // feels like the scanner is doing nothing even when detection is active.
    if (detectCount.current < DETECT_FRAMES) {
      drawOverlay(smoothed, true);
      setStatus("searching");
      return;
    }

    if (stableCount.current < HOLD_FRAMES) {
      drawOverlay(smoothed, true);
      setStatus("align");
    } else if (!isSharp) {
      drawOverlay(smoothed, true);
      // After ~2.5s of unsharp frames, prompt the user to back off — usually
      // the document is closer than the minimum focus distance.
      setStatus(blurFramesRef.current > BLUR_HINT_FRAMES ? "moveBack" : "focusing");
    } else if (stableCount.current < READY_FRAMES) {
      drawOverlay(smoothed, true);
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
    const outW = 1000;
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

      const dataUrl = warped.toDataURL("image/jpeg", 0.92);
      const sourceDataUrl = sourceCanvas.toDataURL("image/jpeg", 0.86);
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

  // After a successful capture, freeze detection and show the in-camera review
  // overlay. The stream stays alive so the user can immediately scan another
  // page without re-asking for camera permissions.
  function finishPageCapture(dataUrl: string, count: number) {
    setPageCount(count);
    setJustCaptured(dataUrl);
    // Pause RAF/detection until the user chooses next action.
    capturedRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  function scanAnotherPage() {
    // Start a fresh camera session from this direct button click. This keeps
    // mobile browser camera permissions in a user gesture and avoids stale
    // video/detection state from the previous page.
    setJustCaptured(null);
    startCamera({ restartStream: true, skipPermissionPreflight: true });
  }

  function finishScanning() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    navigate({ to: "/preview" });
  }

  function startOverScan() {
    scanStore.clear();
    setJustCaptured(null);
    setPageCount(0);
    setStatus("searching");
    startCamera({ restartStream: true });
  }

  function cancelScan() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    navigate({ to: scanStore.get().pages.length > 0 ? "/preview" : "/" });
  }

  const statusText: Record<Status, string> = {
    starting: t("statusStarting"),
    searching: t("statusSearching"),
    uncertain: t("statusUncertain"),
    align: t("statusAlign"),
    hold: t("statusHold"),
    focusing: t("statusFocusing"),
    moveBack: t("statusMoveBack"),
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
        <div className="absolute inset-0 bg-black/25 pointer-events-none" />
        {/* Detected document frame is rendered by the SVG polygon below.
            No static guide frame — the frame only appears when 4 corners are detected. */}
        <svg
          ref={svgRef}
          className="absolute inset-0 z-20 w-full h-full pointer-events-none"
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
        {pageCount > 0 ? (
          <div className="px-3 py-1.5 rounded-full bg-success/90 text-success-foreground text-[12px] font-semibold tabular-nums">
            {pageCount}
          </div>
        ) : (
          <div className="w-10" />
        )}
      </div>

      <div className="flex-1" />

      {/* Bottom hint / manual capture */}
      <div className="relative pb-safe px-5 pt-4 flex flex-col items-center gap-3">
        {error && status !== "error" && (
          <p className="text-center text-sm text-red-200 max-w-xs">{error}</p>
        )}
        <div className="relative h-20 w-20 flex items-center justify-center">
          {/* Progress ring — fills as the document locks in, hits 100% then auto-captures */}
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
              stroke="var(--success)"
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
        <p className="text-xs text-white/75 text-center max-w-[260px]">{t("scanHint")}</p>
      </div>

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
            lastCapture:{" "}
            {debugInfo.lastCapture ? new Date(debugInfo.lastCapture).toLocaleTimeString() : "—"}
          </div>
        </div>
      )}

      {/* Post-capture review overlay — shown after each page is captured.
          User can scan another page (stream stays alive) or finish. */}
      {justCaptured && status !== "error" && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-end bg-black/75 backdrop-blur-sm px-5 pb-safe pt-10">
          <div className="w-full max-w-sm flex flex-col items-center gap-4">
            <div className="text-center">
              <p className="text-[13px] uppercase tracking-wide text-white/60 font-semibold">
                {t("pageCaptured")}
              </p>
              <p className="text-2xl font-semibold tracking-tight mt-1">
                {pageCount} {pageCount === 1 ? t("pageSingular") : t("pagePlural")}
              </p>
            </div>
            <div
              className="rounded-sm overflow-hidden border border-white/15 bg-white shadow-xl flex items-center justify-center"
              style={{ width: "min(60vw, 240px)" }}
            >
              <img
                src={justCaptured}
                alt={t("scannedAlt")}
                className="block w-full h-auto bg-white"
              />
            </div>
            {debugEnabled && scanStore.get().sourceDataUrl && scanStore.get().detection && (
              <div className="w-full flex flex-col items-center gap-1">
                <p className="text-[11px] uppercase tracking-wide text-white/60 font-semibold">
                  Debug: källram + hörn
                </p>
                <div
                  className="relative rounded-sm overflow-hidden border border-yellow-400/60 bg-black"
                  style={{ width: "min(70vw, 280px)" }}
                >
                  <img
                    src={scanStore.get().sourceDataUrl!}
                    alt="source frame"
                    className="block w-full h-auto"
                  />
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                  >
                    <polygon
                      points={scanStore
                        .get()
                        .detection!.corners.map((p) => `${p.x},${p.y}`)
                        .join(" ")}
                      fill="rgba(250,204,21,0.18)"
                      stroke="rgb(250,204,21)"
                      strokeWidth={0.006}
                      vectorEffect="non-scaling-stroke"
                    />
                    {scanStore.get().detection!.corners.map((p, i) => (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r={0.012} fill="rgb(250,204,21)" />
                        <text
                          x={p.x}
                          y={p.y}
                          fontSize={0.035}
                          fill="black"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontWeight="bold"
                        >
                          {["TL", "TR", "BR", "BL"][i]}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>
                <p className="text-[10px] text-white/50 font-mono">
                  conf: {scanStore.get().detection!.confidence.toFixed(2)} · a4:{" "}
                  {scanStore.get().detection!.a4Ratio.toFixed(2)}
                </p>
              </div>
            )}
            <div className="w-full flex flex-col gap-3 pt-2 pb-4">
              <button
                onClick={scanAnotherPage}
                className="w-full rounded-xl bg-white/15 border border-white/25 text-white py-3.5 px-4 font-medium text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
              >
                <Camera className="h-5 w-5" />
                {t("scanAnotherPage")}
              </button>
              <button
                onClick={finishScanning}
                className="w-full rounded-xl bg-white text-black py-3.5 px-4 font-semibold text-[15px] tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition"
              >
                {t("finishScanning")} <ArrowRight className="h-5 w-5" />
              </button>
              <button
                onClick={startOverScan}
                className="w-full rounded-xl bg-transparent border border-white/15 text-white/70 py-3 px-4 font-medium text-[14px] tracking-tight active:scale-[0.98] transition"
              >
                {t("startOver")}
              </button>
            </div>
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
