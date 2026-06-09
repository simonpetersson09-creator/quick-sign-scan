// Perspective (homography) utilities for document deskewing.

export interface Point {
  x: number;
  y: number;
}

// (Removed DocumentAlignmentDiagnostics — only consumed by the deprecated
// autoOrientAndDeskewDocument pipeline. Orientation is now decided pre-warp
// via orientQuadForA4Portrait.)

export interface QuadGeometryDiagnostics {
  topAngle: number;
  bottomAngle: number;
  leftAngleFromVertical: number;
  rightAngleFromVertical: number;
  documentAngle: number;
  topWidth: number;
  bottomWidth: number;
  leftHeight: number;
  rightHeight: number;
  width: number;
  height: number;
  aspect: number;
}

export interface A4PortraitQuadOrientationDiagnostics {
  inputGeometry: QuadGeometryDiagnostics;
  selected: "keep" | "rotate-ccw" | "rotate-cw" | "rotate-180";
  reason: "landscape-quad" | "text-score" | "keep-portrait" | "fallback";
  candidates: Array<{
    name: "keep" | "rotate-ccw" | "rotate-cw" | "rotate-180";
    quad: [Point, Point, Point, Point];
    textScore: number;
    uprightScore: number;
    hasText: boolean;
    score: number;
  }>;
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
  sctx.fillStyle = "#ffffff";
  sctx.fillRect(0, 0, srcW, srcH);
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
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) / outW;
      const denom = t.g * u + t.h * v + 1;
      const sxF = (t.a * u + t.b * v + t.c) / denom;
      const syF = (t.d * u + t.e * v + t.f) / denom;

      const oi = (y * outW + x) * 4;
      if (!Number.isFinite(sxF) || !Number.isFinite(syF) || sxF < 0 || syF < 0 || sxF >= srcW - 1 || syF >= srcH - 1) {
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

// (Removed legacy passes: removeShadows / enhancePaper. They produced grey
// halos around text when stacked with whitenBackground. The capture pipeline
// now uses whitenBackground as the sole tone/illumination correction.)


// (Removed cleanPaperEdges — replaced by snapQuadToPaperEdges + dynamic
// warp-size from the quad's own aspect, which removes background without
// risk of eating margin content.)

// (Removed autoOrientAndDeskewDocument + renderToA4Portrait. Orientation is
// chosen pre-warp by orientQuadForA4Portrait; the warp output uses the
// quad's true aspect ratio scaled to TARGET_LONG, so no post-warp rotation
// or A4 stretching is needed.)

export function measureQuadGeometry(quad: [Point, Point, Point, Point]): QuadGeometryDiagnostics {
  const ordered = orderQuad(quad);
  return measureWarpQuadGeometry(ordered);
}

// Measures the quad exactly in the corner order it will be handed to
// warpQuadToRect. This is critical for orientation: cyclically rotating the
// corners changes whether the warp output is portrait or landscape, but
// orderQuad() would undo that rotation and hide the real output geometry.
export function measureWarpQuadGeometry(quad: [Point, Point, Point, Point]): QuadGeometryDiagnostics {
  const ordered = quad;
  const topAngle = segmentAngle(ordered[0], ordered[1]);
  const bottomAngle = segmentAngle(ordered[3], ordered[2]);
  const leftRaw = segmentAngle(ordered[0], ordered[3]);
  const rightRaw = segmentAngle(ordered[1], ordered[2]);
  const leftAngleFromVertical = normalizeToHalfTurn(leftRaw - 90);
  const rightAngleFromVertical = normalizeToHalfTurn(rightRaw - 90);
  const topWidth = dist(ordered[0], ordered[1]);
  const bottomWidth = dist(ordered[3], ordered[2]);
  const leftHeight = dist(ordered[0], ordered[3]);
  const rightHeight = dist(ordered[1], ordered[2]);
  const width = (topWidth + bottomWidth) / 2;
  const height = (leftHeight + rightHeight) / 2;
  return {
    topAngle,
    bottomAngle,
    leftAngleFromVertical,
    rightAngleFromVertical,
    documentAngle: averageAngles([topAngle, bottomAngle]),
    topWidth,
    bottomWidth,
    leftHeight,
    rightHeight,
    width,
    height,
    aspect: height / Math.max(1, width),
  };
}

export function orientQuadForA4Portrait(
  source: HTMLCanvasElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
  quad: [Point, Point, Point, Point],
  onDiagnostics?: (diagnostics: A4PortraitQuadOrientationDiagnostics) => void,
): [Point, Point, Point, Point] {
  // Single orientation decision: enumerate ALL four cyclic corner orderings
  // (0/90/180/270), score each by upright-text projection on a thumbnail
  // warp, and pick the best candidate that ALSO produces a portrait output.
  // Returning a portrait-oriented quad means the subsequent warp targets a
  // portrait canvas with the quad's true aspect ratio — no extra rotation,
  // no canvas-level rotate, no force-A4 stretching.
  const ordered = orderQuad(quad);
  const inputGeometry = measureQuadGeometry(ordered);

  // Cyclic permutations: shifting the TL index rotates the resulting warp
  // by 0°, 90° CCW (TL→bottom-left of source), 180°, 270° CCW (== 90° CW).
  const rot0  = ordered;
  const rot90ccw = [ordered[1], ordered[2], ordered[3], ordered[0]] as [Point, Point, Point, Point];
  const rot180   = [ordered[2], ordered[3], ordered[0], ordered[1]] as [Point, Point, Point, Point];
  const rot90cw  = [ordered[3], ordered[0], ordered[1], ordered[2]] as [Point, Point, Point, Point];
  const candidatesRaw: Array<{ name: "keep" | "rotate-ccw" | "rotate-cw" | "rotate-180"; quad: [Point, Point, Point, Point] }> = [
    { name: "keep",       quad: rot0 },
    { name: "rotate-ccw", quad: rot90ccw },
    { name: "rotate-cw",  quad: rot90cw },
    { name: "rotate-180", quad: rot180 },
  ];

  // Higher-resolution thumbnail (480 vs 240) for stronger upright detection —
  // single-shot per scan, cost is negligible.
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const sampleW = Math.max(1, Math.round(srcW * scale));
  const sampleH = Math.max(1, Math.round(srcH * scale));
  const sample = document.createElement("canvas");
  sample.width = sampleW;
  sample.height = sampleH;
  const sampleCtx = sample.getContext("2d")!;
  sampleCtx.fillStyle = "#ffffff";
  sampleCtx.fillRect(0, 0, sampleW, sampleH);
  sampleCtx.drawImage(source, 0, 0, sampleW, sampleH);

  const scored = candidatesRaw.map((candidate) => {
    const scaledQuad = candidate.quad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as [
      Point,
      Point,
      Point,
      Point,
    ];
    const geom = measureWarpQuadGeometry(candidate.quad);
    // Thumb aspect matches the candidate quad — bumped to ~480 short edge
    // so ascender/descender asymmetry is visible to estimateTextSkew.
    let thumbW = 480;
    let thumbH = 480;
    if (geom.height >= geom.width) {
      thumbH = Math.round((geom.height / Math.max(1, geom.width)) * thumbW);
    } else {
      thumbW = Math.round((geom.width / Math.max(1, geom.height)) * thumbH);
    }
    thumbW = Math.max(160, Math.min(720, thumbW));
    thumbH = Math.max(160, Math.min(720, thumbH));
    const thumb = warpQuadToRect(sample, sampleW, sampleH, scaledQuad, thumbW, thumbH);
    const text = estimateTextSkew(thumb, 5, 1);
    const isPortrait = geom.height >= geom.width;
    return {
      ...candidate,
      textScore: text.score,
      uprightScore: text.uprightScore,
      hasText: text.hasText,
      score: text.hasText ? text.score * text.uprightScore : 0,
      isPortrait,
    };
  });

  // Hard rule: output MUST be portrait. Only consider portrait candidates.
  const portraitCandidates = scored.filter((c) => c.isPortrait);
  const portraitOrFallback = portraitCandidates.length > 0 ? portraitCandidates : scored;
  const ranked = [...portraitOrFallback].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const keepCandidate = scored.find((c) => c.name === "keep")!;

  let selected = winner;
  let reason: A4PortraitQuadOrientationDiagnostics["reason"];
  if (portraitCandidates.length === 0) {
    reason = "fallback";
  } else if (winner.hasText && winner.name !== "keep" && keepCandidate.isPortrait) {
    // Strong keep-bias: only rotate away from "keep" when the winner clearly
    // beats it. 180° flips are the most common false positive (text rows are
    // near-symmetric horizontally), so require an even larger margin there.
    const keepScore = Math.max(1e-6, keepCandidate.score);
    const margin = winner.score / keepScore;
    const required = winner.name === "rotate-180" ? 1.25 : 1.15;
    if (margin >= required) {
      reason = "text-score";
    } else {
      selected = keepCandidate;
      reason = "keep-portrait";
    }
  } else if (winner.hasText) {
    reason = winner.name === "keep" ? "keep-portrait" : "text-score";
  } else {
    // No text detected — keep the original ordering if it's portrait,
    // otherwise pick the first portrait candidate.
    if (keepCandidate.isPortrait) {
      selected = keepCandidate;
      reason = "keep-portrait";
    } else {
      reason = "landscape-quad";
    }
  }

  // Strip the local isPortrait flag from the public diagnostics shape.
  const publicCandidates = scored.map(({ isPortrait: _ip, ...rest }) => rest);
  onDiagnostics?.({
    inputGeometry,
    selected: selected.name as A4PortraitQuadOrientationDiagnostics["selected"],
    reason,
    candidates: publicCandidates,
  });
  return selected.quad;
}

// (renderToA4Portrait removed — see note above autoOrientAndDeskewDocument.)


function rotateCanvas(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const normalized = ((degrees % 360) + 360) % 360;
  if (Math.abs(normalized) < 0.001) return cloneCanvas(source);
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const outW = Math.ceil(Math.abs(source.width * cos) + Math.abs(source.height * sin));
  const outH = Math.ceil(Math.abs(source.width * sin) + Math.abs(source.height * cos));
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  out.getContext("2d")!.drawImage(source, 0, 0);
  return out;
}

function scaleCanvas(source: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function estimateTextSkew(
  canvas: HTMLCanvasElement,
  maxAngle: number,
  step: number,
): { angle: number; score: number; hasText: boolean; uprightScore: number } {
  const points = collectTextPoints(canvas);
  if (points.length < 90) return { angle: 0, score: 0, hasText: false, uprightScore: 1 };

  let bestAngle = 0;
  let bestScore = -Infinity;
  for (let angle = -maxAngle; angle <= maxAngle + 1e-6; angle += step) {
    const score = horizontalProjectionScore(points, canvas.width, canvas.height, angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  for (let angle = bestAngle - step; angle <= bestAngle + step + 1e-6; angle += step / 4) {
    const score = horizontalProjectionScore(points, canvas.width, canvas.height, angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  return {
    angle: bestAngle,
    score: bestScore,
    hasText: true,
    uprightScore: estimateUprightScore(points, canvas.width, canvas.height),
  };
}

function collectTextPoints(canvas: HTMLCanvasElement): Point[] {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const hist = new Uint32Array(256);
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
    lum[p] = value;
    hist[value]++;
  }

  const cutoff = Math.max(55, Math.min(190, otsuThreshold(hist, w * h) - 4));
  const marginX = Math.round(w * 0.045);
  const marginY = Math.round(h * 0.045);
  const all: Point[] = [];
  for (let y = marginY; y < h - marginY; y++) {
    for (let x = marginX; x < w - marginX; x++) {
      if (lum[y * w + x] < cutoff) all.push({ x, y });
    }
  }
  if (all.length > w * h * 0.22) return [];
  if (all.length <= 14000) return all;
  const stride = Math.ceil(all.length / 14000);
  return all.filter((_, i) => i % stride === 0);
}

function horizontalProjectionScore(
  points: Point[],
  w: number,
  h: number,
  angleDeg: number,
): number {
  const rad = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const bins = new Float32Array(Math.ceil(Math.hypot(w, h)) + 6);
  const cx = w / 2;
  const cy = h / 2;
  const offset = bins.length / 2;
  for (const p of points) {
    const y = sin * (p.x - cx) + cos * (p.y - cy) + offset;
    const yi = Math.max(0, Math.min(bins.length - 1, Math.round(y)));
    bins[yi]++;
  }
  let score = 0;
  for (let i = 1; i < bins.length - 1; i++) {
    const smoothed = bins[i - 1] * 0.25 + bins[i] * 0.5 + bins[i + 1] * 0.25;
    score += smoothed * smoothed;
  }
  return score / Math.max(1, points.length);
}

function estimateVerticalPaperEdgeSkew(canvas: HTMLCanvasElement): {
  angle: number;
  confidence: number;
  leftAngle: number | null;
  rightAngle: number | null;
} {
  const sample = scaleCanvas(canvas, 520);
  const w = sample.width;
  const h = sample.height;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx || w < 80 || h < 80) {
    return { angle: 0, confidence: 0, leftAngle: null, rightAngle: null };
  }
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
  }

  const left = collectVerticalEdgePoints(lum, w, h, "left");
  const right = collectVerticalEdgePoints(lum, w, h, "right");
  const leftFit = fitVerticalLine(left);
  const rightFit = fitVerticalLine(right);
  const angles = [leftFit, rightFit]
    .filter((fit): fit is { angle: number; confidence: number } => !!fit && fit.confidence > 0)
    .map((fit) => fit.angle);
  if (!angles.length) {
    return {
      angle: 0,
      confidence: 0,
      leftAngle: leftFit?.angle ?? null,
      rightAngle: rightFit?.angle ?? null,
    };
  }

  const confidence = Math.max(leftFit?.confidence ?? 0, rightFit?.confidence ?? 0);
  return {
    angle: averageAngles(angles),
    confidence,
    leftAngle: leftFit?.angle ?? null,
    rightAngle: rightFit?.angle ?? null,
  };
}

function collectVerticalEdgePoints(
  lum: Uint8ClampedArray,
  w: number,
  h: number,
  side: "left" | "right",
): Point[] {
  const points: Point[] = [];
  const y0 = Math.round(h * 0.04);
  const y1 = Math.round(h * 0.96);
  const xStart = side === "left" ? 1 : Math.round(w * 0.62);
  const xEnd = side === "left" ? Math.round(w * 0.38) : w - 2;
  const minGradient = 12;
  for (let y = y0; y < y1; y += 2) {
    let bestX = -1;
    let bestG = 0;
    for (let x = xStart; x <= xEnd; x++) {
      const g = Math.abs(lum[y * w + x + 1] - lum[y * w + x - 1]);
      if (g > bestG) {
        bestG = g;
        bestX = x;
      }
    }
    if (bestX >= 0 && bestG >= minGradient) points.push({ x: bestX, y });
  }
  return points;
}

function fitVerticalLine(points: Point[]): { angle: number; confidence: number } | null {
  if (points.length < 24) return null;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxy += p.x * p.y;
    syy += p.y * p.y;
  }
  const n = points.length;
  const denom = n * syy - sy * sy;
  if (Math.abs(denom) < 1e-6) return null;
  const slope = (n * sxy - sx * sy) / denom; // x = slope*y + intercept
  const intercept = (sx - slope * sy) / n;
  let err = 0;
  for (const p of points) {
    const predictedX = slope * p.y + intercept;
    err += Math.abs(p.x - predictedX);
  }
  const meanErr = err / n;
  const confidence = clamp01((n / 160) * (1 - meanErr / 18));
  return { angle: (Math.atan(slope) * 180) / Math.PI, confidence };
}

function estimateUprightScore(points: Point[], w: number, h: number): number {
  const rows = new Uint16Array(h);
  let topHalf = 0;
  let bottomHalf = 0;
  let leftHalf = 0;
  let rightHalf = 0;
  let sumX = 0;
  for (const p of points) {
    rows[Math.max(0, Math.min(h - 1, Math.round(p.y)))]++;
    if (p.y < h / 2) topHalf++;
    else bottomHalf++;
    if (p.x < w / 2) leftHalf++;
    else rightHalf++;
    sumX += p.x;
  }
  const rowCutoff = Math.max(3, points.length * 0.0025);
  let firstTop = h;
  let firstBottom = h;
  for (let y = 0; y < h; y++) {
    if (rows[y] >= rowCutoff) {
      firstTop = y;
      break;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    if (rows[y] >= rowCutoff) {
      firstBottom = h - 1 - y;
      break;
    }
  }
  const marginHint = clamp01((firstBottom - firstTop) / Math.max(1, h * 0.18));
  const topHint = clamp01((topHalf - bottomHalf) / Math.max(1, points.length) + 0.15);
  const leftHint = clamp01((leftHalf - rightHalf) / Math.max(1, points.length) + 0.2);
  const avgXHint = clamp01((0.62 - sumX / Math.max(1, points.length) / w) / 0.24);
  return 0.9 + 0.2 * (0.42 * marginHint + 0.24 * topHint + 0.22 * leftHint + 0.12 * avgXHint);
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
    /** Fraction of sampled side-points that snapped onto a strong edge (0..1). */
    edgeTightness: number;
    /** Mean perpendicular distance (source-pixel units) between final sides
     *  and the nearest strong gradient after snap. Lower = tighter frame. */
    meanEdgeOffset: number;
  };
  /** Generous-overlay flag: true when the detection passed all strict
   *  capture gates; false when it only passed structural gates and is
   *  returned for overlay/coaching purposes (auto-capture must not fire). */
  readyForCapture?: boolean;
  /** When readyForCapture is false, the first strict gate that failed. */
  reasonNotReady?: string;
}

const A4_RATIO = Math.SQRT2;
export const MIN_DOCUMENT_CONFIDENCE = 0.12;
export const MIN_EDGE_TIGHTNESS_FOR_CAPTURE = 0.55;


// Detect the document from its contour: isolate candidate paper, extract the
// outer boundary, reduce the convex contour to four real corners, then reject
// shapes with curved sides, non-A4 proportions, or extreme perspective.
export interface DetectOptions {
  /** Previous detection corners (in source pixel coords) — used to
   *  temporally bias scoring so the frame doesn't jump between objects. */
  prefer?: [Point, Point, Point, Point];
  /** Generous-overlay mode: when no candidate passes the strict capture
   *  gates, fall back to the best candidate that passed structural gates
   *  (area / A4 / perspective / polygonFill / not-touching-edge) so the
   *  on-screen frame can show that the document IS being seen. Such a
   *  result is returned with readyForCapture=false; auto-capture must
   *  refuse to fire on it. Strict pipeline is unchanged when this is off. */
  allowOverlay?: boolean;
}

export function detectDocumentQuad(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: DetectOptions = {},
): DocumentDetection | null {
  resetDetectDiagnostics();
  const total = width * height;
  const rawLum = new Uint8ClampedArray(total);
  const rawHist = new Uint32Array(256);
  // Chroma proxy (max(R,G,B) − min(R,G,B)) — cheap saturation surrogate.
  // White paper has chroma ~0 even when its luminance matches a light
  // wooden floor; wood typically has chroma 20–80. Lets us separate
  // paper from background when grayscale contrast alone is too weak.
  const chroma = ENABLE_WHITENESS_CHANNEL ? new Uint8ClampedArray(total) : null;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    rawLum[j] = l;
    rawHist[l]++;
    if (chroma) {
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      chroma[j] = mx - mn;
    }
  }

  // Adaptive contrast normalization — percentile stretch so dim scenes
  // gain enough local contrast for Canny + brightness masking. Critical
  // for detecting white A4 on a dark wooden desk under weak room light.
  // We compute the 2nd/98th percentiles and linearly remap to [0..255].
  const { lum, hist } = stretchContrast(rawLum, rawHist, total);

  const blurred = gaussianBlur(lum, width, height);
  const { edges, highThreshold } = cannyEdges(blurred, width, height);
  // Raw gradient magnitude (Sobel) — used to snap the polygon sides onto
  // the strongest local edge with sub-pixel-class precision. Canny output
  // alone is too sparse to refine corner positions accurately.
  const gradMag = sobelMagnitude(blurred, width, height);
  const connectedEdges = closeEdgeGaps(edges, width, height);
  const components = edgeComponents(connectedEdges, width, height);
  // Lowered floor (95 → 70) so darker grayish-white paper still segments
  // from a dark background. Otsu still picks the actual threshold when
  // contrast is healthy; the floor only matters in low light.
  const brightThreshold = Math.max(70, Math.min(225, otsuThreshold(hist, total) + 8));
  const paperMask = buildBrightPaperMask(lum, width, height, brightThreshold);
  components.push(...edgeComponents(maskBoundary(paperMask, width, height), width, height));

  // Whiteness mask — bright AND low chroma. This pops white paper out of
  // light wood / textile backgrounds that match its luminance but not its
  // color. Boundary components feed the same quad search; pure addition,
  // doesn't change anything when chroma is absent.
  if (chroma && ENABLE_WHITENESS_CHANNEL) {
    const whitenessMask = buildWhitenessMask(
      lum, chroma, width, height,
      Math.max(60, brightThreshold - 25), // a touch more permissive on L since chroma already gates
      WHITENESS_MAX_CHROMA,
    );
    components.push(...edgeComponents(maskBoundary(whitenessMask, width, height), width, height));
  }
  const allDetections: DocumentDetection[] = [];
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
        gradMag,
        width,
        height,
        frameArea: total,
        edgeThreshold: highThreshold,
        candidateCount,
      });
      if (!detection) continue;
      allDetections.push(detection);
    }
  }

  // === Hough-line candidates (feature flag D) ===
  // Detect the 4 dominant page borders directly as lines on the edge map,
  // intersect them → 4 corners. Catches A4 sheets whose contour breaks up
  // (occluded corner, soft shadow on one edge, scattered noise on the
  // table) but whose top/bottom/left/right are still long, straight and
  // dominant in the edge image — the case where contour-based extraction
  // tends to lock onto a sub-rectangle inside the page.
  if (ENABLE_HOUGH_LINE_DETECTION) {
    const houghQuads = houghLineQuadCandidates(connectedEdges, gradMag, width, height);
    for (const q of houghQuads) {
      candidateCount++;
      const detection = evaluateEdgeQuad({
        quad: q,
        hull: q.slice() as Point[],
        lum,
        edges,
        gradMag,
        width,
        height,
        frameArea: total,
        edgeThreshold: highThreshold,
        candidateCount,
      });
      if (detection) allDetections.push(detection);
    }
  }



  // Drop inner candidates: if a detection's quad lies (almost) entirely
  // inside another, larger detection's quad, it's content on the page —
  // text blocks, photos, tables — not the outer A4 boundary. We only keep
  // the OUTER polygon so the warp covers the full sheet.
  const outerDetections = filterOuterDetections(allDetections);

  // Re-rank survivors with a strong bias toward (1) largest area,
  // (2) A4 aspect ratio, (3) proximity to image center. Inner contours
  // can never beat the outer A4 because they were filtered above; among
  // the remaining outer candidates we still prefer the most A4-like one
  // that's centered in the frame.
  const frameCx = width / 2;
  const frameCy = height / 2;
  const diag = Math.hypot(width, height);
  // Optional previous-frame centroid for temporal stabilization — boosts
  // candidates whose centroid is close to where the doc was last frame,
  // so the polygon doesn't hop between competing objects.
  let prevCx: number | null = null;
  let prevCy: number | null = null;
  if (options.prefer) {
    const q = options.prefer;
    prevCx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    prevCy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  }
  let best: DocumentDetection | null = null;
  let bestScore = 0;
  for (const det of outerDetections) {
    const ratioError = Math.abs(det.a4Ratio - A4_RATIO) / A4_RATIO;
    const a4Score = clamp01(1 - ratioError / 0.9);
    const areaScore = clamp01(det.debug.areaRatio / 0.6); // saturates at 60% of frame
    const cx = (det.corners[0].x + det.corners[1].x + det.corners[2].x + det.corners[3].x) / 4;
    const cy = (det.corners[0].y + det.corners[1].y + det.corners[2].y + det.corners[3].y) / 4;
    const centerScore = clamp01(1 - (Math.hypot(cx - frameCx, cy - frameCy) / diag) * 2);
    const tempScore =
      prevCx !== null && prevCy !== null
        ? clamp01(1 - (Math.hypot(cx - prevCx, cy - prevCy) / diag) / 0.3)
        : 0;

    // Inside/outside luminance check — rejects quads sitting INSIDE the
    // paper (text blocks, tables, photos) by detecting that their outside
    // ring is also paper-bright. A real paper edge has insideMean clearly
    // higher than outsideMean (paper vs desk/floor).
    let bgContrastScore = 0;
    if (ENABLE_INSIDE_PAPER_PENALTY) {
      const io = insideOutsideLuma(lum, width, height, det.corners);
      if (io.outsideSamples >= 6 && io.gap < INSIDE_OUTSIDE_MIN_GAP) {
        recordReject("innerTextBlock", {
          areaRatio: det.debug.areaRatio,
          edgeScore: det.debug.edgeScore,
          edgeTightness: det.debug.edgeTightness,
          a4Score,
          statsMean: io.insideMean,
          contrast: io.gap,
        });
        continue; // skip — almost certainly a text/content block on the page
      }
      // 0 at gap = MIN_GAP, saturates at gap >= 60 (clear paper-vs-desk)
      bgContrastScore = clamp01((io.gap - INSIDE_OUTSIDE_MIN_GAP) / 50);
    }

    // Paper-interior prior — boost quads whose inside actually looks like
    // a uniform white sheet (low chroma + low luminance variance).
    // chromaMean: 0–10 ≈ paper, 30+ ≈ colored/textured surface.
    // lumStd: <12 ≈ clean sheet, >35 ≈ textured floor / printed cover.
    let paperInteriorScore = 0;
    if (chroma && ENABLE_PAPER_INTERIOR_PRIOR) {
      const ics = insideChromaStats(lum, chroma, width, height, det.corners);
      if (ics.samples >= 6) {
        const chromaScore = clamp01((30 - ics.chromaMean) / 30);
        const flatScore = clamp01((35 - ics.lumStd) / 30);
        paperInteriorScore = chromaScore * flatScore;
      }
    }

    // Outer-prioritized confidence: area dominates, then A4 match, then
    // edge support, paper/bg contrast, paper interior, centeredness,
    // then temporal bias.
    // Restored area-dominant weighting — paperInteriorScore was penalising
    // text-heavy pages (lumStd high inside) and letting smaller white
    // sub-quads win, which clipped text. Hough candidates also added
    // frame-to-frame flicker; both downweighted/disabled below.
    // Sprint 2 — Hough-kandidater är nu gradient-styrkda så vi vågar lita på
    // deras egen confidence mer. Vikt 0.09 → 0.14 på det priset av centerScore.
    const outerConfidence =
      0.38 * areaScore +
      0.18 * a4Score +
      0.12 * det.debug.edgeScore +
      0.06 * bgContrastScore +
      0.04 * centerScore +
      0.14 * det.confidence +
      0.08 * tempScore;
    void paperInteriorScore;
    if (outerConfidence > bestScore) {
      bestScore = outerConfidence;
      best = det;
    }
  }


  if (best) {
    best.debug.candidateCount = candidateCount;
  }
  lastDetectDiagnostics.candidateCount = candidateCount;
  const result = best && best.confidence >= MIN_DOCUMENT_CONFIDENCE ? best : null;
  if (!result && best) recordReject("confidenceBelowMin", {
    areaRatio: best.debug.areaRatio,
    edgeScore: best.debug.edgeScore,
    edgeTightness: best.debug.edgeTightness,
    a4Score: best.debug.a4Score,
    meanEdgeOffset: best.debug.meanEdgeOffset,
  });
  if (result) {
    return { ...result, readyForCapture: true };
  }
  // Generous-overlay fallback: synthesize a non-capture-ready detection
  // from the best structurally-plausible candidate so the live overlay
  // can show that the document IS being seen. Auto-capture must check
  // readyForCapture before firing.
  if (options.allowOverlay && lastDetectDiagnostics.overlayBest) {
    const o = lastDetectDiagnostics.overlayBest;
    return {
      corners: o.corners,
      a4Ratio: o.a4Ratio,
      confidence: o.confidence,
      debug: {
        edgeThreshold: 0,
        threshold: 0,
        candidateCount,
        a4Score: o.a4Score,
        edgeScore: o.edgeScore,
        brightnessScore: 0,
        textScore: 0,
        areaRatio: o.areaRatio,
        sideDeviation: 0,
        perspectiveError: 0,
        polygonFill: 1,
        edgeTightness: o.edgeTightness,
        meanEdgeOffset: 0,
      },
      readyForCapture: false,
      reasonNotReady: o.reasonNotReady ?? "confidenceBelowMin",
    };
  }
  return null;
}

