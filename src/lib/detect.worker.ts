/// <reference lib="webworker" />
// Off-main-thread document detection.
//
// Runs exactly the same `detectDocumentQuad` algorithm as before — no
// thresholds, no gates and no geometry changed. The only difference is
// *where* it executes: moving the ~85 % of the detect cost that is
// edge/mask preprocessing off the main thread frees the UI thread so the
// overlay/React updates can render smoothly while a pass is in flight.
import { detectDocumentQuad, getLastDetectDiagnostics, type Point } from "./perspective";

type DetectRequest = {
  id: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  prefer?: [Point, Point, Point, Point];
  allowOverlay?: boolean;
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<DetectRequest>) => {
  const { id, width, height, pixels, prefer, allowOverlay } = event.data;
  try {
    const detection = detectDocumentQuad(pixels, width, height, { prefer, allowOverlay });
    ctx.postMessage({
      id,
      ok: true,
      detection,
      diagnostics: getLastDetectDiagnostics(),
    });
  } catch (error) {
    ctx.postMessage({ id, ok: false, error: String(error) });
  }
};
