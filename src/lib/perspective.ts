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
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

export function unitSquareToQuad(quad: [Point, Point, Point, Point]): UnitSquareTransform {
  const [p0, p1, p2, p3] = quad; // TL, TR, BR, BL
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sy = p0.y - p1.y + p2.y - p3.y;

  let g = 0,
    h = 0;
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
        srcData[i00 + 1] * w00 +
        srcData[i10 + 1] * w10 +
        srcData[i01 + 1] * w01 +
        srcData[i11 + 1] * w11;
      outData[oi + 2] =
        srcData[i00 + 2] * w00 +
        srcData[i10 + 2] * w10 +
        srcData[i01 + 2] * w01 +
        srcData[i11 + 2] * w11;
      outData[oi + 3] = 255;
    }
  }

  octx.putImageData(outImg, 0, 0);
  return out;
}

// Paper enhancement: shading-correct (remove shadows / uneven lighting),
// then stretch whites and crisp up ink so the result looks like a clean
// office-scanner output (white paper, dark text, no background tones).
export function enhancePaper(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  // 1) Luminance plane
  const lum = new Float32Array(n);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    lum[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  // 2) Estimate per-pixel background illumination with a wide separable
  //    box blur. Radius ~ 1/14 of the long edge captures shadows/gradients
  //    without smearing letters into the estimate.
  const radius = Math.max(8, Math.round(Math.max(w, h) / 14));
  const bg = boxBlur(lum, w, h, radius);

  // 3) Global white reference from the upper percentile of the background.
  const sample = new Float32Array(bg);
  sample.sort();
  const whiteRef = Math.max(140, sample[Math.floor(n * 0.92)] || 200);

  // 4) Shading correction: per-pixel multiplier whiteRef / bg flattens
  //    shadows and uneven lighting across the page.
  const corrected = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = Math.max(40, bg[i]);
    const c = lum[i] * (whiteRef / b);
    corrected[i] = c > 255 ? 255 : c;
  }

  // 5) Black/white points from the corrected histogram.
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[corrected[i] | 0]++;
  let cum = 0;
  let black = 0;
  const blackTarget = n * 0.004;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= blackTarget) {
      black = v;
      break;
    }
  }
  cum = 0;
  let white = 255;
  const whiteTarget = n * 0.6;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= whiteTarget) {
      white = v;
      break;
    }
  }
  if (black > 85) black = 85;
  if (white < black + 60) white = Math.min(255, black + 60);

  // 6) Tone curve: stretch, gamma (kills gray smudges), soft S-curve for ink.
  const range = white - black;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let t = (v - black) / range;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    t = Math.pow(t, 1.45);
    t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    lut[v] = (t * 255) | 0;
  }

  // 7) Apply: shading factor × tone-curve ratio, then strong desaturation.
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const k = whiteRef / Math.max(40, bg[j]);
    const L = corrected[j] | 0;
    const newL = lut[L];
    const ratio = L === 0 ? 1 : newL / Math.max(1, L);
    const m = k * ratio;
    let r = d[i] * m;
    let g = d[i + 1] * m;
    let b = d[i + 2] * m;
    r = r * 0.15 + newL * 0.85;
    g = g * 0.15 + newL * 0.85;
    b = b * 0.15 + newL * 0.85;
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

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const x = k < 0 ? 0 : k >= w ? w - 1 : k;
      sum += src[base + x];
    }
    for (let x = 0; x < w; x++) {
      tmp[base + x] = sum / win;
      const addX = Math.min(w - 1, x + r + 1);
      const subX = Math.max(0, x - r);
      sum += src[base + addX] - src[base + subX];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const y = k < 0 ? 0 : k >= h ? h - 1 : k;
      sum += tmp[y * w + x];
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const addY = Math.min(h - 1, y + r + 1);
      const subY = Math.max(0, y - r);
      sum += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return out;
}

export interface DocumentDetection {
  corners: [Point, Point, Point, Point];
  a4Ratio: number;
  confidence: number;
  debug: {
    edgeThreshold: number;
    threshold: number;
    candidateCount: number;
    a4Score: number;
    edgeScore: number;
    brightnessScore: number;
    textScore: number;
    areaRatio: number;
    sideDeviation: number;
    perspectiveError: number;
    polygonFill: number;
  };
}

const A4_RATIO = Math.SQRT2;
export const MIN_DOCUMENT_CONFIDENCE = 0.22;