// Backwards-compatible API for camera overlay/capture.
export function findDocumentCorners(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [Point, Point, Point, Point] | null {
  return detectDocumentQuad(data, width, height)?.corners ?? null;
}

// Remove inner detections — any quad whose centroid AND most of its
// corners lie inside a larger quad is treated as content (text block,
// photo, table) on top of the actual paper. Only outer polygons survive.
function filterOuterDetections(detections: DocumentDetection[]): DocumentDetection[] {
  if (detections.length <= 1) return detections;
  // Sort by area descending so larger quads are considered as parents first.
  const sorted = [...detections].sort((a, b) => b.debug.areaRatio - a.debug.areaRatio);
  const kept: DocumentDetection[] = [];
  for (const det of sorted) {
    const cx = (det.corners[0].x + det.corners[1].x + det.corners[2].x + det.corners[3].x) / 4;
    const cy = (det.corners[0].y + det.corners[1].y + det.corners[2].y + det.corners[3].y) / 4;
    let containedBy: DocumentDetection | null = null;
    for (const outer of kept) {
      if (det.debug.areaRatio >= outer.debug.areaRatio * 0.92) continue; // similar size — keep both
      if (!pointInQuad({ x: cx, y: cy }, outer.corners)) continue;
      let cornersInside = 0;
      for (const c of det.corners) {
        if (pointInQuad(c, outer.corners)) cornersInside++;
      }
      if (cornersInside >= 3) {
        containedBy = outer;
        break;
      }
    }
    if (!containedBy) kept.push(det);
  }
  return kept;
}

function pointInQuad(p: Point, quad: [Point, Point, Point, Point]): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = quad[i].x;
    const yi = quad[i].y;
    const xj = quad[j].x;
    const yj = quad[j].y;
    const intersects =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Feature flag: penalize candidates whose OUTSIDE looks like paper too
// (i.e. quad sits *inside* the actual paper — a text block, table or
// photo on the page). A real paper edge has bright inside and clearly
// darker / different outside (desk, floor, etc).
const ENABLE_INSIDE_PAPER_PENALTY = true;
// Min luminance gap (inside − outside) for a quad to be accepted as a
// real paper boundary. Below this we flag it as innerTextBlock.
const INSIDE_OUTSIDE_MIN_GAP = 10;

// Feature flag A — use chroma (saturation proxy) as a second segmentation
// channel. Whitens-out paper that has similar luminance to its background
// (e.g. white A4 on light wood). Pure addition: extra candidates only.
const ENABLE_WHITENESS_CHANNEL = true;
// Max chroma (maxC−minC) for a pixel to count as "paper-white" in the
// whiteness mask. Real paper: 0–15. White wood/textile under warm light:
// 20–60. 22 is a safe split that holds across daylight and lamp light.
const WHITENESS_MAX_CHROMA = 22;

// Feature flag C — paper-interior prior. Boosts candidates whose INSIDE
// looks like paper (low chroma, low luminance variance) and penalizes
// candidates whose inside is textured/colored (a book cover, the wood
// floor itself, a laptop screen). Augments the existing inside/outside
// luminance gap check rather than replacing it.
const ENABLE_PAPER_INTERIOR_PRIOR = false;

// Feature flag D — Hough line detection. Finds dominant straight lines on
// the Canny edge map, classifies them into top/bottom/left/right by angle
// and position, picks the strongest per side and intersects → 4 corners.
// Robust when ~20–40% of an edge is occluded, blurred or breaks up: the
// remaining edge pixels still vote for the same line. This is the same
// "line-segment + intersection" pattern Office Lens / VisionKit use.
// Pure addition — the generated quads are evaluated by evaluateEdgeQuad
// alongside the contour-based candidates, never replace them.
const ENABLE_HOUGH_LINE_DETECTION = true;
const HOUGH_THETA_STEP_DEG = 1.5;     // ~120 angle bins over 0..180°
const HOUGH_RHO_STEP_PX = 2;          // 2px rho quantization
const HOUGH_TOP_LINES_PER_SIDE = 3;   // pick top-3 per top/bottom/left/right
const HOUGH_ANGLE_TOL_DEG = 32;       // ±32° from horizontal/vertical accepted
const HOUGH_MAX_QUADS = 24;           // cap combos forwarded to evaluation
const HOUGH_MIN_VOTES_FRAC = 0.05;    // min line votes as fraction of min(W,H)

function scaleQuadAroundCentroid(
  quad: [Point, Point, Point, Point],
  factor: number,
): [Point, Point, Point, Point] {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  return quad.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  })) as [Point, Point, Point, Point];
}

