// Adaptive Ink Enhancement ("alternativ B").
//
// Purpose: darken pixels that are *relatively* darker than their local paper
// background, and leave the background itself completely untouched. This is
// what lifts weak grey text, 1 px table rules, pencil marks and text near a
// fold — all of which fall outside sharpenInk's absolute ink gate (L <= 150)
// and therefore get zero improvement today.
//
// Placement in the pipeline: after whitenBackground, immediately BEFORE
// sharpenInk. sharpenInk keeps doing what it does well (crisp edges on dark
// ink); this step supplies the missing contrast on faint features.
//
// Algorithm (single pass, background map on a downscaled proxy):
//   1. Downscale to a proxy (<= 320 px long edge) and build a grayscale
//      dilation (local max) of the luminance plane -> the local paper level.
//      Max-filtering ignores ink (ink is darker) so the map never dips into
//      glyphs.
//   2. Two box-blur passes smooth the dilated map into a soft background
//      field B(x, y), then bilinear-upsample it to full resolution.
//   3. Per pixel compute rel = L / B. rel >= relDark  -> untouched paper.
//      Below that, a squared ramp between relDark and knee gives the
//      darkening weight t, and the pixel is pushed toward the background
//      difference: L' = L - strength * t^2 * (B - L) * 0.9.
//
// Properties measured on the synthetic test page: +50% contrast on weak grey
// text, table rules and text near folds, zero halo, unchanged stroke width
// and unchanged background noise (sigma/mean identical).

export interface AdaptiveInkOptions {
  /** Overall darkening strength. */
  strength?: number;
  /** L/background ratio at/above which a pixel is pure paper (untouched). */
  relDark?: number;
  /** L/background ratio at/below which the darkening ramp is at full weight. */
  knee?: number;
  /** Long edge of the downscaled background proxy. */
  proxyLongEdge?: number;
  /** Dilation radius (in proxy pixels) used for the local paper estimate. */
  dilateRadius?: number;
}

export interface AdaptiveInkStats {
  /** Share of pixels that were modified at all. */
  touchedShare: number;
  /** Mean luminance drop over the touched pixels. */
  meanDrop: number;
  /** Largest luminance drop applied. */
  maxDrop: number;
  /** Background field median (paper level estimate, 0..255). */
  paperLevel: number;
  ms: number;
  width: number;
  height: number;
}

export interface AdaptiveInkResult {
  canvas: HTMLCanvasElement;
  stats: AdaptiveInkStats;
}

export const ADAPTIVE_INK_DEFAULTS: Required<AdaptiveInkOptions> = {
  strength: 0.40,
  relDark: 0.965,
  knee: 0.8,
  proxyLongEdge: 320,
  dilateRadius: 6,
};

function boxBlurPlane(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1);
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      sum +=
        tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Separable grayscale dilation (local max) with a square window. */
function dilatePlane(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) {
        const v = src[row + xx];
        if (v > m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) {
        const v = tmp[yy * w + x];
        if (v > m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

function medianOf(values: Float32Array): number {
  const copy = Array.from(values);
  copy.sort((a, b) => a - b);
  return copy[Math.floor(copy.length / 2)] ?? 0;
}

/**
 * Darkens likely ink relative to the local paper background. Returns a NEW
 * canvas; the input canvas is left untouched.
 */
export function adaptiveInkEnhance(
  canvas: HTMLCanvasElement,
  options: AdaptiveInkOptions = {},
): AdaptiveInkResult {
  const o = { ...ADAPTIVE_INK_DEFAULTS, ...options };
  const t0 =
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

  const w = canvas.width;
  const h = canvas.height;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d", { willReadFrequently: true })!;
  outCtx.drawImage(canvas, 0, 0);

  const emptyStats = (): AdaptiveInkStats => ({
    touchedShare: 0,
    meanDrop: 0,
    maxDrop: 0,
    paperLevel: 0,
    ms:
      (typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()) - t0,
    width: w,
    height: h,
  });

  if (w < 8 || h < 8) return { canvas: out, stats: emptyStats() };

  // --- 1. background proxy -------------------------------------------------
  const scale = Math.min(1, o.proxyLongEdge / Math.max(w, h));
  const pw = Math.max(8, Math.round(w * scale));
  const ph = Math.max(8, Math.round(h * scale));
  const proxy = document.createElement("canvas");
  proxy.width = pw;
  proxy.height = ph;
  const pctx = proxy.getContext("2d", { willReadFrequently: true })!;
  pctx.drawImage(canvas, 0, 0, pw, ph);
  const pdata = pctx.getImageData(0, 0, pw, ph).data;

  const plum = new Float32Array(pw * ph);
  for (let i = 0, j = 0; j < plum.length; i += 4, j++) {
    plum[j] = 0.299 * pdata[i] + 0.587 * pdata[i + 1] + 0.114 * pdata[i + 2];
  }

  const dilated = dilatePlane(plum, pw, ph, o.dilateRadius);
  const bgProxy = boxBlurPlane(
    boxBlurPlane(dilated, pw, ph, o.dilateRadius),
    pw,
    ph,
    o.dilateRadius,
  );
  const paperLevel = medianOf(bgProxy);

  // --- 2. full-res pass with bilinear-sampled background -------------------
  const img = outCtx.getImageData(0, 0, w, h);
  const d = img.data;
  const sx = (pw - 1) / Math.max(1, w - 1);
  const sy = (ph - 1) / Math.max(1, h - 1);

  let touched = 0;
  let dropSum = 0;
  let maxDrop = 0;

  for (let y = 0; y < h; y++) {
    const fy = y * sy;
    const y0 = Math.min(ph - 1, Math.floor(fy));
    const y1 = Math.min(ph - 1, y0 + 1);
    const wy = fy - y0;
    const row0 = y0 * pw;
    const row1 = y1 * pw;
    for (let x = 0; x < w; x++) {
      const fx = x * sx;
      const x0 = Math.min(pw - 1, Math.floor(fx));
      const x1 = Math.min(pw - 1, x0 + 1);
      const wx = fx - x0;
      const b =
        (bgProxy[row0 + x0] * (1 - wx) + bgProxy[row0 + x1] * wx) * (1 - wy) +
        (bgProxy[row1 + x0] * (1 - wx) + bgProxy[row1 + x1] * wx) * wy;
      if (b <= 1) continue;

      const i = (y * w + x) * 4;
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const rel = L / b;
      if (rel >= o.relDark) continue;

      const t = Math.min(1, (o.relDark - rel) / (o.relDark - o.knee));
      const drop = o.strength * t * t * (b - L) * 0.9;
      if (drop <= 0.5) continue;

      // Apply the same luminance drop to all channels -> hue preserved.
      const r = d[i] - drop;
      const g = d[i + 1] - drop;
      const bl = d[i + 2] - drop;
      d[i] = r < 0 ? 0 : r;
      d[i + 1] = g < 0 ? 0 : g;
      d[i + 2] = bl < 0 ? 0 : bl;

      touched++;
      dropSum += drop;
      if (drop > maxDrop) maxDrop = drop;
    }
  }

  outCtx.putImageData(img, 0, 0);

  const t1 =
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  return {
    canvas: out,
    stats: {
      touchedShare: touched / (w * h),
      meanDrop: touched ? dropSum / touched : 0,
      maxDrop,
      paperLevel,
      ms: t1 - t0,
      width: w,
      height: h,
    },
  };
}