// Detect the document from its contour: isolate candidate paper, extract the
// outer boundary, reduce the convex contour to four real corners, then reject
// shapes with curved sides, non-A4 proportions, or extreme perspective.
export function detectDocumentQuad(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DocumentDetection | null {
  const total = width * height;
  const lum = new Uint8ClampedArray(total);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
    lum[j] = l;
    hist[l]++;
  }

  const blurred = gaussianBlur(lum, width, height);
  const { edges, highThreshold } = cannyEdges(blurred, width, height);
  const connectedEdges = closeEdgeGaps(edges, width, height);
  const components = edgeComponents(connectedEdges, width, height);
  const brightThreshold = Math.max(95, Math.min(225, otsuThreshold(hist, total) + 12));
  const paperMask = buildBrightPaperMask(lum, width, height, brightThreshold);
  components.push(...edgeComponents(maskBoundary(paperMask, width, height), width, height));
  let best: DocumentDetection | null = null;
  let bestScore = 0;
  let candidateCount = 0;

  for (const component of components) {
    if (component.pixels.length < total * 0.0008) continue;
    if (component.maxX - component.minX < width * 0.1) continue;
    if (component.maxY - component.minY < height * 0.1) continue;

    const hull = convexHull(component.points);
    if (hull.length < 4) continue;

    const candidateQuads = approximateHullQuads(hull);

    // Fallback: always evaluate the component's axis-aligned bounding rect
    // as a quad. This guarantees we still produce 4 corners when the hull
    // has rounded/shadowy edges that the RDP+reduce path fails to simplify
    // cleanly. Worse-fit candidates get filtered by evaluateEdgeQuad.
    const bboxQuad: [Point, Point, Point, Point] = orderQuad([
      { x: component.minX, y: component.minY },
      { x: component.maxX, y: component.minY },
      { x: component.maxX, y: component.maxY },
      { x: component.minX, y: component.maxY },
    ]);
    candidateQuads.push(bboxQuad);

    for (const quad of candidateQuads) {
      candidateCount++;
      const detection = evaluateEdgeQuad({
        quad,
        hull,
        lum,
        edges,
        width,
        height,
        frameArea: total,
        edgeThreshold: highThreshold,
        candidateCount,
      });
      if (!detection) continue;
      const score = detection.confidence;
      if (score > bestScore) {
        bestScore = score;
        best = detection;
      }
    }
  }

  if (best) {
    best.debug.candidateCount = candidateCount;
  }
  return best && best.confidence >= MIN_DOCUMENT_CONFIDENCE ? best : null;
}

// Backwards-compatible API for camera overlay/capture.
export function findDocumentCorners(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [Point, Point, Point, Point] | null {
  return detectDocumentQuad(data, width, height)?.corners ?? null;
}

function gaussianBlur(lum: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(lum.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] =
        (lum[i - width - 1] +
          2 * lum[i - width] +
          lum[i - width + 1] +
          2 * lum[i - 1] +
          4 * lum[i] +
          2 * lum[i + 1] +
          lum[i + width - 1] +
          2 * lum[i + width] +
          lum[i + width + 1]) /
        16;
    }
  }
  return out;
}

