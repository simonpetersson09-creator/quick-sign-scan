// Local illumination correction ("localIllum").
//
// Purpose: remove slow, low-frequency luminance variation caused by paper
// folds/creases and uneven lighting, WITHOUT touching text, thin lines,
// signatures, stamps or colour marks.
//
// Placement in the pipeline: after grayWorldWhiteBalance, before
// whitenBackground. It only normalises the illumination field so that the
// downstream flat-field whitening sees an evenly lit page.
//
// Algorithm (per capture, single pass):
//   1. Downscale to a small proxy (<= 256 px long edge) for the illumination
//      estimate — the field we want is low-frequency by definition.
//   2. Estimate the paper background: ink pixels are masked out (they are
//      much darker than the local paper level) and inpainted from their
//      neighbourhood so glyph darkness never bleeds into the field.
//   3. Heavy box blur (sigma ~ long edge / 12, run as 3 box passes) → the
//      illumination map I(x,y).
//   4. Gain g = target / I, clamped to [1/MAX_GAIN, MAX_GAIN] so the maximum
//      correction is bounded and weak text can never be erased.
//   5. Ink protection: the gain is attenuated on dark pixels (full effect on
//      paper, tapering to INK_MIN_WEIGHT on ink) so stroke density is kept.
//
// Cost: ~O(N) with a 256 px proxy for the map + one full-res multiply pass.
// Typical A4 capture (~2000x2800) measures a few ms plus the getImageData /
// putImageData roundtrip. Memory: one Float32 proxy plane + one ImageData.

export interface LocalIllumOptions {
  /** Long-edge divisor for the blur sigma. Larger = smoother field. */
  sigmaDivisor?: number;
  /** Max multiplicative correction (both directions). */
  maxGain?: number;
  /** Luminance at/above which a pixel is treated as pure paper. */
  paperL?: number;
  /** Luminance at/below which a pixel is treated as pure ink. */
  inkL?: number;
  /** Residual gain weight applied to pure-ink pixels. */
  inkMinWeight?: number;
  /** Long edge of the downscaled illumination proxy. */
  proxyLongEdge?: number;
}

export interface LocalIllumStats {
  /** Fold proxy: min/median of the illumination map (1 = perfectly flat). */
  foldProxyBefore: number;
  /** Same measure recomputed on the corrected image. */
  foldProxyAfter: number;
  /** Illumination map median (paper level estimate, 0..255). */
  paperLevel: number;
  /** Share of pixels with L < 200 (ink-ish), before/after. */
  inkShareBefore: number;
  inkShareAfter: number;
  /** Largest applied gain in either direction. */
  maxAppliedGain: number;
  minAppliedGain: number;
  ms: number;
  width: number;
  height: number;
}

export interface LocalIllumResult {
  canvas: HTMLCanvasElement;
  stats: LocalIllumStats;
}

// Proposed starting parameters.
export const LOCAL_ILLUM_DEFAULTS: Required<LocalIllumOptions> = {
  sigmaDivisor: 12,
  maxGain: 1.25,
  paperL: 200,
  inkL: 120,
  inkMinWeight: 0.25,
  proxyLongEdge: 256,
};

function boxBlurPlane(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1);
      const add = src[row + Math.min(w - 1, x + r + 1)];
      const sub = src[row + Math.max(0, x - r)];
      sum += add - sub;
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      sum += add - sub;
    }
  }
  return out;
}

function medianOf(values: Float32Array): number {
  const copy = Array.from(values);
  copy.sort((a, b) => a - b);
  return copy[Math.floor(copy.length / 2)] ?? 0;
}

function foldProxy(plane: Float32Array): number {
  const med = medianOf(plane);
  if (med <= 0) return 1;
  let min = Infinity;
  for (let i = 0; i < plane.length; i++) if (plane[i] < min) min = plane[i];
  return min / med;
}

/**
 * Corrects slow illumination variation (folds, shadows) on a warped document.
 * Returns a NEW canvas; the input canvas is left untouched.
 */
