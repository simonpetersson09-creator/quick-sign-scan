// Quality analysis for warped A4 documents.
// All metrics run on a downscaled grayscale copy for speed.

export interface QualityReport {
  brightness: number; // 0..255 mean luminance
  contrast: number; // 0..~128 stddev of luminance
  sharpness: number; // variance of Laplacian
  inkBands: [number, number, number]; // ratio of "ink" pixels in top/mid/bottom thirds
  // Overall verdict — first failing rule wins
  verdict:
    | "ok"
    | "dark"
    | "bright"
    | "low_contrast"
    | "blurry"
    | "incomplete";
}

export interface QualityThresholds {
  minBrightness: number;
  maxBrightness: number;
  minContrast: number;
  minSharpness: number;
  minBandInk: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minBrightness: 95,
  maxBrightness: 240,
  minContrast: 28,
  minSharpness: 55,
  minBandInk: 0.003,
};

export async function analyzeDocumentQuality(
  imageDataUrl: string,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): Promise<QualityReport> {
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

  let verdict: QualityReport["verdict"] = "ok";
  if (brightness < thresholds.minBrightness) verdict = "dark";
  else if (brightness > thresholds.maxBrightness) verdict = "bright";
  else if (contrast < thresholds.minContrast) verdict = "low_contrast";
  else if (sharpness < thresholds.minSharpness) verdict = "blurry";
  else if (inkBands.some((b) => b < thresholds.minBandInk)) verdict = "incomplete";

  return { brightness, contrast, sharpness, inkBands, verdict };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export const VERDICT_MESSAGE: Record<QualityReport["verdict"], string> = {
  ok: "Dokumentet ser bra ut",
  dark: "För mörkt",
  bright: "För ljust — exponeringen är överstyrd",
  low_contrast: "För lite kontrast",
  blurry: "Bilden är suddig",
  incomplete: "Dokumentet verkar inte komplett",
};
