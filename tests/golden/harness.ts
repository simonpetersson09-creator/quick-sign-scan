/**
 * Sprint 1 — A4-detektor golden-set
 *
 * Kör:  bun run tests/golden/harness.ts
 *
 * Lägg fixtures i tests/golden/fixtures/:
 *   foo.png           — fotot
 *   foo.json          — { "corners": [[x,y],[x,y],[x,y],[x,y]] } (tl,tr,br,bl i bildens pixlar)
 *
 * Harnessen skalar bilden till detektionsupplösning (DETECT_WIDTH),
 * kör detectDocumentQuad, och rapporterar IoU mot förväntade hörn.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { PNG } from "pngjs";
import { detectDocumentQuad, type Point } from "../../src/lib/perspective";

const DETECT_WIDTH = 416; // måste matcha scan.tsx
const FIXTURE_DIR = join(import.meta.dir, "fixtures");
const MIN_IOU = 0.85;

type Expected = { corners: [number, number][] };

function loadPng(path: string): { rgba: Uint8ClampedArray; w: number; h: number } {
  const png = PNG.sync.read(readFileSync(path));
  return { rgba: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), w: png.width, h: png.height };
}

function downscale(src: Uint8ClampedArray, sw: number, sh: number, tw: number): { data: Uint8ClampedArray; w: number; h: number } {
  const th = Math.round((sh * tw) / sw);
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / tw));
      const si = (sy * sw + sx) * 4;
      const di = (y * tw + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
  }
  return { data: out, w: tw, h: th };
}

function polyArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

// Sutherland–Hodgman polygon clipping for IoU between two quads.
function clip(subject: Point[], clipPoly: Point[]): Point[] {
  let output = subject.slice();
  for (let i = 0; i < clipPoly.length; i++) {
    if (output.length === 0) break;
    const a = clipPoly[i], b = clipPoly[(i + 1) % clipPoly.length];
    const input = output;
    output = [];
    const inside = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    const intersect = (p: Point, q: Point): Point => {
      const dx1 = b.x - a.x, dy1 = b.y - a.y;
      const dx2 = q.x - p.x, dy2 = q.y - p.y;
      const denom = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(denom) < 1e-9) return p;
      const t = ((p.x - a.x) * dy1 - (p.y - a.y) * dx1) / -denom;
      return { x: p.x + t * dx2, y: p.y + t * dy2 };
    };
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j - 1 + input.length) % input.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
    }
  }
  return output;
}

function iou(a: Point[], b: Point[]): number {
  const inter = polyArea(clip(a, b));
  const union = polyArea(a) + polyArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

function ensureCcw(p: Point[]): Point[] {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    s += (p[j].x - p[i].x) * (p[j].y + p[i].y);
  }
  return s > 0 ? p.slice().reverse() : p;
}

async function main() {
  if (!existsSync(FIXTURE_DIR)) {
    console.log(`Inga fixtures hittade. Skapa ${FIXTURE_DIR}/*.png + sidecar .json.`);
    return;
  }
  const files = readdirSync(FIXTURE_DIR).filter((f) => extname(f).toLowerCase() === ".png");
  if (files.length === 0) {
    console.log("Inga .png-fixtures ännu. Se tests/golden/README.md.");
    return;
  }

  let pass = 0, fail = 0;
  const rows: Array<{ name: string; iou: string; status: string; ms: string }> = [];

  for (const file of files) {
    const name = basename(file, ".png");
    const pngPath = join(FIXTURE_DIR, file);
    const jsonPath = join(FIXTURE_DIR, `${name}.json`);
    if (!existsSync(jsonPath)) {
      rows.push({ name, iou: "—", status: "NO_GT", ms: "—" });
      continue;
    }
    const gt: Expected = JSON.parse(readFileSync(jsonPath, "utf8"));
    const src = loadPng(pngPath);
    const scaled = downscale(src.rgba, src.w, src.h, DETECT_WIDTH);
    const sx = scaled.w / src.w;
    const sy = scaled.h / src.h;
    const t0 = performance.now();
    const det = detectDocumentQuad(scaled.data, scaled.w, scaled.h);
    const ms = (performance.now() - t0).toFixed(1);
    if (!det) {
      rows.push({ name, iou: "0.000", status: "MISS", ms });
      fail++;
      continue;
    }
    const expected = ensureCcw(gt.corners.map(([x, y]) => ({ x: x * sx, y: y * sy })));
    const detected = ensureCcw(det.corners);
    const score = iou(expected, detected);
    const ok = score >= MIN_IOU;
    if (ok) pass++; else fail++;
    rows.push({ name, iou: score.toFixed(3), status: ok ? "PASS" : "FAIL", ms });
  }

  console.log("\nGolden-set A4-detektor (DETECT_WIDTH=" + DETECT_WIDTH + ")");
  console.log("─".repeat(60));
  for (const r of rows) {
    console.log(`${r.status.padEnd(6)} IoU=${r.iou.padStart(5)}  ${r.ms.padStart(6)}ms  ${r.name}`);
  }
  console.log("─".repeat(60));
  console.log(`${pass} pass, ${fail} fail, ${rows.length} total (tröskel IoU ≥ ${MIN_IOU})`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