// Compare mean luminance inside the quad (shrunk inward) vs in a thin
// ring just outside the quad. Used to detect "inside paper" candidates:
// when both samples are bright the quad almost certainly sits on top of
// the real paper rather than along its edge.
function insideOutsideLuma(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
  quad: [Point, Point, Point, Point],
): { insideMean: number; outsideMean: number; gap: number; outsideSamples: number } {
  const inner = scaleQuadAroundCentroid(quad, 0.78);
  const outer = scaleQuadAroundCentroid(quad, 1.22);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(width - 1, Math.ceil(maxX));
  maxY = Math.min(height - 1, Math.ceil(maxY));
  const step = Math.max(2, Math.round(Math.min(maxX - minX, maxY - minY) / 40));
  let insideSum = 0,
    insideN = 0,
    outsideSum = 0,
    outsideN = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const p = { x, y };
      const inInner = pointInQuad(p, inner);
      if (inInner) {
        insideSum += lum[y * width + x];
        insideN++;
        continue;
      }
      const inOuter = pointInQuad(p, outer);
      const inQuad = pointInQuad(p, quad);
      if (inOuter && !inQuad) {
        outsideSum += lum[y * width + x];
        outsideN++;
      }
    }
  }
  const insideMean = insideN ? insideSum / insideN : 0;
  const outsideMean = outsideN ? outsideSum / outsideN : insideMean;
  return { insideMean, outsideMean, gap: insideMean - outsideMean, outsideSamples: outsideN };
}






// Percentile-based contrast stretch. Finds the 2nd and 98th percentiles of
// the luminance histogram and linearly remaps that range to [0..255]. This
// is the cheapest form of adaptive normalization and dramatically improves
// edge/mask detection on dimly lit scenes where the whole histogram is
// squeezed into the middle of the range (white paper at ~140 instead of
// ~230). If contrast is already healthy we skip the remap so well-lit
// frames behave exactly as before.
function stretchContrast(
  lum: Uint8ClampedArray,
  hist: Uint32Array,
  total: number,
): { lum: Uint8ClampedArray; hist: Uint32Array } {
  const lowCut = Math.floor(total * 0.02);
  const highCut = Math.floor(total * 0.02);
  let acc = 0;
  let lo = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > lowCut) { lo = i; break; }
  }
  acc = 0;
  let hi = 255;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc > highCut) { hi = i; break; }
  }
  const span = hi - lo;
  // Skip remap when contrast is already good — avoids touching well-lit frames.
  if (span >= 170) return { lum, hist };
  if (span < 20) return { lum, hist }; // degenerate / nearly flat image — leave untouched
  const out = new Uint8ClampedArray(lum.length);
  const outHist = new Uint32Array(256);
  const scale = 255 / span;
  for (let i = 0; i < lum.length; i++) {
    let v = (lum[i] - lo) * scale;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    const vi = v | 0;
    out[i] = vi;
    outHist[vi]++;
  }
  return { lum: out, hist: outHist };
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
  // Balanced morphological closing (dilate then erode by the same amount).
  // The previous dilate-dilate-erode was a net +1px dilation which pushed
  // the detected contour OUTSIDE the real paper edge by a couple of pixels
  // per side — visible as a frame that floats a few mm/cm off the document.
  const dilated = dilateMask(edges, width, height);
  return erodeMask(dilated, width, height);
}

// Bright AND low-chroma mask. Implements feature flag A (whiteness
// channel). Same morphology pattern as buildBrightPaperMask so its
// boundary feeds the same edgeComponents → quad pipeline.
function buildWhitenessMask(
  lum: Uint8ClampedArray,
  chroma: Uint8ClampedArray,
  width: number,
  height: number,
  lumThreshold: number,
  maxChroma: number,
): Uint8Array {
  const mask = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) {
    mask[i] = lum[i] >= lumThreshold && chroma[i] <= maxChroma ? 1 : 0;
  }
  let closed: Uint8Array<ArrayBufferLike> = mask;
  for (let i = 0; i < 3; i++) closed = dilateMask(closed, width, height);
  for (let i = 0; i < 3; i++) closed = erodeMask(closed, width, height);
  return closed;
}

// Inside-quad chroma + luminance variance stats. Used by the paper-
// interior prior to boost quads whose interior actually looks like a
// uniform white sheet (low chroma, low lum variance).
function insideChromaStats(
  lum: Uint8ClampedArray,
  chroma: Uint8ClampedArray,
  width: number,
  height: number,
  quad: [Point, Point, Point, Point],
): { chromaMean: number; lumStd: number; samples: number } {
  const inner = scaleQuadAroundCentroid(quad, 0.78);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of inner) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(width - 1, Math.ceil(maxX));
  maxY = Math.min(height - 1, Math.ceil(maxY));
  const step = Math.max(2, Math.round(Math.min(maxX - minX, maxY - minY) / 40));
  let cSum = 0, lSum = 0, lSqSum = 0, n = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!pointInQuad({ x, y }, inner)) continue;
      const idx = y * width + x;
      cSum += chroma[idx];
      const l = lum[idx];
      lSum += l;
      lSqSum += l * l;
      n++;
    }
  }
  if (n === 0) return { chromaMean: 255, lumStd: 255, samples: 0 };
  const chromaMean = cSum / n;
  const lumMean = lSum / n;
  const lumVar = Math.max(0, lSqSum / n - lumMean * lumMean);
  return { chromaMean, lumStd: Math.sqrt(lumVar), samples: n };
}

function buildBrightPaperMask(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const mask = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) mask[i] = lum[i] >= threshold ? 1 : 0;
  // Balanced closing: dilate N, erode N. The previous extra dilate at the
  // end grew the mask by 1px on every side, which propagated through to the
  // boundary contour and put the polygon outside the actual paper.
  let closed: Uint8Array<ArrayBufferLike> = mask;
  for (let i = 0; i < 3; i++) closed = dilateMask(closed, width, height);
  for (let i = 0; i < 3; i++) closed = erodeMask(closed, width, height);
  return closed;
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

export type DetectDiagnostics = {
  rejects: Record<string, number>;
  bestRejected: null | {
    reason: string;
    areaRatio: number;
    edgeScore: number;
    edgeTightness: number;
    a4Score: number;
    meanEdgeOffset: number;
    statsMean: number;
    contrast: number;
  };
  candidateCount: number;
  adaptiveUsed: null | {
    areaRatio: number;
    originalTightness: number;
    boostedTightness: number;
    threshold: number;
    edgeScore: number;
    a4Score: number;
    contrast: number;
    accepted: boolean;
  };
  /** Best structurally-plausible overlay candidate this frame (generous
   *  detection). May be present even when no strict result is returned. */
  overlayBest: null | {
    corners: [Point, Point, Point, Point];
    a4Ratio: number;
    a4Score: number;
    edgeScore: number;
    edgeTightness: number;
    areaRatio: number;
    statsMean: number;
    contrast: number;
    confidence: number;
    reasonNotReady: string | null;
    _score: number;
  };
};

let lastDetectDiagnostics: DetectDiagnostics = {
  rejects: {},
  bestRejected: null,
  candidateCount: 0,
  adaptiveUsed: null,
  overlayBest: null,
};

export function getLastDetectDiagnostics(): DetectDiagnostics {
  return lastDetectDiagnostics;
}

function resetDetectDiagnostics() {
  lastDetectDiagnostics = { rejects: {}, bestRejected: null, candidateCount: 0, adaptiveUsed: null, overlayBest: null };
}

function recordReject(
  reason: string,
  metrics: {
    areaRatio?: number;
    edgeScore?: number;
    edgeTightness?: number;
    a4Score?: number;
    meanEdgeOffset?: number;
    statsMean?: number;
    contrast?: number;
  } = {},
) {
  lastDetectDiagnostics.rejects[reason] = (lastDetectDiagnostics.rejects[reason] ?? 0) + 1;
  const area = metrics.areaRatio ?? 0;
  const prev = lastDetectDiagnostics.bestRejected;
  if (!prev || area > prev.areaRatio) {
    lastDetectDiagnostics.bestRejected = {
      reason,
      areaRatio: area,
      edgeScore: metrics.edgeScore ?? 0,
      edgeTightness: metrics.edgeTightness ?? 0,
      a4Score: metrics.a4Score ?? 0,
      meanEdgeOffset: metrics.meanEdgeOffset ?? 0,
      statsMean: metrics.statsMean ?? 0,
      contrast: metrics.contrast ?? 0,
    };
  }
}

