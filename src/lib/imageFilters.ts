// Image filters for the preview screen. Operates on data URLs and returns
// new data URLs so the calling component can swap them in directly.

export type FilterMode = "color" | "gray" | "bw";

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function toCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return canvas;
}

function applyGrayscale(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = L;
    d[i + 1] = L;
    d[i + 2] = L;
  }
  ctx.putImageData(img, 0, 0);
}

// Sauvola adaptive binarization using integral images for O(1) per-pixel
// window stats. Yields crisp black-text-on-white-paper output even when the
// page has uneven lighting that a global threshold would mangle.
function applySauvola(canvas: HTMLCanvasElement) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  // Luminance plane
  const lum = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    lum[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }

  // Integral images of lum and lum² for fast windowed mean / std.
  const W = w + 1;
  const H = h + 1;
  const sat = new Float64Array(W * H);
  const sat2 = new Float64Array(W * H);
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    let rowSum2 = 0;
    for (let x = 1; x <= w; x++) {
      const v = lum[(y - 1) * w + (x - 1)];
      rowSum += v;
      rowSum2 += v * v;
      const idx = y * W + x;
      sat[idx] = sat[idx - W] + rowSum;
      sat2[idx] = sat2[idx - W] + rowSum2;
    }
  }

  // Window size — long-edge / 30 gives roughly text-line-height scale.
  const r = Math.max(8, Math.round(Math.max(w, h) / 30));
  const k = 0.34; // Sauvola parameter — higher = more aggressive
  const R = 128;  // max std-dev for 8-bit images

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const area = (y1 - y0) * (x1 - x0);
      const sum =
        sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
      const sumSq =
        sat2[y1 * W + x1] - sat2[y0 * W + x1] - sat2[y1 * W + x0] + sat2[y0 * W + x0];
      const mean = sum / area;
      const variance = Math.max(0, sumSq / area - mean * mean);
      const std = Math.sqrt(variance);
      const T = mean * (1 + k * (std / R - 1));
      const j = y * w + x;
      const out = lum[j] > T ? 255 : 0;
      const i = j * 4;
      d[i] = out;
      d[i + 1] = out;
      d[i + 2] = out;
    }
  }

  ctx.putImageData(img, 0, 0);
}

export async function applyFilter(
  dataUrl: string,
  mode: FilterMode,
): Promise<string> {
  if (mode === "color") return dataUrl;
  const img = await loadImage(dataUrl);
  const canvas = toCanvas(img);
  if (mode === "gray") applyGrayscale(canvas);
  else if (mode === "bw") applySauvola(canvas);
  return canvas.toDataURL("image/png");
}
