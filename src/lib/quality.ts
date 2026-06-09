// Quality analysis for warped A4 documents.
// All metrics run on a downscaled grayscale copy for speed.

export type QualityMode = "color" | "gray" | "bw";

export type QualityIssue =
  | "dark"
  | "bright"
  | "low_contrast"
  | "blurry"
  | "incomplete";

export type QualityVerdict = "ok" | QualityIssue;

export interface QualityReport {
  mode: QualityMode;
  brightness: number; // 0..255 mean luminance
  contrast: number; // 0..~128 stddev of luminance
  sharpness: number; // variance of Laplacian
  inkBands: [number, number, number]; // ratio of "ink" pixels in top/mid/bottom thirds
  // All failing rules, in priority order. Empty when verdict is "ok".
  issues: QualityIssue[];
  // First failing rule, or "ok". Kept for back-compat.
  verdict: QualityVerdict;
}

export interface QualityThresholds {
  // null disables that check (used for BW where the metric is meaningless).
  minBrightness: number | null;
  maxBrightness: number | null;
  minContrast: number | null;
  minSharpness: number | null;
  minBandInk: number | null;
}

// Mode-specific presets.
// Rationale: post-analysis must be measured in the same scale the user sees.
// - color: raw warped image, ink-on-paper means brightness ~140-220.
// - gray: whitened/level-stretched, paper saturates near ~210-240.
// - bw: Sauvola output is bimodal — brightness/contrast metrics are
//   meaningless, so we only keep sharpness and band-ink coverage.
export const THRESHOLDS_COLOR: QualityThresholds = {
  minBrightness: 110,
  maxBrightness: 235,
  minContrast: 22,
  minSharpness: 70,
  minBandInk: 0.005,
};

export const THRESHOLDS_GRAY: QualityThresholds = {
  minBrightness: 150,
  maxBrightness: 248,
  minContrast: 30,
  minSharpness: 70,
  minBandInk: 0.005,
};

export const THRESHOLDS_BW: QualityThresholds = {
  minBrightness: null,
  maxBrightness: null,
  minContrast: null,
  minSharpness: 70,
  minBandInk: 0.005,
};

export const DEFAULT_THRESHOLDS_BY_MODE: Record<QualityMode, QualityThresholds> = {
  color: THRESHOLDS_COLOR,
  gray: THRESHOLDS_GRAY,
  bw: THRESHOLDS_BW,
};

// Back-compat alias — earlier callers imported DEFAULT_THRESHOLDS without a mode.
export const DEFAULT_THRESHOLDS: QualityThresholds = THRESHOLDS_COLOR;

export async function analyzeDocumentQuality(
  imageDataUrl: string,
  mode: QualityMode = "color",
  thresholds?: QualityThresholds,
): Promise<QualityReport> {
  const t = thresholds ?? DEFAULT_THRESHOLDS_BY_MODE[mode];
  const img = await loadImage(imageDataUrl);
  // Downscale for fast analysis
  const targetW = 320;
  const scale = targetW / img.width;
  const w = targetW;
  const h = Math.round(img.height * scale);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const total = w * h;
  const lum = new Float32Array(total);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[j] = l;
    sum += l;
  }
  const brightness = sum / total;

  // stddev (contrast)
  let varSum = 0;
  for (let i = 0; i < total; i++) {
    const d = lum[i] - brightness;
    varSum += d * d;
  }
  const contrast = Math.sqrt(varSum / total);

  // Laplacian variance (sharpness)
  let lapMean = 0;
  let lapCount = 0;
  const lap = new Float32Array(total);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        -lum[i - w] - lum[i - 1] + 4 * lum[i] - lum[i + 1] - lum[i + w];
      lap[i] = v;
      lapMean += v;
      lapCount++;
    }
  }
  lapMean /= lapCount;
  let lapVar = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const d = lap[i] - lapMean;
      lapVar += d * d;
    }
  }
  const sharpness = lapVar / lapCount;

  // Ink density per vertical third (content presence) — pixels significantly darker than mean
  const inkThreshold = brightness - Math.max(25, contrast * 0.6);
  const bandCounts = [0, 0, 0];
  const bandTotals = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const band = y < h / 3 ? 0 : y < (2 * h) / 3 ? 1 : 2;
    for (let x = 0; x < w; x++) {
      bandTotals[band]++;
      if (lum[y * w + x] < inkThreshold) bandCounts[band]++;
    }
  }
  const inkBands: [number, number, number] = [
    bandCounts[0] / bandTotals[0],
    bandCounts[1] / bandTotals[1],
    bandCounts[2] / bandTotals[2],
  ];

  // Collect all failing rules, in fixed priority order.
  const issues: QualityIssue[] = [];
  if (t.minBrightness !== null && brightness < t.minBrightness) issues.push("dark");
  if (t.maxBrightness !== null && brightness > t.maxBrightness) issues.push("bright");
  if (t.minContrast !== null && contrast < t.minContrast) issues.push("low_contrast");
  if (t.minSharpness !== null && sharpness < t.minSharpness) issues.push("blurry");
  if (t.minBandInk !== null && inkBands.some((b) => b < t.minBandInk))
    issues.push("incomplete");

  const verdict: QualityVerdict = issues[0] ?? "ok";

  return { mode, brightness, contrast, sharpness, inkBands, issues, verdict };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export const VERDICT_MESSAGE: Record<QualityVerdict, string> = {
  ok: "Dokumentet ser bra ut",
  dark: "För mörkt",
  bright: "För ljust — exponeringen är överstyrd",
  low_contrast: "För lite kontrast",
  blurry: "Bilden är suddig",
  incomplete: "Dokumentet verkar inte komplett",
};