function evaluateEdgeQuad(args: {
  quad: [Point, Point, Point, Point];
  hull: Point[];
  lum: Uint8ClampedArray;
  edges: Uint8Array;
  gradMag: Float32Array;
  width: number;
  height: number;
  frameArea: number;
  edgeThreshold: number;
  candidateCount: number;
}): DocumentDetection | null {
  const { hull, lum, edges, gradMag, width, height, frameArea, edgeThreshold, candidateCount } =
    args;
  if (!isConvexQuad(args.quad)) return null;
  let ordered = orderQuad(args.quad);

  // EDGE SNAP — pull each side of the polygon onto the strongest local
  // gradient. This is the single most important step for the "frame floats
  // a few cm outside the document" problem: contour extraction lives on a
  // dilated/eroded mask that is inherently a couple of pixels off the true
  // paper boundary, but the gradient peak sits on the real edge.
  let snap = refineQuadToEdges(ordered, gradMag, edgeThreshold, width, height);
  if (snap) ordered = snap.quad;

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
  ) {
    recordReject("touchesFrameEdge");
    return null;
  }
  if (minX < margin && minY < margin && maxX > width - margin && maxY > height - margin) {
    recordReject("fillsEntireFrame");
    return null;
  }

  const area = Math.abs(polygonArea(ordered));
  const areaRatio = area / frameArea;
  if (areaRatio < 0.04 || areaRatio > 0.95) {
    recordReject(areaRatio < 0.04 ? "areaTooSmall" : "areaTooLarge", { areaRatio });
    return null;
  }

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

  // Sprint 1 — hård A4-gate. Tidigare 1.1 (ratio 0..~3) släppte igenom
  // bärbara datorer (1.6), telefoner (~2.1) och böcker att tävla med A4.
  // 0.35 → tillåten ratio ~0.92..1.91, vilket täcker A4 (1.414) med
  // generös perspektiv-skevhet men exkluderar tydligt fel-format.
  if (ratioError > 0.35) {
    recordReject("a4RatioOff", { areaRatio });
    return null;
  }
  if (perspectiveError > 4.5) {
    recordReject("perspectiveExtreme", { areaRatio });
    return null;
  }
  if (sideDeviation > 0.22) {
    recordReject("sidesNotStraight", { areaRatio });
    return null;
  }
  if (polygonFill < 0.45 || polygonFill > 2.4) {
    recordReject("polygonFillOff", { areaRatio });
    return null;
  }

  const stats = polygonImageStats(ordered, lum, width, height);
  const edgeScore = quadEdgeSupport(ordered, edges, width, height);
  const a4Score = clamp01(1 - ratioError / 1.1);
  const straightScore = clamp01(1 - sideDeviation / 0.22);
  const perspectiveScore = clamp01(1 - perspectiveError / 4.5);
  const brightnessScore = clamp01((stats.mean - 70) / 140);
  const textScore = clamp01(stats.darkRatio / 0.055);
  const areaScore =
    areaRatio <= 0.7 ? clamp01((areaRatio - 0.02) / 0.18) : clamp01((0.98 - areaRatio) / 0.2);
  const contrastScore = clamp01((stats.mean - stats.exteriorMean) / 60);
  const purityScore = clamp01(stats.brightRatio / 0.85);
  let edgeTightness = snap ? snap.tightness : 0;
  let meanEdgeOffset = snap ? snap.meanOffset : 999;
  const originalTightness = edgeTightness;

  const confidence =
    0.22 * edgeScore +
    0.12 * straightScore +
    0.06 * a4Score +
    0.06 * brightnessScore +
    0.04 * textScore +
    0.06 * perspectiveScore +
    0.05 * areaScore +
    0.07 * contrastScore +
    0.07 * purityScore +
    // Heaviest single weight: did the polygon actually snap to real edges?
    0.25 * edgeTightness;


  // ===== Adaptive small-document edge handling (feature-flagged) =====
  // Small A4 in a 280px detect frame has 1-2 px wide gradient peaks; the
  // default snap threshold is tuned for bigger documents and drops these.
  // When the candidate already looks plausible by A4 ratio, edge support
  // and paper/bg contrast, we (a) re-run snap with a lowered gradient
  // threshold to recover those weak edges and (b) accept a slightly lower
  // tightness — but ONLY if A4, edge and contrast back it up.
  const ENABLE_ADAPTIVE_EDGE_TIGHTNESS = true;
  const contrast = stats.mean - stats.exteriorMean;
  const isSmallDoc = areaRatio > 0.04 && areaRatio < 0.18;
  const adaptiveQualifies =
    ENABLE_ADAPTIVE_EDGE_TIGHTNESS &&
    isSmallDoc &&
    a4Score >= 0.7 &&
    edgeScore >= 0.22 &&
    contrast >= 22 &&
    ratioError <= 0.5;

  if (adaptiveQualifies) {
    // Boost: re-snap with a 0.7x threshold so weak gradient peaks count.
    const boosted = refineQuadToEdges(ordered, gradMag, edgeThreshold * 0.7, width, height);
    if (boosted && boosted.tightness > edgeTightness) {
      snap = boosted;
      ordered = boosted.quad;
      edgeTightness = boosted.tightness;
      meanEdgeOffset = boosted.meanOffset;
    }
  }




  const m = { areaRatio, edgeScore, edgeTightness, a4Score, meanEdgeOffset, statsMean: stats.mean, contrast };

  // Adaptive tightness threshold. Stricter for big docs, gentler for
  // small docs that already pass A4/edge/contrast sanity above.
  const tightnessThreshold =
    adaptiveQualifies && a4Score >= 0.75 && contrast >= 28 ? 0.34 : 0.45;
  if (adaptiveQualifies) {
    lastDetectDiagnostics.adaptiveUsed = {
      areaRatio,
      originalTightness,
      boostedTightness: edgeTightness,
      threshold: tightnessThreshold,
      edgeScore,
      a4Score,
      contrast,
      accepted: edgeTightness >= tightnessThreshold,
    };
  }

  // Compute strict-gate failure (if any) WITHOUT short-circuit returning.
  // This lets us record a generous "overlay candidate" with the actual
  // reason it's not capture-ready, while preserving the original reject
  // counters and bestRejected behavior.
  let strictReason: string | null = null;
  if (edgeScore < 0.18) strictReason = "edgeScoreLow";
  else if (stats.mean < 135) strictReason = "interiorTooDark";
  else if (stats.brightRatio < 0.55) strictReason = "notEnoughPaperPixels";
  else if (stats.darkRatio > 0.32) strictReason = "tooMuchDarkContent";
  else if (stats.mean - stats.exteriorMean < 12) strictReason = "lowPaperBgContrast";
  else if (edgeTightness < tightnessThreshold)
    strictReason = adaptiveQualifies ? "edgeTightnessLowAdaptive" : "edgeTightnessLow";

  // ===== Generous overlay candidate (feature-flagged) =====
  // Record best structurally-plausible quad regardless of strict-gate
  // outcome. detectDocumentQuad uses this only when caller passes
  // allowOverlay and no strict result wins.
  const ENABLE_GENEROUS_OVERLAY_DETECTION = true;
  if (
    ENABLE_GENEROUS_OVERLAY_DETECTION &&
    a4Score >= 0.5 &&
    areaRatio >= 0.04 &&
    areaRatio <= 0.95
  ) {
    const score =
      a4Score * 0.55 +
      clamp01(areaRatio / 0.5) * 0.3 +
      clamp01(edgeScore / 0.3) * 0.15;
    const prev = lastDetectDiagnostics.overlayBest;
    if (!prev || score > prev._score) {
      lastDetectDiagnostics.overlayBest = {
        corners: ordered.map((p) => ({ x: p.x, y: p.y })) as [Point, Point, Point, Point],
        a4Ratio,
        a4Score,
        edgeScore,
        edgeTightness,
        areaRatio,
        statsMean: stats.mean,
        contrast,
        confidence,
        reasonNotReady: strictReason,
        _score: score,
      };
    }
  }

  if (strictReason) {
    recordReject(strictReason, m);
    return null;
  }

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
      edgeTightness,
      meanEdgeOffset,
    },
  };
}

// Sobel gradient magnitude (3x3). Returns one float per pixel, with border
// pixels left at 0. Used by the snap refiner so each side of the candidate
// polygon can be pulled onto the strongest perpendicular edge.
function sobelMagnitude(
  lum: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height);
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
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