function cannyEdges(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
): { edges: Uint8Array; highThreshold: number } {
  const total = width * height;
  const mag = new Float32Array(total);
  const dir = new Uint8Array(total);
  const nonMax = new Float32Array(total);
  const magnitudes: number[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -lum[i - width - 1] -
        2 * lum[i - 1] -
        lum[i + width - 1] +
        lum[i - width + 1] +
        2 * lum[i + 1] +
        lum[i + width + 1];
      const gy =
        -lum[i - width - 1] -
        2 * lum[i - width] -
        lum[i - width + 1] +
        lum[i + width - 1] +
        2 * lum[i + width] +
        lum[i + width + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > 8) magnitudes.push(m);
      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      dir[i] = angle < 22.5 || angle >= 157.5 ? 0 : angle < 67.5 ? 45 : angle < 112.5 ? 90 : 135;
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = mag[i];
      let a = i - 1;
      let b = i + 1;
      if (dir[i] === 45) {
        a = i - width + 1;
        b = i + width - 1;
      } else if (dir[i] === 90) {
        a = i - width;
        b = i + width;
      } else if (dir[i] === 135) {
        a = i - width - 1;
        b = i + width + 1;
      }
      if (m >= mag[a] && m >= mag[b]) nonMax[i] = m;
    }
  }

  magnitudes.sort((a, b) => a - b);
  const highThreshold = Math.max(22, magnitudes[Math.floor(magnitudes.length * 0.78)] ?? 32);
  const lowThreshold = highThreshold * 0.38;
  const edges = new Uint8Array(total);
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);

  for (let i = 0; i < total; i++) {
    if (seen[i] || nonMax[i] < highThreshold) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    while (sp > 0) {
      const idx = stack[--sp];
      edges[idx] = 1;
      const y = (idx / width) | 0;
      const x = idx - y * width;
      for (let yy = Math.max(1, y - 1); yy <= Math.min(height - 2, y + 1); yy++) {
        for (let xx = Math.max(1, x - 1); xx <= Math.min(width - 2, x + 1); xx++) {
          const ni = yy * width + xx;
          if (!seen[ni] && nonMax[ni] >= lowThreshold) {
            seen[ni] = 1;
            stack[sp++] = ni;
          }
        }
      }
    }
  }

  return { edges, highThreshold };
}

function closeEdgeGaps(edges: Uint8Array, width: number, height: number): Uint8Array {
  let mask = dilateMask(edges, width, height);
  mask = dilateMask(mask, width, height);
  return erodeMask(mask, width, height);
}

function buildBrightPaperMask(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const mask = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) mask[i] = lum[i] >= threshold ? 1 : 0;
  let closed: Uint8Array<ArrayBufferLike> = mask;
  for (let i = 0; i < 3; i++) closed = dilateMask(closed, width, height);
  for (let i = 0; i < 3; i++) closed = erodeMask(closed, width, height);
  return dilateMask(erodeMask(closed, width, height), width, height);
}

function maskBoundary(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) out[i] = 1;
    }
  }
  return out;
}

interface EdgeComponent {
  pixels: number[];
  points: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function edgeComponents(mask: Uint8Array, width: number, height: number): EdgeComponent[] {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const components: EdgeComponent[] = [];

  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    const pixels: number[] = [];
    const points: Point[] = [];
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1,
      sp = 0;
    stack[sp++] = start;
    visited[start] = 1;

    while (sp > 0) {
      const idx = stack[--sp];
      pixels.push(idx);
      const y = (idx / width) | 0;
      const x = idx - y * width;
      points.push({ x, y });
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (let yy = Math.max(1, y - 1); yy <= Math.min(height - 2, y + 1); yy++) {
        for (let xx = Math.max(1, x - 1); xx <= Math.min(width - 2, x + 1); xx++) {
          const ni = yy * width + xx;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack[sp++] = ni;
          }
        }
      }
    }

    components.push({ pixels, points, minX, minY, maxX, maxY });
  }

  return components.sort((a, b) => b.pixels.length - a.pixels.length).slice(0, 24);
}

function approximateHullQuads(hull: Point[]): [Point, Point, Point, Point][] {
  const quads: [Point, Point, Point, Point][] = [];
  const perimeter = polygonPerimeter(hull);
  const epsilons = [0.012, 0.02, 0.032, 0.05, 0.075, 0.1].map((v) => v * perimeter);

  for (const epsilon of epsilons) {
    const approx = approximateClosedPolygon(hull, epsilon);
    if (approx.length === 4) quads.push(orderQuad([approx[0], approx[1], approx[2], approx[3]]));
    else if (approx.length > 4 && approx.length <= 10) {
      const reduced = reduceHullToQuad(approx);
      if (reduced) quads.push(orderQuad(reduced));
    }
  }

  const reduced = reduceHullToQuad(hull);
  if (reduced) quads.push(orderQuad(reduced));
  return dedupeQuads(quads);
}

function approximateClosedPolygon(points: Point[], epsilon: number): Point[] {
  if (points.length <= 4) return points;
  let a = 0;
  let b = 1;
  let best = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = dist(points[i], points[j]);
      if (d > best) {
        best = d;
        a = i;
        b = j;
      }
    }
  }
  const pathA = cyclicSlice(points, a, b);
  const pathB = cyclicSlice(points, b, a);
  const simplifiedA = rdp(pathA, epsilon);
  const simplifiedB = rdp(pathB, epsilon);
  return simplifiedA.concat(simplifiedB.slice(1, -1));
}