export function correctLocalIllumination(
  canvas: HTMLCanvasElement,
  options: LocalIllumOptions = {},
): LocalIllumResult {
  const o = { ...LOCAL_ILLUM_DEFAULTS, ...options };
  const t0 =
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

  const w = canvas.width;
  const h = canvas.height;

  // --- 1. proxy for the illumination estimate -----------------------------
  const scale = Math.min(1, o.proxyLongEdge / Math.max(w, h));
  const pw = Math.max(8, Math.round(w * scale));
  const ph = Math.max(8, Math.round(h * scale));
  const proxy = document.createElement("canvas");
  proxy.width = pw;
  proxy.height = ph;
  const pctx = proxy.getContext("2d", { willReadFrequently: true })!;
  pctx.drawImage(canvas, 0, 0, pw, ph);
  const pdata = pctx.getImageData(0, 0, pw, ph).data;

  const lum = new Float32Array(pw * ph);
  for (let i = 0, j = 0; i < pdata.length; i += 4, j++) {
    lum[j] = 0.299 * pdata[i] + 0.587 * pdata[i + 1] + 0.114 * pdata[i + 2];
  }

  // --- 2. mask ink and inpaint from the neighbourhood ---------------------
  const paperMedian = medianOf(lum);
  const inkCut = paperMedian * 0.82;
  const coarse = boxBlurPlane(lum, pw, ph, Math.max(2, Math.round(Math.max(pw, ph) / 40)));
  const bg = new Float32Array(pw * ph);
  for (let i = 0; i < bg.length; i++) {
    bg[i] = lum[i] < inkCut ? Math.max(lum[i], coarse[i]) : lum[i];
  }

  // --- 3. heavy blur → illumination map -----------------------------------
  const sigma = Math.max(pw, ph) / o.sigmaDivisor;
  const r = Math.max(1, Math.round(sigma * 0.6));
  let illum = bg;
  for (let pass = 0; pass < 3; pass++) illum = boxBlurPlane(illum, pw, ph, r);

  const target = medianOf(illum);
  const foldProxyBefore = foldProxy(illum);

  // --- 4/5. apply bounded, ink-protected gain at full resolution ----------
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const full = ctx.getImageData(0, 0, w, h);
  const d = full.data;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d", { willReadFrequently: true })!;

  const invMax = 1 / o.maxGain;
  let maxAppliedGain = 1;
  let minAppliedGain = 1;
  let inkBefore = 0;
  let inkAfter = 0;
  const inkSpan = Math.max(1, o.paperL - o.inkL);

  for (let y = 0; y < h; y++) {
    // bilinear-free nearest sample of the (very smooth) illumination map
    const py = Math.min(ph - 1, (y * ph / h) | 0);
    for (let x = 0; x < w; x++) {
      const px = Math.min(pw - 1, (x * pw / w) | 0);
      const I = illum[py * pw + px] || target;
      let g = target / (I || 1);
      if (g > o.maxGain) g = o.maxGain;
      else if (g < invMax) g = invMax;

      const i = (y * w + x) * 4;
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (L < 200) inkBefore++;

      // ink protection: full gain on paper, tapered on dark strokes
      let wgt = (L - o.inkL) / inkSpan;
      wgt = wgt < 0 ? 0 : wgt > 1 ? 1 : wgt;
      const gEff = 1 + (g - 1) * (o.inkMinWeight + (1 - o.inkMinWeight) * wgt);

      if (gEff > maxAppliedGain) maxAppliedGain = gEff;
      if (gEff < minAppliedGain) minAppliedGain = gEff;

      const rr = d[i] * gEff;
      const gg = d[i + 1] * gEff;
      const bb = d[i + 2] * gEff;
      d[i] = rr > 255 ? 255 : rr;
      d[i + 1] = gg > 255 ? 255 : gg;
      d[i + 2] = bb > 255 ? 255 : bb;
      if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 200) inkAfter++;
    }
  }

  octx.putImageData(full, 0, 0);

  // --- measurement: recompute the fold proxy on the corrected image -------
  pctx.clearRect(0, 0, pw, ph);
  pctx.drawImage(out, 0, 0, pw, ph);
  const adata = pctx.getImageData(0, 0, pw, ph).data;
  const alum = new Float32Array(pw * ph);
  for (let i = 0, j = 0; i < adata.length; i += 4, j++) {
    alum[j] = 0.299 * adata[i] + 0.587 * adata[i + 1] + 0.114 * adata[i + 2];
  }
  const acoarse = boxBlurPlane(alum, pw, ph, Math.max(2, Math.round(Math.max(pw, ph) / 40)));
  const abg = new Float32Array(pw * ph);
  for (let i = 0; i < abg.length; i++) {
    abg[i] = alum[i] < paperMedian * 0.82 ? Math.max(alum[i], acoarse[i]) : alum[i];
  }
  let aillum = abg;
  for (let pass = 0; pass < 3; pass++) aillum = boxBlurPlane(aillum, pw, ph, r);
  const foldProxyAfter = foldProxy(aillum);

  const t1 =
    typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

  const total = w * h;
  return {
    canvas: out,
    stats: {
      foldProxyBefore,
      foldProxyAfter,
      paperLevel: target,
      inkShareBefore: inkBefore / total,
      inkShareAfter: inkAfter / total,
      maxAppliedGain,
      minAppliedGain,
      ms: t1 - t0,
      width: w,
      height: h,
    },
  };
}