// Snap each polygon side onto the strongest perpendicular gradient peak in
// a small search window. Returns the refined quad, the fraction of sampled
// side-points that found a strong gradient (tightness), and the mean
// remaining perpendicular offset to the gradient peak (in source pixels).
function refineQuadToEdges(
  quad: [Point, Point, Point, Point],
  gradMag: Float32Array,
  edgeThreshold: number,
  width: number,
  height: number,
): { quad: [Point, Point, Point, Point]; tightness: number; meanOffset: number } | null {
  const minDim = Math.min(width, height);
  // Search ±~4% of the short side perpendicular to each side. Big enough to
  // cover the dilation slack from contour extraction; small enough not to
  // jump onto neighbouring keyboards or table-edge lines.
  const searchRadius = Math.max(6, Math.round(minDim * 0.04));
  const SAMPLES_PER_SIDE = 28;
  const minPeak = edgeThreshold * 0.65;

  // For each side, collect [t in 0..1, perpendicular offset, peak] hits.
  type Sample = { t: number; offset: number; peak: number };
  const allOffsets: number[] = [];
  let totalSamples = 0;
  let totalHits = 0;
  // Refined sides expressed as new endpoints. Initially identical to input.
  const refined: [Point, Point, Point, Point] = [
    { ...quad[0] },
    { ...quad[1] },
    { ...quad[2] },
    { ...quad[3] },
  ];

  // Process each side independently, then rebuild corners as intersections
  // of adjacent refined sides at the end.
  const refinedLines: Array<{ a: Point; b: Point } | null> = [null, null, null, null];

  for (let side = 0; side < 4; side++) {
    const a = quad[side];
    const b = quad[(side + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    // Perpendicular pointing OUTWARD from the quad centroid. We bias outward
    // because the contour-extracted polygon tends to be slightly inside, but
    // we still search both directions.
    const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
    const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    let nx = -ty;
    let ny = tx;
    if ((midX - cx) * nx + (midY - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }

    const samples: Sample[] = [];
    for (let s = 1; s < SAMPLES_PER_SIDE - 1; s++) {
      const t = s / (SAMPLES_PER_SIDE - 1);
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      totalSamples++;

      let bestOffset = 0;
      let bestPeak = 0;
      for (let r = -searchRadius; r <= searchRadius; r++) {
        const sx = Math.round(px + nx * r);
        const sy = Math.round(py + ny * r);
        if (sx < 1 || sy < 1 || sx >= width - 1 || sy >= height - 1) continue;
        const m = gradMag[sy * width + sx];
        if (m > bestPeak) {
          bestPeak = m;
          bestOffset = r;
        }
      }
      if (bestPeak >= minPeak) {
        samples.push({ t, offset: bestOffset, peak: bestPeak });
        allOffsets.push(Math.abs(bestOffset));
        totalHits++;
      }
    }

    // Need enough samples to fit a stable line. Otherwise keep original side.
    if (samples.length >= 8) {
      // Weighted least-squares fit of offset vs t (so the snapped side is
      // still a straight line — robust against a stray hit on a keyboard
      // key that would otherwise yank one end of the side outward).
      let sw = 0;
      let swt = 0;
      let swo = 0;
      let swtt = 0;
      let swto = 0;
      for (const s of samples) {
        const w = s.peak;
        sw += w;
        swt += w * s.t;
        swo += w * s.offset;
        swtt += w * s.t * s.t;
        swto += w * s.t * s.offset;
      }
      const denom = sw * swtt - swt * swt;
      let slope = 0;
      let intercept = swo / Math.max(1, sw);
      if (Math.abs(denom) > 1e-6) {
        slope = (sw * swto - swt * swo) / denom;
        intercept = (swo - slope * swt) / sw;
      }
      // Drop outliers (>1.6× MAD) and refit once for stability.
      const residuals = samples
        .map((s) => Math.abs(s.offset - (slope * s.t + intercept)))
        .sort((x, y) => x - y);
      const mad = residuals[Math.floor(residuals.length / 2)] || 1;
      const kept = samples.filter(
        (s) => Math.abs(s.offset - (slope * s.t + intercept)) <= Math.max(2, mad * 1.6),
      );
      if (kept.length >= 8) {
        sw = 0;
        swt = 0;
        swo = 0;
        swtt = 0;
        swto = 0;
        for (const s of kept) {
          const w = s.peak;
          sw += w;
          swt += w * s.t;
          swo += w * s.offset;
          swtt += w * s.t * s.t;
          swto += w * s.t * s.offset;
        }
        const d2 = sw * swtt - swt * swt;
        if (Math.abs(d2) > 1e-6) {
          slope = (sw * swto - swt * swo) / d2;
          intercept = (swo - slope * swt) / sw;
        }
      }
      // Endpoints t=0 and t=1 along the refined line.
      const off0 = intercept;
      const off1 = slope + intercept;
      refinedLines[side] = {
        a: { x: a.x + nx * off0, y: a.y + ny * off0 },
        b: { x: b.x + nx * off1, y: b.y + ny * off1 },
      };
    } else {
      refinedLines[side] = { a: { ...a }, b: { ...b } };
    }
  }

  // Rebuild the 4 corners as intersections of adjacent refined sides.
  for (let i = 0; i < 4; i++) {
    const prev = refinedLines[(i + 3) % 4]!;
    const next = refinedLines[i]!;
    const p = lineIntersection(prev.a, prev.b, next.a, next.b);
    if (p) refined[i] = clampPoint(p, width, height);
  }

  const finalQuad = orderQuad(refined);
  const tightness = totalSamples > 0 ? totalHits / totalSamples : 0;
  const meanOffset =
    allOffsets.length > 0 ? allOffsets.reduce((a, b) => a + b, 0) / allOffsets.length : 999;
  return { quad: finalQuad, tightness, meanOffset };
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const x1 = p1.x,
    y1 = p1.y,
    x2 = p2.x,
    y2 = p2.y,
    x3 = p3.x,
    y3 = p3.y,
    x4 = p4.x,
    y4 = p4.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

// === Hough-line document candidates ===
// Standard Hough Transform over the binary edge map. For each edge pixel
// votes into (rho, theta); local maxima above a length threshold become
// candidate lines. We then classify each line into one of {top, bottom,
// left, right} by orientation + position relative to the frame centre,
// pick the strongest few per side and intersect every combination → quads.
// All combinatorial output is bounded to HOUGH_MAX_QUADS so the caller
// can run them through evaluateEdgeQuad cheaply.
type HoughLine = { rho: number; theta: number; votes: number };

function houghTransform(
  edges: Uint8Array,
  width: number,
  height: number,
): HoughLine[] {
  const thetaStep = (HOUGH_THETA_STEP_DEG * Math.PI) / 180;
  const nTheta = Math.ceil(Math.PI / thetaStep);
  const cosT = new Float32Array(nTheta);
  const sinT = new Float32Array(nTheta);
  for (let t = 0; t < nTheta; t++) {
    const a = t * thetaStep;
    cosT[t] = Math.cos(a);
    sinT[t] = Math.sin(a);
  }
  const diag = Math.ceil(Math.hypot(width, height));
  const nRho = Math.ceil((2 * diag) / HOUGH_RHO_STEP_PX) + 1;
  const acc = new Uint32Array(nTheta * nRho);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!edges[row + x]) continue;
      for (let t = 0; t < nTheta; t++) {
        const rho = x * cosT[t] + y * sinT[t];
        const ri = Math.round((rho + diag) / HOUGH_RHO_STEP_PX);
        acc[t * nRho + ri]++;
      }
    }
  }

  const minVotes = Math.max(
    24,
    Math.round(Math.min(width, height) * HOUGH_MIN_VOTES_FRAC),
  );
  const lines: HoughLine[] = [];
  const nmsT = 2;
  const nmsR = 3;
  for (let t = 0; t < nTheta; t++) {
    for (let r = 0; r < nRho; r++) {
      const v = acc[t * nRho + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -nmsT; dt <= nmsT && isMax; dt++) {
        const tt = t + dt;
        if (tt < 0 || tt >= nTheta) continue;
        for (let dr = -nmsR; dr <= nmsR; dr++) {
          if (dt === 0 && dr === 0) continue;
          const rr = r + dr;
          if (rr < 0 || rr >= nRho) continue;
          if (acc[tt * nRho + rr] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      const theta = t * thetaStep;
      const rho = r * HOUGH_RHO_STEP_PX - diag;
      lines.push({ rho, theta, votes: v });
    }
  }
  lines.sort((a, b) => b.votes - a.votes);
  return lines.slice(0, 64);
}

function houghLineQuadCandidates(
  edges: Uint8Array,
  gradMag: Float32Array,
  width: number,
  height: number,
): [Point, Point, Point, Point][] {
  const lines = houghTransform(edges, width, height);
  if (lines.length < 4) return [];

  const top: HoughLine[] = [];
  const bot: HoughLine[] = [];
  const left: HoughLine[] = [];
  const right: HoughLine[] = [];
  const tol = (HOUGH_ANGLE_TOL_DEG * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;

  for (const ln of lines) {
    const dh = Math.abs(ln.theta - Math.PI / 2); // near horizontal
    const dv = Math.min(ln.theta, Math.abs(ln.theta - Math.PI)); // near vertical
    if (dh < tol) {
      const sin = Math.sin(ln.theta);
      if (Math.abs(sin) < 0.15) continue;
      const yAtCx = (ln.rho - cx * Math.cos(ln.theta)) / sin;
      if (yAtCx < cy) top.push(ln);
      else bot.push(ln);
    } else if (dv < tol) {
      const cos = Math.cos(ln.theta);
      if (Math.abs(cos) < 0.15) continue;
      const xAtCy = (ln.rho - cy * Math.sin(ln.theta)) / cos;
      if (xAtCy < cx) left.push(ln);
      else right.push(ln);
    }
  }

  // Sprint 2 — sample the gradient magnitude along each candidate line inside
  // the image, returning (meanGradient, supportFraction, lengthInside). A real
  // A4 edge has both high mean gradient (sharp paper/desk transition) and high
  // support fraction (most of the line lies on actual edges). Text inside the
  // page produces high vote counts but low mean gradient over the line span.
  function lineQuality(ln: HoughLine): { meanGrad: number; support: number; lengthInside: number } {
    const c = Math.cos(ln.theta), s = Math.sin(ln.theta);
    // Find intersection of line with image bbox to get the in-image segment.
    const pts: Point[] = [];
    if (Math.abs(s) > 1e-6) {
      const y0 = ln.rho / s; if (y0 >= 0 && y0 <= height - 1) pts.push({ x: 0, y: y0 });
      const y1 = (ln.rho - (width - 1) * c) / s; if (y1 >= 0 && y1 <= height - 1) pts.push({ x: width - 1, y: y1 });
    }
    if (Math.abs(c) > 1e-6) {
      const x0 = ln.rho / c; if (x0 >= 0 && x0 <= width - 1) pts.push({ x: x0, y: 0 });
      const x1 = (ln.rho - (height - 1) * s) / c; if (x1 >= 0 && x1 <= width - 1) pts.push({ x: x1, y: height - 1 });
    }
    if (pts.length < 2) return { meanGrad: 0, support: 0, lengthInside: 0 };
    const a = pts[0], b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(8, Math.ceil(len));
    let sum = 0, hit = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const g = gradMag[y * width + x];
      sum += g;
      if (g > 25) hit++;
    }
    return { meanGrad: sum / Math.max(1, steps + 1), support: hit / Math.max(1, steps + 1), lengthInside: len };
  }

  // Cluster lines that are nearly identical (similar theta + rho) and keep
  // only the strongest representative per cluster. Prevents top-K being
  // saturated by 3 copies of the same edge.
  function clusterDedupe(arr: HoughLine[], scored: Map<HoughLine, number>): HoughLine[] {
    const sorted = arr.slice().sort((a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0));
    const kept: HoughLine[] = [];
    const thetaTol = (4 * Math.PI) / 180;
    const rhoTol = Math.max(8, Math.min(width, height) * 0.04);
    for (const ln of sorted) {
      let dup = false;
      for (const k of kept) {
        if (Math.abs(ln.theta - k.theta) < thetaTol && Math.abs(ln.rho - k.rho) < rhoTol) {
          dup = true; break;
        }
      }
      if (!dup) kept.push(ln);
      if (kept.length >= HOUGH_TOP_LINES_PER_SIDE) break;
    }
    return kept;
  }

  // Rank per side: combine vote-weight, gradient mean, support fraction, and
  // outwardness (lines closer to image border win — that's where A4 lives,
  // not text inside the page). Then dedupe near-duplicates.
  const qualCache = new Map<HoughLine, { meanGrad: number; support: number; lengthInside: number }>();
  function qual(ln: HoughLine) {
    let q = qualCache.get(ln);
    if (!q) { q = lineQuality(ln); qualCache.set(ln, q); }
    return q;
  }
  function rankHoriz(arr: HoughLine[], wantTop: boolean): HoughLine[] {
    const scored = new Map<HoughLine, number>();
    for (const ln of arr) {
      const sin = Math.sin(ln.theta);
      const y = (ln.rho - cx * Math.cos(ln.theta)) / sin;
      const outward = wantTop ? (cy - y) / cy : (y - cy) / cy;
      const q = qual(ln);
      const lengthScore = q.lengthInside / Math.max(1, width);
      // Equal weight to votes, gradient strength, line length, and outwardness.
      const score =
        ln.votes * 0.30 +
        q.meanGrad * lengthScore * 0.35 * Math.min(width, height) * 0.01 +
        q.support * Math.min(width, height) * 0.20 +
        Math.max(0, outward) * Math.min(width, height) * 0.15;
      scored.set(ln, score);
    }
    return clusterDedupe(arr, scored);
  }
  function rankVert(arr: HoughLine[], wantLeft: boolean): HoughLine[] {
    const scored = new Map<HoughLine, number>();
    for (const ln of arr) {
      const cos = Math.cos(ln.theta);
      const x = (ln.rho - cy * Math.sin(ln.theta)) / cos;
      const outward = wantLeft ? (cx - x) / cx : (x - cx) / cx;
      const q = qual(ln);
      const lengthScore = q.lengthInside / Math.max(1, height);
      const score =
        ln.votes * 0.30 +
        q.meanGrad * lengthScore * 0.35 * Math.min(width, height) * 0.01 +
        q.support * Math.min(width, height) * 0.20 +
        Math.max(0, outward) * Math.min(width, height) * 0.15;
      scored.set(ln, score);
    }
    return clusterDedupe(arr, scored);
  }
  const topL = rankHoriz(top, true);
  const botL = rankHoriz(bot, false);
  const leftL = rankVert(left, true);
  const rightL = rankVert(right, false);
  if (!topL.length || !botL.length || !leftL.length || !rightL.length) return [];

  function lineToPoints(ln: HoughLine): [Point, Point] {
    const c = Math.cos(ln.theta);
    const s = Math.sin(ln.theta);
    const L = 5000;
    return [
      { x: c * ln.rho - L * s, y: s * ln.rho + L * c },
      { x: c * ln.rho + L * s, y: s * ln.rho - L * c },
    ];
  }

  const quads: [Point, Point, Point, Point][] = [];
  const margin = Math.max(20, Math.min(width, height) * 0.1);
  outer: for (const tt of topL) {
    const [t1, t2] = lineToPoints(tt);
    for (const bb of botL) {
      const [b1, b2] = lineToPoints(bb);
      for (const ll of leftL) {
        const [l1, l2] = lineToPoints(ll);
        for (const rr of rightL) {
          const [r1, r2] = lineToPoints(rr);
          const tl = lineIntersection(t1, t2, l1, l2);
          const tr = lineIntersection(t1, t2, r1, r2);
          const br = lineIntersection(b1, b2, r1, r2);
          const bl = lineIntersection(b1, b2, l1, l2);
          if (!tl || !tr || !br || !bl) continue;
          const pts: Point[] = [tl, tr, br, bl];
          let ok = true;
          for (const p of pts) {
            if (
              p.x < -margin ||
              p.y < -margin ||
              p.x > width + margin ||
              p.y > height + margin
            ) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const clamped: [Point, Point, Point, Point] = [
            clampPoint(tl, width, height),
            clampPoint(tr, width, height),
            clampPoint(br, width, height),
            clampPoint(bl, width, height),
          ];
          quads.push(orderQuad(clamped));
          if (quads.length >= HOUGH_MAX_QUADS) break outer;
        }
      }
    }
  }
  return quads;
}

function clampPoint(p: Point, width: number, height: number): Point {
  return {
    x: Math.max(0, Math.min(width - 1, p.x)),
    y: Math.max(0, Math.min(height - 1, p.y)),
  };
}

function polygonImageStats(
  quad: [Point, Point, Point, Point],
  lum: Uint8ClampedArray,
  width: number,
  height: number,
): { mean: number; darkRatio: number; brightRatio: number; exteriorMean: number } {
  const minX = Math.max(1, Math.floor(Math.min(...quad.map((p) => p.x))));
  const minY = Math.max(1, Math.floor(Math.min(...quad.map((p) => p.y))));
  const maxX = Math.min(width - 2, Math.ceil(Math.max(...quad.map((p) => p.x))));
  const maxY = Math.min(height - 2, Math.ceil(Math.max(...quad.map((p) => p.y))));

  // Centroid of the quad (used to define a slightly shrunk "inner" polygon so
  // we don't sample exactly on the document edge where a halo of background
  // can pollute brightness stats).
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const shrink = 0.92;
  const inner: [Point, Point, Point, Point] = [
    { x: cx + (quad[0].x - cx) * shrink, y: cy + (quad[0].y - cy) * shrink },
    { x: cx + (quad[1].x - cx) * shrink, y: cy + (quad[1].y - cy) * shrink },
    { x: cx + (quad[2].x - cx) * shrink, y: cy + (quad[2].y - cy) * shrink },
    { x: cx + (quad[3].x - cx) * shrink, y: cy + (quad[3].y - cy) * shrink },
  ];
  // Slightly expanded polygon used to sample the surrounding background ring.
  const grow = 1.12;
  const outer: [Point, Point, Point, Point] = [
    { x: cx + (quad[0].x - cx) * grow, y: cy + (quad[0].y - cy) * grow },
    { x: cx + (quad[1].x - cx) * grow, y: cy + (quad[1].y - cy) * grow },
    { x: cx + (quad[2].x - cx) * grow, y: cy + (quad[2].y - cy) * grow },
    { x: cx + (quad[3].x - cx) * grow, y: cy + (quad[3].y - cy) * grow },
  ];

  let sum = 0;
  let count = 0;
  let dark = 0;
  let bright = 0;
  // Fixed cutoffs — paper is bright (>=170), ink/keys/cables are dark (<110).
  const darkCutoff = 110;
  const brightCutoff = 170;

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      if (!pointInPolygon({ x, y }, inner)) continue;
      const value = lum[y * width + x];
      sum += value;
      count++;
      if (value < darkCutoff) dark++;
      if (value >= brightCutoff) bright++;
    }
  }

  const mean = count ? sum / count : 0;
  const darkRatio = count ? dark / count : 0;
  const brightRatio = count ? bright / count : 0;

  // Sample a ring just outside the quad (inside `outer`, outside `quad`) to
  // estimate background brightness.
  const oMinX = Math.max(1, Math.floor(Math.min(...outer.map((p) => p.x))));
  const oMinY = Math.max(1, Math.floor(Math.min(...outer.map((p) => p.y))));
  const oMaxX = Math.min(width - 2, Math.ceil(Math.max(...outer.map((p) => p.x))));
  const oMaxY = Math.min(height - 2, Math.ceil(Math.max(...outer.map((p) => p.y))));
  let extSum = 0;
  let extCount = 0;
  for (let y = oMinY; y <= oMaxY; y += 3) {
    for (let x = oMinX; x <= oMaxX; x += 3) {
      if (!pointInPolygon({ x, y }, outer)) continue;
      if (pointInPolygon({ x, y }, quad)) continue;
      extSum += lum[y * width + x];
      extCount++;
    }
  }
  const exteriorMean = extCount ? extSum / extCount : mean;

  return { mean, darkRatio, brightRatio, exteriorMean };
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
  // Sprint 1 — hård A4-gate (matchar evaluateEdgeQuad). Var 0.55 → 0.35.
  if (ratioError > 0.35) return null;
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
      edgeTightness: 0,
      meanEdgeOffset: 999,
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

export function orderQuad(quad: [Point, Point, Point, Point]): [Point, Point, Point, Point] {
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

function segmentAngle(a: Point, b: Point): number {
  return normalizeToHalfTurn((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

function normalizeToHalfTurn(angle: number): number {
  let a = ((angle + 90) % 180) - 90;
  if (a < -90) a += 180;
  return a;
}

function averageAngles(angles: number[]): number {
  if (!angles.length) return 0;
  let sx = 0;
  let sy = 0;
  for (const angle of angles) {
    const doubled = (angle * 2 * Math.PI) / 180;
    sx += Math.cos(doubled);
    sy += Math.sin(doubled);
  }
  return normalizeToHalfTurn((Math.atan2(sy, sx) * 90) / Math.PI);
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

/**
 * Laplacian-variance sharpness measure. Higher = sharper. A blurry frame on
 * a normalized 200–400px grayscale region typically scores <30, a clean
 * scan of text scores >100. Computed on RGBA `data` using a 4-neighbour
 * Laplacian kernel; restrict to `bbox` to ignore background pixels.
 */
export function laplacianVariance(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bbox?: { x0: number; y0: number; x1: number; y1: number },
): number {
  const x0 = Math.max(1, Math.floor(bbox?.x0 ?? 1));
  const y0 = Math.max(1, Math.floor(bbox?.y0 ?? 1));
  const x1 = Math.min(w - 1, Math.ceil(bbox?.x1 ?? w - 1));
  const y1 = Math.min(h - 1, Math.ceil(bbox?.y1 ?? h - 1));
  if (x1 <= x0 + 2 || y1 <= y0 + 2) return 0;
  const stride = w * 4;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * stride + x * 4;
      const c = (data[i] + data[i + 1] + data[i + 2]) * (1 / 3);
      const u = (data[i - stride] + data[i - stride + 1] + data[i - stride + 2]) * (1 / 3);
      const d = (data[i + stride] + data[i + stride + 1] + data[i + stride + 2]) * (1 / 3);
      const l = (data[i - 4] + data[i - 3] + data[i - 2]) * (1 / 3);
      const r = (data[i + 4] + data[i + 5] + data[i + 6]) * (1 / 3);
      const lap = u + d + l + r - 4 * c;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/**
 * Downscale a canvas and compute Laplacian variance on its central 80%.
 * Used after warp to verify the saved document is actually sharp.
 */
export function canvasLaplacianVariance(canvas: HTMLCanvasElement): number {
  const targetW = 400;
  const w = Math.min(targetW, canvas.width);
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const mx = Math.round(w * 0.1);
  const my = Math.round(h * 0.1);
  return laplacianVariance(id.data, w, h, { x0: mx, y0: my, x1: w - mx, y1: h - my });
}

/**
 * Standard deviation of luma across the canvas interior. Used as a
 * post-capture "is this actually a document?" gate — a uniformly grey
 * or blown-out frame scores very low here.
 */
export function canvasContrast(canvas: HTMLCanvasElement): number {
  const targetW = 320;
  const w = Math.min(targetW, canvas.width);
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const mx = Math.round(w * 0.1);
  const my = Math.round(h * 0.1);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = my; y < h - my; y += 2) {
    for (let x = mx; x < w - mx; x += 2) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += lum;
      sumSq += lum * lum;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return Math.sqrt(variance);
}

/**
 * Subpixel refinement of the four document corners on a full-resolution
 * source canvas. For each corner we sample a small window of luma,
 * compute the local Sobel gradient magnitude, and shift the corner toward
 * the weighted centroid of strong-edge pixels (where the real paper edge
 * lives). Movement is hard-clamped to ±MAX_SHIFT_PX so the refinement can
 * never drag a corner onto the wrong edge — worst case it stays put.
 */
export function refineQuadCorners(
  source: HTMLCanvasElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
  quad: [Point, Point, Point, Point],
): [Point, Point, Point, Point] {
  const WINDOW = 21; // half-size 10px around the corner
  const HALF = (WINDOW - 1) / 2;
  const MAX_SHIFT_PX = 5;
  const MIN_GRAD = 30; // ignore noise

  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = WINDOW;
  sampleCanvas.height = WINDOW;
  const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true })!;

  const refined = quad.map((p) => {
    const sx = Math.round(Math.max(HALF, Math.min(srcW - HALF - 1, p.x)));
    const sy = Math.round(Math.max(HALF, Math.min(srcH - HALF - 1, p.y)));
    sctx.clearRect(0, 0, WINDOW, WINDOW);
    sctx.drawImage(
      source as CanvasImageSource,
      sx - HALF, sy - HALF, WINDOW, WINDOW,
      0, 0, WINDOW, WINDOW,
    );
    const { data } = sctx.getImageData(0, 0, WINDOW, WINDOW);
    const lum = new Float32Array(WINDOW * WINDOW);
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
      lum[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    // Sobel + weighted centroid of strong edges in window-local coords.
    let mx = 0;
    let my = 0;
    let mw = 0;
    for (let y = 1; y < WINDOW - 1; y++) {
      for (let x = 1; x < WINDOW - 1; x++) {
        const i = y * WINDOW + x;
        const gx =
          -lum[i - WINDOW - 1] - 2 * lum[i - 1] - lum[i + WINDOW - 1] +
          lum[i - WINDOW + 1] + 2 * lum[i + 1] + lum[i + WINDOW + 1];
        const gy =
          -lum[i - WINDOW - 1] - 2 * lum[i - WINDOW] - lum[i - WINDOW + 1] +
          lum[i + WINDOW - 1] + 2 * lum[i + WINDOW] + lum[i + WINDOW + 1];
        const mag = Math.hypot(gx, gy);
        if (mag < MIN_GRAD) continue;
        mx += x * mag;
        my += y * mag;
        mw += mag;
      }
    }
    if (mw <= 0) return { x: p.x, y: p.y };
    const wx = mx / mw - HALF; // shift relative to window centre
    const wy = my / mw - HALF;
    // Hard clamp so a noisy window can never drag the corner more than a few px.
    const dx = Math.max(-MAX_SHIFT_PX, Math.min(MAX_SHIFT_PX, wx));
    const dy = Math.max(-MAX_SHIFT_PX, Math.min(MAX_SHIFT_PX, wy));
    // Bias the shift slightly outward — paper edges sit just beyond the
    // detected corner more often than just inside (Sobel-snap tends to
    // overshoot inward by 1–2px on the 280px detect frame).
    const outX = p.x - cx >= 0 ? 1 : -1;
    const outY = p.y - cy >= 0 ? 1 : -1;
    return {
      x: Math.max(0, Math.min(srcW - 1, sx + dx + 0.5 * outX)),
      y: Math.max(0, Math.min(srcH - 1, sy + dy + 0.5 * outY)),
    };
  }) as [Point, Point, Point, Point];

  return refined;
}

/**
 * Recompute edge tightness directly from the full-resolution source for an
 * already-detected quad. Does NOT change the quad or any corners — only
 * measures how well each of the four sides aligns with a strong gradient in
 * the hi-res frame. Useful for small/far documents where the 280px detect
 * frame has too few samples per edge to reach a confident tightness score.
 *
 * For each side we render a thin perpendicular strip (length × (2·BAND+1))
 * by rotating the source so the side lies along the strip's centre row.
 * For every column we find the row with the strongest vertical gradient;
 * a column counts as "tight" when that peak is within ±TOL of the centre
 * AND the peak magnitude exceeds MIN_GRAD.
 *
 * Returned tightness is on the same 0..1 scale as the 280px-path value.
 */
export function computeHiResEdgeTightness(
  source: HTMLCanvasElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
  quad: [Point, Point, Point, Point],
): { tightness: number; perSide: [number, number, number, number]; samples: number } | null {
  const BAND = 6;
  const TOL = 2;
  const MIN_GRAD = 22;
  const MAX_STRIP_W = 600;

  const sides: Array<[Point, Point]> = [
    [quad[0], quad[1]],
    [quad[1], quad[2]],
    [quad[2], quad[3]],
    [quad[3], quad[0]],
  ];

  const strip = document.createElement("canvas");
  const sctx = strip.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;

  const perSide: number[] = [];
  let totalTight = 0;
  let totalCols = 0;

  for (const [p1, p2] of sides) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) {
      perSide.push(0);
      continue;
    }
    const angle = Math.atan2(dy, dx);
    const stripW = Math.min(Math.round(len), MAX_STRIP_W);
    const stripH = 2 * BAND + 1;
    if (strip.width !== stripW || strip.height !== stripH) {
      strip.width = stripW;
      strip.height = stripH;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, stripW, stripH);
    // Map strip column x ∈ [0, stripW) to source point along p1→p2; strip
    // row BAND is exactly on the line, rows above/below are perpendicular.
    const scale = stripW / len;
    sctx.translate(0, BAND);
    sctx.scale(scale, 1);
    sctx.rotate(-angle);
    sctx.translate(-p1.x, -p1.y);
    try {
      sctx.drawImage(source as CanvasImageSource, 0, 0, srcW, srcH);
    } catch {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      perSide.push(0);
      continue;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    const { data } = sctx.getImageData(0, 0, stripW, stripH);
    const lum = new Float32Array(stripW * stripH);
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
      lum[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    let tightCount = 0;
    for (let x = 0; x < stripW; x++) {
      let bestMag = 0;
      let bestRow = -1;
      for (let y = 1; y < stripH - 1; y++) {
        const a = lum[(y - 1) * stripW + x];
        const b = lum[(y + 1) * stripW + x];
        const mag = b > a ? b - a : a - b;
        if (mag > bestMag) {
          bestMag = mag;
          bestRow = y;
        }
      }
      if (bestMag >= MIN_GRAD && bestRow >= 0 && Math.abs(bestRow - BAND) <= TOL) {
        tightCount++;
      }
    }
    perSide.push(stripW > 0 ? tightCount / stripW : 0);
    totalTight += tightCount;
    totalCols += stripW;
  }

  if (totalCols === 0) return null;
  return {
    tightness: clamp01(totalTight / totalCols),
    perSide: perSide as [number, number, number, number],
    samples: totalCols,
  };
}

/**
 * Snap each side of the detected quad onto the strongest local edge in the
 * full-resolution frame. For each of the 4 sides we render a perpendicular
 * strip of width = side length, height = 2*BAND+1, then for every column we
 * find the row with the maximum |∂L/∂y|. The median offset from the centre
 * row tells us how far the whole side is from the real paper edge — we then
 * translate that side perpendicular by the median offset (clamped). Final
 * quad corners are recomputed as intersections of adjacent snapped sides.
 *
 * Wider search window (±BAND px) than refineQuadCorners (±5 px), so even
 * detections that land a few mm off the paper can be pulled exactly onto
 * the edge. Median-based ⇒ robust to text/lines crossing the strip.
 */
/**
 * Defensive "snap to paper edges" pass. For each of the 4 sides we search a
 * narrow band perpendicular to the side for a stronger luminance gradient
 * than the one the detector already found. We only accept the snap when:
 *   - enough columns vote for an offset (≥40% of sampled columns)
 *   - the new edge's median gradient strength is ≥1.3× the on-line strength
 *   - the suggested shift is within MAX_SHIFT (clamped, never amplified)
 *
 * Parameters are scaled to the source's short side so behaviour is stable
 * across detection resolutions:
 *   - search radius  ≈ ±2.3% of short side  (≈12 px at 520, ≈25 px at 1080)
 *   - max shift      ≈ ±1.2% of short side  (≈6  px at 520, ≈13 px at 1080)
 *
 * On any failure (per-side or globally) the original quad is returned
 * unchanged — this pass is allowed to be a no-op, never a regression.
 */
export function snapQuadToPaperEdges(
  source: HTMLCanvasElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
  quad: [Point, Point, Point, Point],
): [Point, Point, Point, Point] {
  const shortSide = Math.min(srcW, srcH);
  const BAND = Math.max(10, Math.round(shortSide * 0.023));      // ± search window
  const MAX_SHIFT = Math.max(5, Math.round(shortSide * 0.012));  // hard clamp per side
  const MIN_GRAD = 14;            // ignore weak gradients (noise, faint text)
  const STRENGTH_RATIO = 1.3;     // new edge must beat current line by this factor
  const MIN_COL_FRACTION = 0.4;   // ≥40% of sampled columns must agree
  const SAMPLE_COLS = 20;         // sparse column sampling per side
  const MAX_STRIP_W = 800;

  const sides: Array<[Point, Point]> = [
    [quad[0], quad[1]], // top
    [quad[1], quad[2]], // right
    [quad[2], quad[3]], // bottom
    [quad[3], quad[0]], // left
  ];

  const strip = document.createElement("canvas");
  const sctx = strip.getContext("2d", { willReadFrequently: true });
  if (!sctx) return quad;

  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;

  const offsets: number[] = [];
  const normals: Array<{ nx: number; ny: number }> = [];

  for (const [p1, p2] of sides) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 10) {
      offsets.push(0);
      normals.push({ nx: 0, ny: 0 });
      continue;
    }
    const angle = Math.atan2(dy, dx);
    let nx = -dy / len;
    let ny = dx / len;
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    if ((midX - cx) * nx + (midY - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    normals.push({ nx, ny });

    const stripW = Math.min(Math.round(len), MAX_STRIP_W);
    const stripH = 2 * BAND + 1;
    if (strip.width !== stripW || strip.height !== stripH) {
      strip.width = stripW;
      strip.height = stripH;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.fillStyle = "#000";
    sctx.fillRect(0, 0, stripW, stripH);
    const scale = stripW / len;
    sctx.translate(0, BAND);
    sctx.scale(scale, 1);
    sctx.rotate(-angle);
    sctx.translate(-p1.x, -p1.y);
    try {
      sctx.drawImage(source as CanvasImageSource, 0, 0, srcW, srcH);
    } catch {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      offsets.push(0);
      continue;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    const { data } = sctx.getImageData(0, 0, stripW, stripH);
    const lum = new Float32Array(stripW * stripH);
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
      lum[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // Sparse column sampling: SAMPLE_COLS evenly spaced columns.
    const cols: number[] = [];
    const onLineStrengths: number[] = [];
    const stride = Math.max(1, Math.floor(stripW / SAMPLE_COLS));
    for (let x = Math.floor(stride / 2); x < stripW; x += stride) {
      let bestSigned = 0;
      let bestRow = -1;
      for (let y = 2; y < stripH - 2; y++) {
        const inside = lum[(y - 1) * stripW + x];
        const outside = lum[(y + 1) * stripW + x];
        const signed = inside - outside; // >0 = bright→dark going outward
        if (signed > bestSigned) {
          bestSigned = signed;
          bestRow = y;
        }
      }
      // On-line strength = signed gradient at the current edge (row = BAND).
      const onInside = lum[(BAND - 1) * stripW + x];
      const onOutside = lum[(BAND + 1) * stripW + x];
      onLineStrengths.push(Math.max(0, onInside - onOutside));

      if (bestSigned >= MIN_GRAD && bestRow >= 0) {
        cols.push(bestRow - BAND);
      }
    }

    if (cols.length < SAMPLE_COLS * MIN_COL_FRACTION) {
      offsets.push(0);
      continue;
    }

    const sorted = [...cols].sort((a, b) => a - b);
    const medianOffset = sorted[Math.floor(sorted.length / 2)];

    // Strength gate: median best gradient must beat median on-line gradient
    // by STRENGTH_RATIO. Otherwise the detector's edge is already good
    // enough; snapping risks chasing texture/text instead of the paper edge.
    const bestStrengths: number[] = [];
    for (let x = Math.floor(stride / 2), idx = 0; x < stripW && idx < cols.length; x += stride) {
      // recompute best signed for this column (cheap; already done above)
      let bestSigned = 0;
      for (let y = 2; y < stripH - 2; y++) {
        const inside = lum[(y - 1) * stripW + x];
        const outside = lum[(y + 1) * stripW + x];
        const signed = inside - outside;
        if (signed > bestSigned) bestSigned = signed;
      }
      bestStrengths.push(bestSigned);
      idx++;
    }
    const medianBest = bestStrengths.sort((a, b) => a - b)[Math.floor(bestStrengths.length / 2)] ?? 0;
    const medianOnLine = onLineStrengths.sort((a, b) => a - b)[Math.floor(onLineStrengths.length / 2)] ?? 0;

    if (medianBest < Math.max(MIN_GRAD, medianOnLine * STRENGTH_RATIO)) {
      // Current edge is already strong; don't move it.
      offsets.push(0);
      continue;
    }

    // Asymmetric snap: only allow the side to move *outward* (away from the
    // quad centroid). Inward snap is unsafe because a row of text just inside
    // the paper edge looks like a strong bright→dark transition and would
    // pull the frame in, cropping the last text line. Outward snap is safe:
    // worst case we include a sliver of background, which is then trimmed by
    // cropToWhiteEdges. Positive medianOffset = outward (see strip mapping).
    const clamped = Math.max(0, Math.min(MAX_SHIFT, medianOffset));
    offsets.push(clamped);
  }

  // Shift each side perpendicular by its offset (in source px), then
  // intersect adjacent sides to recover corners.
  type Line = { p: Point; d: Point };
  const lines: Line[] = sides.map(([p1, p2], i) => {
    const n = normals[i];
    const o = offsets[i];
    return {
      p: { x: p1.x + n.nx * o, y: p1.y + n.ny * o },
      d: { x: p2.x - p1.x, y: p2.y - p1.y },
    };
  });

  function intersect(a: Line, b: Line): Point | null {
    const denom = a.d.x * b.d.y - a.d.y * b.d.x;
    if (Math.abs(denom) < 1e-6) return null;
    const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / denom;
    return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
  }

  const newCorners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = lines[(i + 3) % 4];
    const next = lines[i];
    const ip = intersect(prev, next);
    if (!ip || !Number.isFinite(ip.x) || !Number.isFinite(ip.y)) {
      newCorners.push(quad[i]);
    } else {
      newCorners.push({
        x: Math.max(0, Math.min(srcW - 1, ip.x)),
        y: Math.max(0, Math.min(srcH - 1, ip.y)),
      });
    }
  }

  // Safety: if any corner moved more than 2× MAX_SHIFT (geometric blow-up
  // from a near-parallel intersection), abort and return the original quad.
  for (let i = 0; i < 4; i++) {
    const moved = Math.hypot(newCorners[i].x - quad[i].x, newCorners[i].y - quad[i].y);
    if (moved > MAX_SHIFT * 2) return quad;
  }

  return newCorners as [Point, Point, Point, Point];
}

/**
 * "Smart whitening" — flat-field background correction that makes the paper
 * uniformly white WITHOUT touching ink. Strategy:
 *
 *   1. Estimate per-pixel background brightness with a wide max-filter on
 *      luminance (max ignores dark ink, so the background estimate reflects
 *      the actual paper colour even under text).
 *   2. Divide each pixel by background to flatten shadows/lighting; clamp
 *      so very dark areas don't blow up.
 *   3. Blend toward original by a weight that goes to 0 for dark pixels:
 *      bright (paper) → fully whitened; dark (text) → unchanged. This is
  *      the key difference from naïve flat-fielding — text strokes are
 *      mathematically protected, not just statistically.
 *   4. Pure desaturation only on already-bright pixels so paper turns truly
 *      white, while coloured ink/stamps keep their hue.
 */
export function whitenBackground(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  // Downsample for background estimation.
  const longEdge = Math.max(w, h);
  const SCALE = Math.max(1, Math.round(longEdge / 320));
  const sw = Math.max(1, Math.floor(w / SCALE));
  const sh = Math.max(1, Math.floor(h / SCALE));

  const small = new Float32Array(sw * sh);
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const x0 = sx * SCALE;
      const y0 = sy * SCALE;
      const x1 = Math.min(w, x0 + SCALE);
      const y1 = Math.min(h, y0 + SCALE);
      let s = 0;
      let c = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
          const i = (row + x) * 4;
          s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          c++;
        }
      }
      small[sy * sw + sx] = c ? s / c : 0;
    }
  }

  // Separable max-filter (radius ~8% of small image) — recovers paper
  // brightness under text and through small smudges. 5% var för litet för
  // täta textblock (svenska A4-brev): fönstret nådde aldrig vit marginal
  // och lämnade grå moln formade som styckena. 8% reach ≈ 128 px på en
  // 1654 px bred A4 → täcker ett helt stycke + lite till.
  const R = Math.max(4, Math.round(Math.max(sw, sh) * 0.08));
  const bgX = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < sw; x++) {
      let m = 0;
      const a = Math.max(0, x - R);
      const b = Math.min(sw - 1, x + R);
      for (let xx = a; xx <= b; xx++) {
        const v = small[row + xx];
        if (v > m) m = v;
      }
      bgX[row + x] = m;
    }
  }
  const bg = new Float32Array(sw * sh);
  for (let x = 0; x < sw; x++) {
    for (let y = 0; y < sh; y++) {
      let m = 0;
      const a = Math.max(0, y - R);
      const b = Math.min(sh - 1, y + R);
      for (let yy = a; yy <= b; yy++) {
        const v = bgX[yy * sw + x];
        if (v > m) m = v;
      }
      bg[y * sw + x] = m;
    }
  }
  // Light 3-tap smoothing on bg to avoid blocky artifacts on upsample.
  const bgS = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let s = 0;
      let c = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(sh - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(sw - 1, x + 1); xx++) {
          s += bg[yy * sw + xx];
          c++;
        }
      }
      bgS[y * sw + x] = s / c;
    }
  }

  // Per-pixel flat-field with text protection.
  // Bright threshold: pixels with L >= T_FULL are fully whitened; pixels
  // with L <= T_NONE (clearly text) are left exactly as-is; in between we
  // blend smoothly. This is the safety net that guarantees no faint stroke
  // gets bleached.
  const T_NONE = 128;
  const T_FULL = 178;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, y / SCALE);
    const sy0 = Math.floor(fy);
    const sy1 = Math.min(sh - 1, sy0 + 1);
    const wy = fy - sy0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, x / SCALE);
      const sx0 = Math.floor(fx);
      const sx1 = Math.min(sw - 1, sx0 + 1);
      const wx = fx - sx0;
      const b00 = bgS[sy0 * sw + sx0];
      const b10 = bgS[sy0 * sw + sx1];
      const b01 = bgS[sy1 * sw + sx0];
      const b11 = bgS[sy1 * sw + sx1];
      const bgVal =
        b00 * (1 - wx) * (1 - wy) +
        b10 * wx * (1 - wy) +
        b01 * (1 - wx) * wy +
        b11 * wx * wy;
      const k = 255 / Math.max(72, bgVal); // brightness multiplier
      const i = (y * w + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const bl = d[i + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * bl;
      // weight 0 (keep original) for dark pixels, 1 (full whiten) for bright
      let wt: number;
      if (L <= T_NONE) wt = 0;
      else if (L >= T_FULL) wt = 1;
      else wt = (L - T_NONE) / (T_FULL - T_NONE);

      let nr = r * k;
      let ng = g * k;
      let nb = bl * k;
      if (nr > 255) nr = 255;
      if (ng > 255) ng = 255;
      if (nb > 255) nb = 255;

      // Blend with original by wt (protects text).
      let or = r * (1 - wt) + nr * wt;
      let og = g * (1 - wt) + ng * wt;
      let ob = bl * (1 - wt) + nb * wt;

      // Pure desaturation for already-bright pixels — kills paper tint
      // without affecting text/stamps.
      if (wt >= 1) {
        const avg = (or + og + ob) / 3;
        const lifted = avg + (255 - avg) * 0.42;
        or = lifted;
        og = lifted;
        ob = lifted;
        if (lifted >= 218) {
          or = 255;
          og = 255;
          ob = 255;
        }
      }

      d[i] = or;
      d[i + 1] = og;
      d[i + 2] = ob;
    }
  }

  // Final paper cleanup: the flat-field step can still leave smooth neutral
  // mid-gray shadows/folds around the lower edge. Lift only low-detail,
  // low-saturation pixels; text strokes and antialiased glyph edges have local
  // contrast and are therefore protected.
  const postLum = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    postLum[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }
  const tmpLum = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      tmpLum[row + x] = ((postLum[row + xl] + 2 * postLum[row + x] + postLum[row + xr]) >> 2) as number;
    }
  }
  const blurLum = new Uint8ClampedArray(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : y;
      const yd = y < h - 1 ? y + 1 : y;
      blurLum[y * w + x] = ((tmpLum[yu * w + x] + 2 * tmpLum[y * w + x] + tmpLum[yd * w + x]) >> 2) as number;
    }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const L = postLum[j];
    if (L < 128 || L >= 238) continue;
    const detail = Math.abs(L - blurLum[j]);
    if (detail > 7) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC - minC;
    if (sat > 24) continue;
    const detailProtect = 1 - detail / 8;
    const satProtect = 1 - sat / 25;
    const strength = 0.72 * detailProtect * satProtect;
    const lift = (255 - L) * strength;
    d[i] = Math.min(255, r + lift);
    d[i + 1] = Math.min(255, g + lift);
    d[i + 2] = Math.min(255, b + lift);
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Mild local contrast boost targeted at ink only. After flat-field whitening
 * paper is clean and bright, but thin/light text (8–9pt body, page numbers,
 * footers) can look slightly washed out. We run a tiny unsharp mask and
 * apply it ONLY where the original is darker than `INK_THRESHOLD` — bright
 * paper pixels are untouched, so we never amplify sensor noise on the
 * background. Same approach Microsoft Lens uses in its Document mode.
 */