function cyclicSlice(points: Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let i = from;
  while (true) {
    out.push(points[i]);
    if (i === to) break;
    i = (i + 1) % points.length;
  }
  return out;
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  let maxD = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= epsilon) return [points[0], points[points.length - 1]];
  return rdp(points.slice(0, index + 1), epsilon)
    .slice(0, -1)
    .concat(rdp(points.slice(index), epsilon));
}

function dedupeQuads(quads: [Point, Point, Point, Point][]): [Point, Point, Point, Point][] {
  const keys = new Set<string>();
  const out: [Point, Point, Point, Point][] = [];
  for (const quad of quads) {
    const key = quad.map((p) => `${Math.round(p.x / 2)},${Math.round(p.y / 2)}`).join("|");
    if (!keys.has(key)) {
      keys.add(key);
      out.push(quad);
    }
  }
  return out;
}

function polygonPerimeter(points: Point[]): number {
  let p = 0;
  for (let i = 0; i < points.length; i++) p += dist(points[i], points[(i + 1) % points.length]);
  return p;
}

function evaluateEdgeQuad(args: {
  quad: [Point, Point, Point, Point];
  hull: Point[];
  lum: Uint8ClampedArray;
  edges: Uint8Array;
  width: number;
  height: number;
  frameArea: number;
  edgeThreshold: number;
  candidateCount: number;
}): DocumentDetection | null {
  const { hull, lum, edges, width, height, frameArea, edgeThreshold, candidateCount } = args;
  if (!isConvexQuad(args.quad)) return null;
  const ordered = orderQuad(args.quad);
  const minX = Math.min(...ordered.map((p) => p.x));
  const minY = Math.min(...ordered.map((p) => p.y));
  const maxX = Math.max(...ordered.map((p) => p.x));
  const maxY = Math.max(...ordered.map((p) => p.y));
  const margin = 20;
  const edgeMargin = 3;

  if (
    minX <= edgeMargin ||
    minY <= edgeMargin ||
    maxX >= width - 1 - edgeMargin ||
    maxY >= height - 1 - edgeMargin
  )
    return null;
  if (minX < margin && minY < margin && maxX > width - margin && maxY > height - margin)
    return null;

  const area = Math.abs(polygonArea(ordered));
  const areaRatio = area / frameArea;
  if (areaRatio < 0.04 || areaRatio > 0.95) return null;

  const top = dist(ordered[0], ordered[1]);
  const right = dist(ordered[1], ordered[2]);
  const bottom = dist(ordered[2], ordered[3]);
  const left = dist(ordered[3], ordered[0]);
  const avgW = (top + bottom) / 2;
  const avgH = (left + right) / 2;
  const shortSide = Math.max(1, Math.min(avgW, avgH));
  const a4Ratio = Math.max(avgW, avgH) / shortSide;
  const ratioError = Math.abs(a4Ratio - A4_RATIO) / A4_RATIO;
  const perspectiveError =
    Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) -
    1 +
    Math.max(left, right) / Math.max(1, Math.min(left, right)) -
    1;
  const sideDeviation = contourSideDeviation(hull, ordered) / shortSide;
  const bboxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  const polygonFill = bboxArea / Math.max(1, area);

  // Relaxed gates — accept tilted A4 from a phone where ratio, perspective
  // and side curvature are messier than the ideal scan-on-desk shot.
  if (ratioError > 0.7) return null;
  if (perspectiveError > 2.2) return null;
  if (sideDeviation > 0.16) return null;
  if (polygonFill < 0.55 || polygonFill > 1.8) return null;

  const stats = polygonImageStats(ordered, lum, width, height);
  const edgeScore = quadEdgeSupport(ordered, edges, width, height);
  const a4Score = clamp01(1 - ratioError / 0.7);
  const straightScore = clamp01(1 - sideDeviation / 0.16);
  const perspectiveScore = clamp01(1 - perspectiveError / 2.2);
  const brightnessScore = clamp01((stats.mean - 80) / 130);
  const textScore = clamp01(stats.darkRatio / 0.055);
  const areaScore =
    areaRatio <= 0.7 ? clamp01((areaRatio - 0.03) / 0.18) : clamp01((0.98 - areaRatio) / 0.2);
  const confidence =
    0.32 * edgeScore +
    0.16 * straightScore +
    0.12 * a4Score +
    0.14 * brightnessScore +
    0.08 * textScore +
    0.1 * perspectiveScore +
    0.08 * areaScore;

  // Very loose final gate — anything with even weak edge support and
  // some brightness counts as a candidate; confidence ranks them.
  if (edgeScore < 0.08) return null;

  return {
    corners: ordered,
    a4Ratio,
    confidence,
    debug: {
      edgeThreshold,
      threshold: edgeThreshold,
      candidateCount,
      a4Score,
      edgeScore,
      brightnessScore,
      textScore,
      areaRatio,
      sideDeviation,
      perspectiveError,
      polygonFill,
    },
  };
}

