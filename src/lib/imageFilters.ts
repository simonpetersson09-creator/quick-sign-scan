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
  const lumRaw = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    lumRaw[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }

  // 3x3 box-blur — kills sensor/JPEG noise that otherwise becomes black
  // speckles in supposedly white paper regions.
  const lum = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y1 = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < w - 1 ? x + 1 : w - 1;
      let s = 0;
      let c = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          s += lumRaw[yy * w + xx];
          c++;
        }
      }
      lum[y * w + x] = (s / c) | 0;
    }
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

  // Larger window — long-edge / 24 covers ~2 text-line heights, giving a
  // more stable local mean and preventing thin text from getting averaged
  // into the surrounding white margin.
  const r = Math.max(12, Math.round(Math.max(w, h) / 24));
  const k = 0.2;   // standard Sauvola value — 0.34 was too aggressive
  const R = 128;
  // Pixels in regions with std below this are treated as uniform background
  // (forced white). Eliminates speckle noise in blank paper areas.
  const STD_FLOOR = 8;
  // Even when std is high enough, a pixel that's almost as bright as the
  // local mean is background, not ink. Keeps speckles white near edges
  // of text where std spikes.
  const REL_WHITE = 0.94;

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
      const j = y * w + x;
      const px = lum[j];
      let out: number;
      if (std < STD_FLOOR) {
        // Uniform region — almost certainly background paper.
        out = 255;
      } else if (px > mean * REL_WHITE) {
        // Brighter than ~94% of local mean → background.
        out = 255;
      } else {
        const T = mean * (1 + k * (std / R - 1));
        out = px > T ? 255 : 0;
      }
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