export function boostInkContrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  const lum = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    lum[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }

  // Light 3x3 box blur (separable).
  const tmp = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < w - 1 ? x + 1 : w - 1;
      tmp[row + x] = ((lum[row + x0] + lum[row + x] + lum[row + x1]) / 3) | 0;
    }
  }
  const blur = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y1 = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      blur[y * w + x] = ((tmp[y0 * w + x] + tmp[y * w + x] + tmp[y1 * w + x]) / 3) | 0;
    }
  }

  const AMOUNT = 0.38;
  const INK_THRESHOLD = 138;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const L = lum[j];
    if (L > INK_THRESHOLD) continue;
    const diff = L - blur[j];
    if (diff > -4 && diff < 4) continue;
    const ramp = L <= 108 ? 1 : 1 - (L - 108) / (INK_THRESHOLD - 108);
    const add = diff * AMOUNT * ramp;
    let r0 = d[i] + add;
    let g0 = d[i + 1] + add;
    let b0 = d[i + 2] + add;
    if (r0 < 0) r0 = 0; else if (r0 > 255) r0 = 255;
    if (g0 < 0) g0 = 0; else if (g0 > 255) g0 = 255;
    if (b0 < 0) b0 = 0; else if (b0 > 255) b0 = 255;
    d[i] = r0;
    d[i + 1] = g0;
    d[i + 2] = b0;
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Threshold-based paper finder. Used as a refinement just before warp when
 * the live edge detector's quad may include desk/background. Strategy:
 *
 *   1. Downsample the source to ~480px long edge, grayscale.
 *   2. Otsu threshold (paper is the bright class against darker desk/wood).
 *   3. Pick the largest 4-connected bright component (rejects highlights,
 *      sensor noise, and small specular bright spots).
 *   4. Reject if it touches all four borders (i.e. background itself is
 *      bright — Otsu gave a useless split, e.g. white paper on white desk).
 *   5. Find minimum-area oriented bounding box around its boundary points
 *      (angle scan in 1° steps). Those 4 corners are the paper quad.
 *   6. Map back to source-pixel coordinates and return TL,TR,BR,BL.
 *
 * Returns null if no plausible paper region is found — caller should fall
 * back to the edge-detector's quad.
 */