function polygonImageStats(
  quad: [Point, Point, Point, Point],
  lum: Uint8ClampedArray,
  width: number,
  height: number,
): { mean: number; darkRatio: number } {
  const minX = Math.max(1, Math.floor(Math.min(...quad.map((p) => p.x))));
  const minY = Math.max(1, Math.floor(Math.min(...quad.map((p) => p.y))));
  const maxX = Math.min(width - 2, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const maxY = Math.min(height - 2, Math.ceil(Math.max(...quad.map((p) => p.y))));
  let sum = 0;
  let count = 0;
  const samples: number[] = [];

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      if (!pointInPolygon({ x, y }, quad)) continue;
      const value = lum[y * width + x];
      sum += value;
      count++;
      samples.push(value);
    }
  }

  const mean = count ? sum / count : 0;
  let dark = 0;
  const darkCutoff = Math.max(35, mean - 45);
  for (const value of samples) {
    if (value < darkCutoff) dark++;
  }
  return { mean, darkRatio: count ? dark / count : 0 };
}

function quadEdgeSupport(
  quad: [Point, Point, Point, Point],
  edges: Uint8Array,
  width: number,
  height: number,
): number {
  let hits = 0;
  let samples = 0;
  for (let side = 0; side < 4; side++) {
    const a = quad[side];
    const b = quad[(side + 1) % 4];
    const steps = Math.max(8, Math.ceil(dist(a, b) / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      samples++;
      let found = false;
      for (let yy = Math.max(1, y - 2); yy <= Math.min(height - 2, y + 2) && !found; yy++) {
        for (let xx = Math.max(1, x - 2); xx <= Math.min(width - 2, x + 2); xx++) {
          if (edges[yy * width + xx]) {
            found = true;
            break;
          }
        }
      }
      if (found) hits++;
    }
  }
  return hits / Math.max(1, samples);
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / Math.max(1e-6, b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

function otsuThreshold(hist: Uint32Array, total: number): number {
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0;
  let sumB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

function percentileThreshold(hist: Uint32Array, total: number, percentile: number): number {
  const target = total * percentile;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 127;
}

function uniqueThresholds(values: number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    const threshold = Math.max(45, Math.min(235, Math.round(value)));
    if (!out.some((existing) => Math.abs(existing - threshold) < 8)) {
      out.push(threshold);
    }
  }
  return out;
}

function erodeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (
        mask[i] &&
        mask[i - 1] &&
        mask[i + 1] &&
        mask[i - width] &&
        mask[i + width] &&
        mask[i - width - 1] &&
        mask[i - width + 1] &&
        mask[i + width - 1] &&
        mask[i + width + 1]
      )
        out[i] = 1;
    }
  }
  return out;
}

function dilateMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (
        mask[i] ||
        mask[i - 1] ||
        mask[i + 1] ||
        mask[i - width] ||
        mask[i + width] ||
        mask[i - width - 1] ||
        mask[i - width + 1] ||
        mask[i + width - 1] ||
        mask[i + width + 1]
      )
        out[i] = 1;
    }
  }
  return out;
}

function pushIf(
  mask: Uint8Array,
  visited: Uint8Array,
  stack: Int32Array,
  sp: number,
  idx: number,
): number {
  if (mask[idx] && !visited[idx]) {
    visited[idx] = 1;
    stack[sp] = idx;
    return sp + 1;
  }
  return sp;
}

