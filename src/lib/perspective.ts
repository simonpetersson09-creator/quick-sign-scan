// Perspective (homography) utilities for document deskewing.

export interface Point {
  x: number;
  y: number;
}

// Coefficients for a projective transform of the unit square -> arbitrary quad.
// Quad corners in order: TL, TR, BR, BL (clockwise from top-left).
//   x = (a*u + b*v + c) / (g*u + h*v + 1)
//   y = (d*u + e*v + f) / (g*u + h*v + 1)
export interface UnitSquareTransform {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
  g: number; h: number;
}

export function unitSquareToQuad(quad: [Point, Point, Point, Point]): UnitSquareTransform {
  const [p0, p1, p2, p3] = quad; // TL, TR, BR, BL
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sy = p0.y - p1.y + p2.y - p3.y;

  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) > 1e-9) {
      g = (sx * dy2 - sy * dx2) / denom;
      h = (dx1 * sy - dy1 * sx) / denom;
    }
  }
  return {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  };
}

// Warp a quadrilateral from a source canvas into a rectangular destination canvas.
// `quad` corners are in source-canvas pixel coords (TL, TR, BR, BL).
export function warpQuadToRect(
  source: HTMLCanvasElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
  quad: [Point, Point, Point, Point],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  // Render source into a canvas we can read.
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sctx = srcCanvas.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(source, 0, 0, srcW, srcH);
  const srcImg = sctx.getImageData(0, 0, srcW, srcH);
  const srcData = srcImg.data;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d")!;
  const outImg = octx.createImageData(outW, outH);
  const outData = outImg.data;

  const t = unitSquareToQuad(quad);

  for (let y = 0; y < outH; y++) {
    const v = y / outH;
    for (let x = 0; x < outW; x++) {
      const u = x / outW;
      const denom = t.g * u + t.h * v + 1;
      const sxF = (t.a * u + t.b * v + t.c) / denom;
      const syF = (t.d * u + t.e * v + t.f) / denom;

      const oi = (y * outW + x) * 4;
      if (sxF < 0 || syF < 0 || sxF >= srcW - 1 || syF >= srcH - 1) {
        outData[oi] = 255;
        outData[oi + 1] = 255;
        outData[oi + 2] = 255;
        outData[oi + 3] = 255;
        continue;
      }
      // Bilinear sample
      const x0 = Math.floor(sxF);
      const y0 = Math.floor(syF);
      const dx = sxF - x0;
      const dy = syF - y0;
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + srcW * 4;
      const i11 = i01 + 4;
      const w00 = (1 - dx) * (1 - dy);
      const w10 = dx * (1 - dy);
      const w01 = (1 - dx) * dy;
      const w11 = dx * dy;
      outData[oi] =
        srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      outData[oi + 1] =
        srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      outData[oi + 2] =
        srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      outData[oi + 3] = 255;
    }
  }

  octx.putImageData(outImg, 0, 0);
  return out;
}

// Paper enhancement: normalize lighting and stretch whites so the document
// looks like clean white paper with crisp dark ink (like a scanner output).
// Operates in-place on a canvas and returns it.
export function enhancePaper(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  // 1) Compute luminance + histogram
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    lum[j] = l;
    hist[l]++;
  }

  // 2) Find black point (5th percentile) and white point (75th percentile)
  //    Mapping 75th percentile to white aggressively whitens the paper.
  let cum = 0;
  let black = 0;
  const blackTarget = n * 0.05;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= blackTarget) { black = v; break; }
  }
  cum = 0;
  let white = 255;
  const whiteTarget = n * 0.75;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= whiteTarget) { white = v; break; }
  }
  if (white - black < 30) white = Math.min(255, black + 30);

  // 3) Apply per-pixel: stretch luminance, desaturate slightly toward gray
  const range = white - black;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let t = (v - black) / range;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    // Soft gamma for nicer midtones
    t = Math.pow(t, 0.9);
    lut[v] = (t * 255) | 0;
  }

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const oldL = lum[j];
    const newL = lut[oldL];
    // Scale RGB proportionally; clamp.
    const k = oldL === 0 ? 1 : newL / Math.max(1, oldL);
    let r = d[i] * k;
    let g = d[i + 1] * k;
    let b = d[i + 2] * k;
    // Desaturate slightly (pull 40% toward luminance) to neutralize paper tint
    r = r * 0.6 + newL * 0.4;
    g = g * 0.6 + newL * 0.4;
    b = b * 0.6 + newL * 0.4;
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}


// Find the 4 extreme corners of a bright (paper-like) region in a grayscale frame.
// Returns null if no plausible document is found.
// Coordinates returned are in the SAME pixel space as the input data (width x height).
export function findDocumentCorners(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [Point, Point, Point, Point] | null {
  // Compute mean luminance
  let sum = 0;
  const total = width * height;
  const lum = new Float32Array(total);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[j] = l;
    sum += l;
  }
  const mean = sum / total;
  const threshold = Math.max(135, mean + 18);

  // Extremal corners in 4 directions:
  // TL min(x+y), TR max(x-y), BR max(x+y), BL min(x-y)
  let tlS = Infinity, trS = -Infinity, brS = -Infinity, blS = Infinity;
  let tl: Point | null = null, tr: Point | null = null, br: Point | null = null, bl: Point | null = null;

  let bright = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (lum[y * width + x] <= threshold) continue;
      bright++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      const sPlus = x + y;
      const sMinus = x - y;
      if (sPlus < tlS) { tlS = sPlus; tl = { x, y }; }
      if (sMinus > trS) { trS = sMinus; tr = { x, y }; }
      if (sPlus > brS) { brS = sPlus; br = { x, y }; }
      if (sMinus < blS) { blS = sMinus; bl = { x, y }; }
    }
  }

  // Require enough fill and a reasonably large bounding box
  if (bright < total * 0.06) return null;
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw < width * 0.35 || bh < height * 0.35) return null;
  if (!tl || !tr || !br || !bl) return null;

  // Sanity: corners must form a convex quad with min spacing
  const minSide = Math.min(width, height) * 0.2;
  const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  if (
    dist(tl, tr) < minSide ||
    dist(tr, br) < minSide ||
    dist(br, bl) < minSide ||
    dist(bl, tl) < minSide
  ) {
    return null;
  }

  return [tl, tr, br, bl];
}

export function emaQuad(
  prev: [Point, Point, Point, Point] | null,
  next: [Point, Point, Point, Point],
  alpha: number,
): [Point, Point, Point, Point] {
  if (!prev) return next;
  return next.map((p, i) => ({
    x: prev[i].x + (p.x - prev[i].x) * alpha,
    y: prev[i].y + (p.y - prev[i].y) * alpha,
  })) as [Point, Point, Point, Point];
}

export function maxCornerDelta(
  a: [Point, Point, Point, Point],
  b: [Point, Point, Point, Point],
): number {
  let m = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    if (d > m) m = d;
  }
  return m;
}