export function detectPaperByThreshold(
  source: HTMLCanvasElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
): [Point, Point, Point, Point] | null {
  const TARGET = 480;
  const scale = Math.min(1, TARGET / Math.max(srcW, srcH));
  const w = Math.max(16, Math.round(srcW * scale));
  const h = Math.max(16, Math.round(srcH * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;

  const lum = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < img.length; i += 4, j++) {
    lum[j] = (0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2]) | 0;
  }

  // Otsu threshold.
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[lum[i]]++;
  let total = 0;
  for (let v = 0; v < 256; v++) total += v * hist[v];
  let wB = 0;
  let sumB = 0;
  let maxVar = 0;
  let thr = 127;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (total - sumB) / wF;
    const bv = wB * wF * (mB - mF) * (mB - mF);
    if (bv > maxVar) {
      maxVar = bv;
      thr = v;
    }
  }
  // Slight floor — never let the threshold be so low that mid-gray desk
  // joins the paper class.
  if (thr < 100) thr = 100;

  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = lum[i] > thr ? 1 : 0;

  // Largest 4-connected bright component.
  const labels = new Int32Array(n);
  const stack: number[] = [];
  let label = 0;
  let bestLabel = -1;
  let bestArea = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!bin[idx] || labels[idx]) continue;
      label++;
      labels[idx] = label;
      stack.push(idx);
      let area = 0;
      while (stack.length) {
        const p = stack.pop()!;
        area++;
        const px = p % w;
        const py = (p / w) | 0;
        if (px > 0) {
          const q = p - 1;
          if (bin[q] && !labels[q]) {
            labels[q] = label;
            stack.push(q);
          }
        }
        if (px < w - 1) {
          const q = p + 1;
          if (bin[q] && !labels[q]) {
            labels[q] = label;
            stack.push(q);
          }
        }
        if (py > 0) {
          const q = p - w;
          if (bin[q] && !labels[q]) {
            labels[q] = label;
            stack.push(q);
          }
        }
        if (py < h - 1) {
          const q = p + w;
          if (bin[q] && !labels[q]) {
            labels[q] = label;
            stack.push(q);
          }
        }
      }
      if (area > bestArea) {
        bestArea = area;
        bestLabel = label;
      }
    }
  }
  if (bestLabel < 0 || bestArea < n * 0.06) return null;

  // Reject if component touches all 4 borders (background is bright too).
  let touchT = false, touchB = false, touchL = false, touchR = false;
  for (let x = 0; x < w; x++) {
    if (labels[x] === bestLabel) touchT = true;
    if (labels[(h - 1) * w + x] === bestLabel) touchB = true;
  }
  for (let y = 0; y < h; y++) {
    if (labels[y * w] === bestLabel) touchL = true;
    if (labels[y * w + w - 1] === bestLabel) touchR = true;
  }
  if (touchT && touchB && touchL && touchR) return null;

  // Collect boundary points of best component.
  const pts: number[] = []; // flat x,y pairs
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx] !== bestLabel) continue;
      let border = false;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        border = true;
      } else if (
        labels[idx - 1] !== bestLabel ||
        labels[idx + 1] !== bestLabel ||
        labels[idx - w] !== bestLabel ||
        labels[idx + w] !== bestLabel
      ) {
        border = true;
      }
      if (border) {
        pts.push(x, y);
      }
    }
  }
  if (pts.length < 32) return null;

  // Min-area oriented bounding box — 1° angle scan over [0, 90).
  let bestAreaBox = Infinity;
  let bestQuad: [Point, Point, Point, Point] | null = null;
  for (let deg = 0; deg < 90; deg++) {
    const a = (deg * Math.PI) / 180;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      const px = pts[k];
      const py = pts[k + 1];
      const u = px * cs + py * sn;
      const v = -px * sn + py * cs;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const areaBox = (maxU - minU) * (maxV - minV);
    if (areaBox < bestAreaBox) {
      bestAreaBox = areaBox;
      // Back-rotate corner (u,v) -> (x,y): x = u*cs - v*sn, y = u*sn + v*cs
      bestQuad = [
        { x: minU * cs - minV * sn, y: minU * sn + minV * cs }, // TL'
        { x: maxU * cs - minV * sn, y: maxU * sn + minV * cs }, // TR'
        { x: maxU * cs - maxV * sn, y: maxU * sn + maxV * cs }, // BR'
        { x: minU * cs - maxV * sn, y: minU * sn + maxV * cs }, // BL'
      ];
    }
  }
  if (!bestQuad) return null;

  // Sanity: aspect ratio of the OBB must be in a plausible range for a
  // photographed A4 (~0.4..2.5). Filters out long thin streaks of reflection.
  const sideA = Math.hypot(bestQuad[1].x - bestQuad[0].x, bestQuad[1].y - bestQuad[0].y);
  const sideB = Math.hypot(bestQuad[3].x - bestQuad[0].x, bestQuad[3].y - bestQuad[0].y);
  const aspect = sideA > 0 && sideB > 0 ? Math.max(sideA, sideB) / Math.min(sideA, sideB) : 0;
  if (aspect < 1.05 || aspect > 2.6) return null;

  // Scale back to source pixel coordinates and order TL,TR,BR,BL.
  const invX = srcW / w;
  const invY = srcH / h;
  const mapped = bestQuad.map((p) => ({
    x: Math.max(0, Math.min(srcW - 1, p.x * invX)),
    y: Math.max(0, Math.min(srcH - 1, p.y * invY)),
  })) as [Point, Point, Point, Point];
  return orderQuad(mapped);
}