function evaluateContour(
  contour: Point[],
  componentArea: number,
  bboxArea: number,
  frameArea: number,
  threshold: number,
): DocumentDetection | null {
  if (contour.length < 24) return null;
  const hull = convexHull(contour);
  if (hull.length < 4) return null;
  const quad = reduceHullToQuad(hull);
  if (!quad || !isConvexQuad(quad)) return null;
  const ordered = orderQuad(quad);
  const area = Math.abs(polygonArea(ordered));
  if (area < frameArea * 0.04) return null;

  const top = dist(ordered[0], ordered[1]);
  const right = dist(ordered[1], ordered[2]);
  const bottom = dist(ordered[2], ordered[3]);
  const left = dist(ordered[3], ordered[0]);
  const avgW = (top + bottom) / 2;
  const avgH = (left + right) / 2;
  const shortSide = Math.max(1, Math.min(avgW, avgH));
  const a4Ratio = Math.max(avgW, avgH) / shortSide;
  const ratioError = Math.abs(a4Ratio - A4_RATIO) / A4_RATIO;
  const perspectiveError =
    Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) -
    1 +
    Math.max(left, right) / Math.max(1, Math.min(left, right)) -
    1;
  // Measure straightness against the convex hull only — the raw contour
  // contains noise from text/edge fuzz that would falsely inflate deviation.
  const sideDeviation = contourSideDeviation(hull, ordered) / shortSide;
  // Fill ratio uses bbox (not pixel count) — robust to dark ink inside paper.
  const polygonFill = bboxArea / Math.max(1, area);

  // A real A4 sheet can project close to square when photographed at an angle,
  // so ratio validation must be broad. Straight edges and bounding-box fill
  // are stronger signals; the final warp always outputs a true A4 rectangle.
  if (ratioError > 0.55) return null;
  if (perspectiveError > 1.5) return null;
  if (sideDeviation > 0.08) return null;
  if (polygonFill < 0.55 || polygonFill > 1.45) return null;

  const ratioScore = clamp01(1 - ratioError / 0.55);
  const straightScore = clamp01(1 - sideDeviation / 0.08);
  const fillScore =
    polygonFill >= 0.85 && polygonFill <= 1.15 ? 1 : clamp01(1 - Math.abs(polygonFill - 1) / 0.45);
  const perspectiveScore = clamp01(1 - perspectiveError / 1.5);
  const confidence =
    0.4 * straightScore + 0.15 * ratioScore + 0.2 * fillScore + 0.25 * perspectiveScore;

  return {
    corners: ordered,
    a4Ratio,
    confidence,
    debug: {
      edgeThreshold: threshold,
      threshold,
      candidateCount: 0,
      a4Score: ratioScore,
      edgeScore: 0,
      brightnessScore: 0,
      textScore: 0,
      areaRatio: area / frameArea,
      sideDeviation,
      perspectiveError,
      polygonFill,
    },
  };
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function reduceHullToQuad(hull: Point[]): [Point, Point, Point, Point] | null {
  const pts = hull.slice();
  while (pts.length > 4) {
    let bestIndex = -1;
    let bestLoss = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const loss = Math.abs(cross(prev, curr, next));
      if (loss < bestLoss) {
        bestLoss = loss;
        bestIndex = i;
      }
    }
    pts.splice(bestIndex, 1);
  }
  return pts.length === 4 ? [pts[0], pts[1], pts[2], pts[3]] : null;
}

function orderQuad(quad: [Point, Point, Point, Point]): [Point, Point, Point, Point] {
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
  const cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  let ordered = [...quad].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  if (polygonArea(ordered) < 0) ordered = ordered.reverse();
  let tlIndex = 0;
  let best = Infinity;
  ordered.forEach((p, i) => {
    const score = p.x + p.y;
    if (score < best) {
      best = score;
      tlIndex = i;
    }
  });
  const rotated = ordered.slice(tlIndex).concat(ordered.slice(0, tlIndex));
  return [rotated[0], rotated[1], rotated[2], rotated[3]];
}

function isConvexQuad(quad: [Point, Point, Point, Point]): boolean {
  const signs = quad.map((p, i) => cross(p, quad[(i + 1) % 4], quad[(i + 2) % 4]));
  return signs.every((s) => s > 0) || signs.every((s) => s < 0);
}

function contourSideDeviation(contour: Point[], quad: [Point, Point, Point, Point]): number {
  let sum = 0;
  let count = 0;
  for (const p of contour) {
    let minD = Infinity;
    for (let i = 0; i < 4; i++) {
      minD = Math.min(minD, pointSegmentDistance(p, quad[i], quad[(i + 1) % 4]));
    }
    sum += minD * minD;
    count++;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
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
