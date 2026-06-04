// Perspective (homography) utilities for document deskewing.

export interface Point {
  x: number;
  y: number;
}

export interface DocumentAlignmentDiagnostics {
  input: { width: number; height: number };
  orientationCandidates: Array<{
    rotation: 0 | 90 | 180 | 270;
    width: number;
    height: number;
    textAngle: number;
    textScore: number;
    uprightScore: number;
    hasText: boolean;
    score: number;
  }>;
  selectedOrientationRotation: 0 | 90 | 180 | 270;
  documentAngleBeforeDeskew: number;
  textSkewAngle: number;
  textSkewScore: number;
  textHasText: boolean;
  verticalEdgeSkewAngle: number;
  verticalEdgeConfidence: number;
  leftEdgeAngle: number | null;
  rightEdgeAngle: number | null;
  appliedDeskewAngle: number;
  appliedDeskewSource: "vertical-edges" | "text" | "none";
  output: { width: number; height: number };
}

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

// Shadow removal via divisive flat-fielding using a max-filter background
// estimate. A max filter on luminance ignores ink (dark) and recovers the
// true paper brightness underneath shadows. Dividing the original by this
// background flattens shadows and uneven lighting before tone-curve work.
// Runs on a downsampled copy for speed; result is upsampled back.
export function removeShadows(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Downsample factor — target ~240px long edge for the background estimate.
  // Large enough to localize shadows, small enough to keep this fast.
  const longEdge = Math.max(w, h);
  const scale = Math.max(1, Math.round(longEdge / 240));
  const sw = Math.max(1, Math.floor(w / scale));
  const sh = Math.max(1, Math.floor(h / scale));

  // Build small luminance plane via simple block-average.
  const small = new Float32Array(sw * sh);
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const x0 = sx * scale;
      const y0 = sy * scale;
      const x1 = Math.min(w, x0 + scale);
      const y1 = Math.min(h, y0 + scale);
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
          const i = (row + x) * 4;
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          cnt++;
        }
      }
      small[sy * sw + sx] = cnt ? sum / cnt : 0;
    }
  }

  // Separable max filter — radius ~ 6% of the small image so it spans
  // multiple text lines and recovers paper brightness between glyphs.
  const r = Math.max(3, Math.round(Math.max(sw, sh) * 0.1));
  const bgX = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < sw; x++) {
      let m = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(sw - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) {
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
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(sh - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) {
        const v = bgX[yy * sw + x];
        if (v > m) m = v;
      }
      bg[y * sw + x] = m;
    }
  }

  // Light blur on the background (3-tap box) to avoid blocky artifacts when
  // we upsample.
  const bgBlur = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sum = 0;
      let cnt = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(sh - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(sw - 1, x + 1); xx++) {
          sum += bg[yy * sw + xx];
          cnt++;
        }
      }
      bgBlur[y * sw + x] = sum / cnt;
    }
  }

  // Apply: per full-res pixel, find background via bilinear sample, then
  // multiply each channel by (target / bg). Target = global high percentile
  // of the small bg so we don't over-brighten genuinely white paper.
  const sample = new Float32Array(bgBlur);
  sample.sort();
  const target = Math.max(200, sample[Math.floor(sample.length * 0.95)] || 230);

  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, y / scale);
    const sy0 = Math.floor(fy);
    const sy1 = Math.min(sh - 1, sy0 + 1);
    const wy = fy - sy0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, x / scale);
      const sx0 = Math.floor(fx);
      const sx1 = Math.min(sw - 1, sx0 + 1);
      const wx = fx - sx0;
      const b00 = bgBlur[sy0 * sw + sx0];
      const b10 = bgBlur[sy0 * sw + sx1];
      const b01 = bgBlur[sy1 * sw + sx0];
      const b11 = bgBlur[sy1 * sw + sx1];
      const bgVal =
        b00 * (1 - wx) * (1 - wy) +
        b10 * wx * (1 - wy) +
        b01 * (1 - wx) * wy +
        b11 * wx * wy;
      // Clamp so very dark regions (e.g. background outside paper) don't blow up.
      const k = target / Math.max(60, bgVal);
      const i = (y * w + x) * 4;
      let r0 = d[i] * k;
      let g0 = d[i + 1] * k;
      let b0 = d[i + 2] * k;
      if (r0 > 255) r0 = 255;
      if (g0 > 255) g0 = 255;
      if (b0 > 255) b0 = 255;
      d[i] = r0;
      d[i + 1] = g0;
      d[i + 2] = b0;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
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
  const whiteRef = Math.max(160, sample[Math.floor(n * 0.96)] || 210);

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
  const whiteTarget = n * 0.72;
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
    t = Math.pow(t, 1.65);
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

  // 8) Despeckle / clean-up pass — high-contrast scanner output otherwise
  //    leaves faint sensor noise on the white paper and stray dark pixels
  //    that print as visible specks. Two cheap operations fix this:
  //    a) snap near-white pixels (lum >= 238) to pure 255 white, killing
  //       virtually all background noise without touching real ink.
  //    b) remove isolated dark pixels: any dark pixel (lum < 90) whose
  //       4-neighbours are all bright (lum > 210) is treated as noise and
  //       flipped to white. Real text strokes always have dark neighbours,
  //       so they're preserved.
  const lum2 = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    lum2[j] = L;
    if (L >= 228) {
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const j = y * w + x;
      if (lum2[j] >= 90) continue;
      if (
        lum2[j - 1] > 210 &&
        lum2[j + 1] > 210 &&
        lum2[j - w] > 210 &&
        lum2[j + w] > 210
      ) {
        const i = j * 4;
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}


export function cleanPaperEdges(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !w || !h) return canvas;

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  // Max inward depth — generous enough to swallow soft shadow gradients
  // and stray background, but bounded so we never eat document body.
  const maxDepthX = Math.round(w * 0.18);
  const maxDepthY = Math.round(h * 0.18);
  // Sliding-window stop: we stop whitening only when the average luminance
  // of the last WINDOW pixels stays above PAPER_AVG. Single bright noise
  // pixels in a shadow band can't trigger an early stop.
  const PAPER_AVG = 244;
  const WINDOW = 24;

  const lumAt = (i: number) =>
    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const whitenPx = (i: number) => {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  };

  const sweep = (
    start: number,
    step: number,
    maxDepth: number,
    indexFn: (depth: number) => number,
  ) => {
    const buf: number[] = [];
    let sum = 0;
    let stopped = false;
    for (let d = 0; d < maxDepth; d++) {
      const i = indexFn(d);
      const l = lumAt(i);
      if (!stopped) {
        buf.push(l);
        sum += l;
        if (buf.length > WINDOW) sum -= buf.shift()!;
        if (buf.length === WINDOW && sum / WINDOW >= PAPER_AVG) {
          stopped = true;
          break;
        }
        whitenPx(i);
      }
    }
    void start;
    void step;
  };

  // Per row, sweep from left and from right.
  for (let y = 0; y < h; y++) {
    sweep(0, 1, maxDepthX, (d) => (y * w + d) * 4);
    sweep(0, 1, maxDepthX, (d) => (y * w + (w - 1 - d)) * 4);
  }
  // Per column, sweep from top and from bottom.
  for (let x = 0; x < w; x++) {
    sweep(0, 1, maxDepthY, (d) => (d * w + x) * 4);
    sweep(0, 1, maxDepthY, (d) => ((h - 1 - d) * w + x) * 4);
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function autoOrientAndDeskewDocument(
  canvas: HTMLCanvasElement,
  onDiagnostics?: (diagnostics: DocumentAlignmentDiagnostics) => void,
): HTMLCanvasElement {
  const sample = scaleCanvas(canvas, 420);
  const rotations = [0, 90, 180, 270] as const;
  // IMPORTANT: The perspective warp at capture-time already orients the
  // document the way the user framed it (the output aspect is chosen from
  // the detected quad geometry, so portrait stays portrait and landscape
  // stays landscape). Any 0°/90°/180°/270° rotation here was historically
  // driven by an unreliable text-direction heuristic that frequently
  // flipped pages upside-down. We disable it: do NOT auto-rotate by
  // 90/180/270 anymore. Only the fine deskew (< a few degrees) is kept
  // below, which is what produces "perfectly straight" A4 output.
  const bestRotation: (typeof rotations)[number] = 0;
  const orientationCandidates: DocumentAlignmentDiagnostics["orientationCandidates"] = [];
  // Run analysis purely for diagnostics — never act on it for rotation.
  for (const rotation of rotations) {
    const rotatedSample = rotateCanvas(sample, rotation);
    const analysis = estimateTextSkew(rotatedSample, 7, 0.5);
    orientationCandidates.push({
      rotation,
      width: rotatedSample.width,
      height: rotatedSample.height,
      textAngle: analysis.angle,
      textScore: analysis.score,
      uprightScore: analysis.uprightScore,
      hasText: analysis.hasText,
      score: analysis.hasText ? analysis.score * analysis.uprightScore : 0,
    });
  }
  const foundText = orientationCandidates.some((c) => c.hasText);


  let oriented = rotateCanvas(canvas, bestRotation);
  const skew = estimateTextSkew(oriented, 7, 0.25);
  const edgeSkew = estimateVerticalPaperEdgeSkew(oriented);
  const documentAngleBeforeDeskew = bestRotation + (edgeSkew.confidence > 0 ? edgeSkew.angle : 0);
  let appliedDeskewAngle = 0;
  let appliedDeskewSource: DocumentAlignmentDiagnostics["appliedDeskewSource"] = "none";

  if (edgeSkew.confidence >= 0.55 && Math.abs(edgeSkew.angle) > 0.5) {
    appliedDeskewAngle = edgeSkew.angle;
    appliedDeskewSource = "vertical-edges";
  } else if ((foundText || skew.hasText) && Math.abs(skew.angle) > 0.2) {
    appliedDeskewAngle = skew.angle;
    appliedDeskewSource = "text";
  }

  if (Math.abs(appliedDeskewAngle) > 0.001) {
    oriented = rotateCanvas(oriented, appliedDeskewAngle);
  }

  cleanPaperEdges(oriented);
  const finalCanvas = renderToA4Portrait(oriented);
  onDiagnostics?.({
    input: { width: canvas.width, height: canvas.height },
    orientationCandidates,
    selectedOrientationRotation: bestRotation,
    documentAngleBeforeDeskew,
    textSkewAngle: skew.angle,
    textSkewScore: skew.score,
    textHasText: skew.hasText,
    verticalEdgeSkewAngle: edgeSkew.angle,
    verticalEdgeConfidence: edgeSkew.confidence,
    leftEdgeAngle: edgeSkew.leftAngle,
    rightEdgeAngle: edgeSkew.rightAngle,
    appliedDeskewAngle,
    appliedDeskewSource,
    output: { width: finalCanvas.width, height: finalCanvas.height },
  });
  return finalCanvas;
}

export function measureQuadGeometry(quad: [Point, Point, Point, Point]): QuadGeometryDiagnostics {
  const ordered = orderQuad(quad);
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

function renderToA4Portrait(source: HTMLCanvasElement): HTMLCanvasElement {
  // 300 DPI A4 portrait (210 × 297 mm). Matches the capture resolution so
  // the final page stays sharp end-to-end with no extra downscale.
  const outW = 2480;
  const outH = Math.round(outW * Math.SQRT2);
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  const scale = Math.min(outW / source.width, outH / source.height);
  const drawW = source.width * scale;
  const drawH = source.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, (outW - drawW) / 2, (outH - drawH) / 2, drawW, drawH);
  return out;
}


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
}

const A4_RATIO = Math.SQRT2;
export const MIN_DOCUMENT_CONFIDENCE = 0.12;
export const MIN_EDGE_TIGHTNESS_FOR_CAPTURE = 0.55;


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
  // Raw gradient magnitude (Sobel) — used to snap the polygon sides onto
  // the strongest local edge with sub-pixel-class precision. Canny output
  // alone is too sparse to refine corner positions accurately.
  const gradMag = sobelMagnitude(blurred, width, height);
  const connectedEdges = closeEdgeGaps(edges, width, height);
  const components = edgeComponents(connectedEdges, width, height);
  const brightThreshold = Math.max(95, Math.min(225, otsuThreshold(hist, total) + 12));
  const paperMask = buildBrightPaperMask(lum, width, height, brightThreshold);
  components.push(...edgeComponents(maskBoundary(paperMask, width, height), width, height));
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
  let best: DocumentDetection | null = null;
  let bestScore = 0;
  for (const det of outerDetections) {
    const ratioError = Math.abs(det.a4Ratio - A4_RATIO) / A4_RATIO;
    const a4Score = clamp01(1 - ratioError / 0.9);
    const areaScore = clamp01(det.debug.areaRatio / 0.6); // saturates at 60% of frame
    const cx = (det.corners[0].x + det.corners[1].x + det.corners[2].x + det.corners[3].x) / 4;
    const cy = (det.corners[0].y + det.corners[1].y + det.corners[2].y + det.corners[3].y) / 4;
    const centerScore = clamp01(1 - (Math.hypot(cx - frameCx, cy - frameCy) / diag) * 2);
    // Outer-prioritized confidence: area dominates, then A4 match, then
    // edge support, then centeredness. Original confidence is folded in
    // at a small weight so we still reward clean edges over noise.
    const outerConfidence =
      0.45 * areaScore +
      0.2 * a4Score +
      0.15 * det.debug.edgeScore +
      0.1 * centerScore +
      0.1 * det.confidence;
    // Keep the original `confidence` field on the returned object so the
    // MIN_DOCUMENT_CONFIDENCE gate and downstream logging stay meaningful,
    // but pick the winner by outerConfidence.
    if (outerConfidence > bestScore) {
      bestScore = outerConfidence;
      best = det;
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
  const snap = refineQuadToEdges(ordered, gradMag, edgeThreshold, width, height);
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

  if (ratioError > 1.1) return null;
  if (perspectiveError > 4.5) return null;
  if (sideDeviation > 0.22) return null;
  if (polygonFill < 0.45 || polygonFill > 2.4) return null;

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
  const edgeTightness = snap ? snap.tightness : 0;
  const meanEdgeOffset = snap ? snap.meanOffset : 999;
  const tightScore = edgeTightness;

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
    0.25 * tightScore;

  if (edgeScore < 0.18) return null;
  if (stats.mean < 135) return null;
  if (stats.brightRatio < 0.55) return null;
  if (stats.darkRatio > 0.32) return null;
  if (stats.mean - stats.exteriorMean < 12) return null;
  // At least half the sampled side-points must snap onto a real gradient —
  // otherwise the polygon is sitting on noise, not on the document edge.
  if (edgeTightness < 0.45) return null;

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