// ============================================================================
// Gray-world white balance
// ============================================================================
//
// Removes a global colour cast (warm tungsten, cool fluorescent, yellowish
// daylight through curtains) by forcing the average of the brightest ~20% of
// pixels — which on a paper scan is overwhelmingly the page background — to
// be neutral grey. Run BEFORE whitenBackground so the flat-field step sees a
// neutral paper and doesn't bake the cast into the "white" target.
//
// Why "bright pixels only" and not classic full-frame gray-world: the page
// usually fills the frame after warp, but text/ink would pull the average
// off-neutral if we included every pixel. Sampling only the paper region
// gives a clean estimate of the illuminant.
export function grayWorldWhiteBalance(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  // First pass: build a luminance histogram to find the brightness threshold
  // that captures the top ~20% of pixels (= the paper background).
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const y = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0;
    hist[y]++;
  }
  const targetCount = Math.max(1, Math.floor(n * 0.2));
  let cum = 0;
  let threshold = 0;
  for (let v = 255; v >= 0; v--) {
    cum += hist[v];
    if (cum >= targetCount) {
      threshold = v;
      break;
    }
  }

  // Second pass: average R/G/B over those bright pixels only.
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = d[o];
    const g = d[o + 1];
    const b = d[o + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (y >= threshold) {
      sumR += r;
      sumG += g;
      sumB += b;
      cnt++;
    }
  }
  if (cnt === 0) return canvas;
  const meanR = sumR / cnt;
  const meanG = sumG / cnt;
  const meanB = sumB / cnt;
  // Use the green-channel mean as the neutral target — green is the most
  // perceptually-linear channel and least affected by chromatic aberration.
  const target = meanG;
  const gainR = target / Math.max(1, meanR);
  const gainG = 1;
  const gainB = target / Math.max(1, meanB);

  // Clamp gains so a wildly mis-detected illuminant can't shift everything by
  // more than ±25% (avoids over-correction on near-neutral scenes).
  const clamp = (g: number) => Math.max(0.75, Math.min(1.25, g));
  const gR = clamp(gainR);
  const gB = clamp(gainB);
  if (Math.abs(gR - 1) < 0.01 && Math.abs(gB - 1) < 0.01) return canvas;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = d[o] * gR;
    const b = d[o + 2] * gB;
    d[o] = r > 255 ? 255 : r;
    d[o + 2] = b > 255 ? 255 : b;
    // green unchanged (gainG === 1)
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ============================================================================
// Unsharp mask — gentle post-warp sharpening for text
// ============================================================================
//
// Classic unsharp: sharpened = original + amount * (original - blurred).
// Tuned for document text: small radius (~0.6px equivalent via 3x3 Gaussian),
// modest amount (~0.4), and a luminance threshold so we don't amplify sensor
// noise on the now-white paper. Operates on luminance only to avoid colour
// fringing on ink. Run AFTER whitenBackground.
export function unsharpMaskText(
  canvas: HTMLCanvasElement,
  options: { amount?: number; threshold?: number } = {},
): HTMLCanvasElement {
  const amount = options.amount ?? 0.4;
  const threshold = options.threshold ?? 4; // skip pixels where |orig-blur| < threshold
  const w = canvas.width;
  const h = canvas.height;
  if (w < 3 || h < 3) return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  // Build luminance plane.
  const lum = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0;
  }

  // 3x3 Gaussian blur (kernel: [1 2 1; 2 4 2; 1 2 1] / 16) — separable.
  const tmp = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      tmp[row + x] = ((lum[row + xl] + 2 * lum[row + x] + lum[row + xr]) >> 2) as number;
    }
  }
  const blur = new Uint8ClampedArray(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : y;
      const yd = y < h - 1 ? y + 1 : y;
      blur[y * w + x] = ((tmp[yu * w + x] + 2 * tmp[y * w + x] + tmp[yd * w + x]) >> 2) as number;
    }
  }

  // Apply sharpening to each channel, scaled by the luminance high-pass.
  for (let i = 0; i < n; i++) {
    const hp = lum[i] - blur[i];
    if (hp > -threshold && hp < threshold) continue;
    const boost = amount * hp;
    const o = i * 4;
    const r = d[o] + boost;
    const g = d[o + 1] + boost;
    const b = d[o + 2] + boost;
    d[o] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Crop the warped rectangle inward until all four edges are predominantly
// "paper white". Defends against detector mistakes where the source quad
// included a sliver of background (e.g. wooden table next to the paper).
//
// Algorithm: for each side, sample a thin strip (default 6 px) along the
// edge. If the strip's mean luminance is below `minMeanL` OR its luminance
// stddev is above `maxStdL` (texture/shadow), peel it off. Repeat per side
// up to `maxFraction` of that dimension. Pure 2D crop — no re-warp needed.
export function cropToWhiteEdges(
  canvas: HTMLCanvasElement,
  options: {
    stripPx?: number;
    minMeanL?: number;
    maxStdL?: number;
    /** Symmetric cap applied to all sides unless overridden. */
    maxFraction?: number;
    /** Per-axis caps. Override top/bottom and left/right independently. */
    maxTopBottom?: number;
    maxLeftRight?: number;
  } = {},
): { canvas: HTMLCanvasElement; cropped: { top: number; right: number; bottom: number; left: number } } {
  const stripPx = options.stripPx ?? 6;
  const minMeanL = options.minMeanL ?? 200;
  const maxStdL = options.maxStdL ?? 28;
  const baseFraction = options.maxFraction ?? 0.03;
  const fracTopBottom = options.maxTopBottom ?? baseFraction;
  const fracLeftRight = options.maxLeftRight ?? baseFraction;
  const w = canvas.width;
  const h = canvas.height;
  if (w < stripPx * 4 || h < stripPx * 4) {
    return { canvas, cropped: { top: 0, right: 0, bottom: 0, left: 0 } };
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lumAt = (x: number, y: number): number => {
    const o = (y * w + x) * 4;
    return (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0;
  };
  const sideStats = (
    side: "top" | "bottom" | "left" | "right",
    offset: number,
  ): { mean: number; std: number } => {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    if (side === "top" || side === "bottom") {
      const y0 = side === "top" ? offset : h - 1 - offset - stripPx;
      const y1 = y0 + stripPx;
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < w; x++) {
          const v = lumAt(x, y);
          sum += v;
          sumSq += v * v;
          n++;
        }
      }
    } else {
      const x0 = side === "left" ? offset : w - 1 - offset - stripPx;
      const x1 = x0 + stripPx;
      for (let y = 0; y < h; y++) {
        for (let x = x0; x < x1; x++) {
          const v = lumAt(x, y);
          sum += v;
          sumSq += v * v;
          n++;
        }
      }
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return { mean, std: Math.sqrt(Math.max(0, variance)) };
  };

  const maxTop = Math.floor(h * fracTopBottom);
  const maxBottom = Math.floor(h * fracTopBottom);
  const maxLeft = Math.floor(w * fracLeftRight);
  const maxRight = Math.floor(w * fracLeftRight);
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  const isPaperWhite = (s: { mean: number; std: number }) =>
    s.mean >= minMeanL && s.std <= maxStdL;
  // Peel one side at a time in the order that has the worst stats first.
  for (let iter = 0; iter < 64; iter++) {
    const sides = [
      { name: "top" as const, offset: top, max: maxTop },
      { name: "bottom" as const, offset: bottom, max: maxBottom },
      { name: "left" as const, offset: left, max: maxLeft },
      { name: "right" as const, offset: right, max: maxRight },
    ];
    let worst: { name: "top" | "bottom" | "left" | "right"; score: number } | null = null;
    for (const s of sides) {
      if (s.offset >= s.max) continue;
      const stat = sideStats(s.name, s.offset);
      if (isPaperWhite(stat)) continue;
      // Higher score = worse (darker or noisier).
      const score = (minMeanL - stat.mean) + (stat.std - maxStdL) * 2;
      if (!worst || score > worst.score) worst = { name: s.name, score };
    }
    if (!worst) break;
    if (worst.name === "top") top += stripPx;
    else if (worst.name === "bottom") bottom += stripPx;
    else if (worst.name === "left") left += stripPx;
    else right += stripPx;
  }
  if (top === 0 && bottom === 0 && left === 0 && right === 0) {
    return { canvas, cropped: { top: 0, right: 0, bottom: 0, left: 0 } };
  }
  const nw = w - left - right;
  const nh = h - top - bottom;
  const out = document.createElement("canvas");
  out.width = nw;
  out.height = nh;
  const octx = out.getContext("2d")!;
  octx.drawImage(canvas, left, top, nw, nh, 0, 0, nw, nh);
  return { canvas: out, cropped: { top, right, bottom, left } };
}

// ============================================================================
// Auto-straighten — fine rotation correction within ±3°
// ============================================================================
//
// Estimates a small skew angle using a horizontal-projection-variance
// (projection profile) score on a downsampled grayscale copy. Text-rich
// documents produce sharp dark/bright row alternation when rows are aligned
// with text baselines, which maximises the variance of the row-darkness
// histogram.
//
// Only applies the rotation when:
//   - |best angle| >= minApplyDeg (default 0.3°)
//   - confidence (best score / second-best non-adjacent score) is high
//     enough — avoids rotating photos / diagrams with no clear text rows.
//
// Hard-capped at ±maxAngleDeg (default 3°). Never performs 90°/180° flips.
// Rotates the full-resolution canvas with bilinear sampling, expanding the
// canvas and filling new corners with white.
export function autoStraighten(
  canvas: HTMLCanvasElement,
  options: {
    maxAngleDeg?: number;
    stepDeg?: number;
    minApplyDeg?: number;
    targetWidth?: number;
    minConfidence?: number;
  } = {},
): { canvas: HTMLCanvasElement; angleDeg: number; applied: boolean; confidence: number; reason?: string } {
  const maxAngleDeg = options.maxAngleDeg ?? 3;
  const stepDeg = options.stepDeg ?? 0.25;
  const minApplyDeg = options.minApplyDeg ?? 0.3;
  const targetWidth = options.targetWidth ?? 600;
  const minConfidence = options.minConfidence ?? 1.15;

  const W = canvas.width;
  const H = canvas.height;
  if (W < 32 || H < 32) {
    return { canvas, angleDeg: 0, applied: false, confidence: 0, reason: "too-small" };
  }

  // Downsample to ~targetWidth wide grayscale.
  const scale = Math.min(1, targetWidth / W);
  const dw = Math.max(32, Math.round(W * scale));
  const dh = Math.max(32, Math.round(H * scale));
  const tmp = document.createElement("canvas");
  tmp.width = dw;
  tmp.height = dh;
  const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
  tctx.drawImage(canvas, 0, 0, dw, dh);
  const img = tctx.getImageData(0, 0, dw, dh);
  const d = img.data;
  const n = dw * dh;
  // Darkness plane: 255 - luminance, so dark text => high values.
  const dark = new Float32Array(n);
  let meanDark = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    const v = 255 - l;
    dark[i] = v;
    meanDark += v;
  }
  meanDark /= n;
  // Subtract mean so uniform background contributes 0 variance.
  for (let i = 0; i < n; i++) dark[i] -= meanDark;

  // For each candidate angle, project pixels onto rotated rows and compute
  // variance of the row sums. We don't physically rotate; we bin each pixel
  // into its rotated-row index.
  const cx = dw / 2;
  const cy = dh / 2;
  const scoreAt = (angleDeg: number): number => {
    const a = (angleDeg * Math.PI) / 180;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);
    // Rotated row y' range. Use padded length to fit all pixels.
    const padH = Math.ceil(Math.abs(dw * sinA) + Math.abs(dh * cosA)) + 2;
    const offset = padH / 2;
    const rows = new Float32Array(padH);
    for (let y = 0; y < dh; y++) {
      const dy = y - cy;
      const baseY = dy * cosA + offset;
      const rowBase = y * dw;
      for (let x = 0; x < dw; x++) {
        const dx = x - cx;
        const yp = baseY - dx * sinA;
        const yi = yp | 0;
        if (yi >= 0 && yi < padH) rows[yi] += dark[rowBase + x];
      }
    }
    // Variance of row sums.
    let mean = 0;
    for (let i = 0; i < padH; i++) mean += rows[i];
    mean /= padH;
    let varSum = 0;
    for (let i = 0; i < padH; i++) {
      const v = rows[i] - mean;
      varSum += v * v;
    }
    return varSum / padH;
  };

  const angles: number[] = [];
  for (let a = -maxAngleDeg; a <= maxAngleDeg + 1e-6; a += stepDeg) {
    angles.push(Math.round(a * 1000) / 1000);
  }
  const scores = angles.map(scoreAt);
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;
  const bestAngle = angles[bestIdx];
  const bestScore = scores[bestIdx];

  // Second-best score outside ±1 step of the peak (so we measure peak vs
  // unrelated plateau, not the immediate neighbour).
  let secondBest = 0;
  for (let i = 0; i < scores.length; i++) {
    if (Math.abs(i - bestIdx) <= 1) continue;
    if (scores[i] > secondBest) secondBest = scores[i];
  }
  const confidence = secondBest > 0 ? bestScore / secondBest : Infinity;

  if (Math.abs(bestAngle) < minApplyDeg) {
    return { canvas, angleDeg: bestAngle, applied: false, confidence, reason: "below-min-angle" };
  }
  if (confidence < minConfidence) {
    return { canvas, angleDeg: bestAngle, applied: false, confidence, reason: "low-confidence" };
  }
  if (Math.abs(bestAngle) > maxAngleDeg) {
    return { canvas, angleDeg: bestAngle, applied: false, confidence, reason: "above-max-angle" };
  }

  // Rotate the full-res canvas by -bestAngle (to undo the detected skew).
  const rad = (-bestAngle * Math.PI) / 180;
  const sinA = Math.abs(Math.sin(rad));
  const cosA = Math.abs(Math.cos(rad));
  const newW = Math.ceil(W * cosA + H * sinA);
  const newH = Math.ceil(W * sinA + H * cosA);
  const out = document.createElement("canvas");
  out.width = newW;
  out.height = newH;
  const octx = out.getContext("2d")!;
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, newW, newH);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.translate(newW / 2, newH / 2);
  octx.rotate(rad);
  octx.drawImage(canvas, -W / 2, -H / 2);
  return { canvas: out, angleDeg: bestAngle, applied: true, confidence };
}
