// Finds a known cheque in a scan by matching it against the cheque's own picture (the uploaded blank leaf).
// Works without visible paper edges (a white cheque on a white scanner lid), in any of the four orientations and
// slightly crooked. Used to read test prints for calibration.
import { rotateQuarter, toGray, type Raster } from './imaging';

/** Maps cheque millimetres to scan pixels: px = a·x + c·y + e, py = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  /** How well the picture matched, 0..1. */
  score: number;
}

/** Below this the cheque is not in the scan. */
const MIN_SCORE = 0.35;
const COARSE_PX_PER_MM = 1;
/** Fine passes: a wider search on a 2 px/mm grid, then a narrow one at 4 px/mm. */
const PASSES = [
  { pxPerMm: 2, stride: 2, turnRange: 2.5, turnStep: 0.5, shiftRange: 4, shiftStep: 1 },
  { pxPerMm: 2, stride: 2, turnRange: 0.5, turnStep: 0.1, shiftRange: 1, shiftStep: 0.25 },
  { pxPerMm: 4, stride: 3, turnRange: 0.1, turnStep: 0.02, shiftRange: 0.25, shiftStep: 0.0625 },
];

/** Resizes a grayscale image by averaging the source pixels under each new pixel. */
function resample(img: Raster, scale: number): Raster {
  const g = toGray(img);
  const w = Math.max(1, Math.round(g.width * scale));
  const h = Math.max(1, Math.round(g.height * scale));
  const sat = new Float64Array((g.width + 1) * (g.height + 1));
  for (let y = 0; y < g.height; y++) {
    let row = 0;
    for (let x = 0; x < g.width; x++) {
      row += g.data[y * g.width + x];
      sat[(y + 1) * (g.width + 1) + x + 1] = sat[y * (g.width + 1) + x + 1] + row;
    }
  }
  const out: Raster = { width: w, height: h, channels: 1, data: new Uint8ClampedArray(w * h) };
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.min(g.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.min(g.width, Math.floor((x + 1) / scale)));
      const sum = sat[y1 * (g.width + 1) + x1] - sat[y0 * (g.width + 1) + x1] - sat[y1 * (g.width + 1) + x0] + sat[y0 * (g.width + 1) + x0];
      out.data[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function bilinear(img: Raster, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= img.width || y0 + 1 >= img.height) return 255;
  const tx = x - x0, ty = y - y0, w = img.width, d = img.data;
  const i = y0 * w + x0;
  return d[i] * (1 - tx) * (1 - ty) + d[i + 1] * tx * (1 - ty) + d[i + w] * (1 - tx) * ty + d[i + w + 1] * tx * ty;
}

/** Normalised cross-correlation of the template at every position in the image (step 1); best position and score. */
function bestPosition(img: Raster, tpl: Raster): { x: number; y: number; score: number } | null {
  const [W, H, w, h] = [img.width, img.height, tpl.width, tpl.height];
  if (w > W || h > H) return null;
  // Template, zero-mean and scaled to unit length, sampled on every 3rd pixel to keep this fast.
  const pts: Array<[number, number, number]> = [];
  let mean = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { pts.push([x, y, tpl.data[y * w + x]]); mean += tpl.data[y * w + x]; }
  mean /= pts.length;
  let norm = 0;
  for (const p of pts) { p[2] -= mean; norm += p[2] * p[2]; }
  norm = Math.sqrt(norm) || 1;
  for (const p of pts) p[2] /= norm;
  let best: { x: number; y: number; score: number } | null = null;
  const n = pts.length;
  for (let oy = 0; oy + h <= H; oy++) {
    for (let ox = 0; ox + w <= W; ox++) {
      let s = 0, sum = 0, sum2 = 0;
      for (let k = 0; k < n; k++) {
        const v = img.data[(oy + pts[k][1]) * W + ox + pts[k][0]];
        s += v * pts[k][2];
        sum += v;
        sum2 += v * v;
      }
      const varI = sum2 - (sum * sum) / n;
      if (varI <= 1e-6) continue;
      const score = s / Math.sqrt(varI);
      if (!best || score > best.score) best = { x: ox, y: oy, score };
    }
  }
  return best;
}

/** The cheque point (mm) after turning the cheque `q` quarter turns clockwise, in its footprint (mm). */
function quarterMatrix(q: number, W: number, H: number) {
  switch (q) {
    case 1: return { a: 0, b: 1, c: -1, d: 0, e: H, f: 0 };
    case 2: return { a: -1, b: 0, c: 0, d: -1, e: W, f: H };
    case 3: return { a: 0, b: -1, c: 1, d: 0, e: 0, f: W };
    default: return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
}

/**
 * Finds the reference cheque picture (`ref`, at `refPxPerMm`) in a scan (at `scanPxPerMm`) and returns the map from
 * cheque millimetres to scan pixels, or null when the cheque is not there.
 */
export function locateByReference(scan: Raster, scanPxPerMm: number, ref: Raster, refPxPerMm: number): Affine | null {
  const W = ref.width / refPxPerMm;
  const H = ref.height / refPxPerMm;
  // 1. Coarse: every position and quarter turn at 1 px/mm.
  const scanC = resample(scan, COARSE_PX_PER_MM / scanPxPerMm);
  const refC = resample(ref, COARSE_PX_PER_MM / refPxPerMm);
  let coarse: { q: number; x: number; y: number; score: number } | null = null;
  for (let q = 0; q < 4; q++) {
    const hit = bestPosition(scanC, rotateQuarter(refC, q));
    if (hit && (!coarse || hit.score > coarse.score)) coarse = { q, ...hit };
  }
  if (!coarse || coarse.score < MIN_SCORE) return null;

  // 2. Fine: small turn and shift around the coarse match, on a dense grid over the whole cheque picture (line ends,
  // logo and box corners pin it down in both directions; edge points alone slide along long lines).
  const M = quarterMatrix(coarse.q, W, H);
  const [footW, footH] = coarse.q % 2 ? [H, W] : [W, H];
  const centre = { x: footW / 2, y: footH / 2 };
  const origin0 = { x: coarse.x / COARSE_PX_PER_MM, y: coarse.y / COARSE_PX_PER_MM };
  // cheque mm -> scan mm for a turn θ (about the footprint centre) and the footprint's top-left at `o`
  const mapFor = (theta: number, o: { x: number; y: number }) => {
    const [cs, sn] = [Math.cos(theta), Math.sin(theta)];
    return (x: number, y: number) => {
      const px = M.a * x + M.c * y + M.e - centre.x;
      const py = M.b * x + M.d * y + M.f - centre.y;
      return { x: o.x + centre.x + cs * px - sn * py, y: o.y + centre.y + sn * px + cs * py };
    };
  };
  const scoreOf = (scanF: Raster, k: number, points: Array<{ x: number; y: number; v: number }>, theta: number, o: { x: number; y: number }) => {
    const map = mapFor(theta, o);
    let s = 0, sum = 0, sum2 = 0;
    for (const p of points) {
      const q = map(p.x, p.y);
      const v = bilinear(scanF, q.x * k - 0.5, q.y * k - 0.5);
      s += v * p.v;
      sum += v;
      sum2 += v * v;
    }
    const varI = sum2 - (sum * sum) / points.length;
    return varI > 1e-6 ? s / Math.sqrt(varI) : -1;
  };
  let best = { theta: 0, o: origin0, score: -1 };
  // Search wide then narrow: turn in degrees, shift in mm.
  for (const { pxPerMm, stride, turnRange, turnStep, shiftRange, shiftStep } of PASSES) {
    const scanF = resample(scan, pxPerMm / scanPxPerMm);
    const points = densePoints(resample(ref, pxPerMm / refPxPerMm), pxPerMm, stride);
    const around = best;
    best = { ...around, score: scoreOf(scanF, pxPerMm, points, around.theta, around.o) };
    for (let dt = -turnRange; dt <= turnRange + 1e-9; dt += turnStep) {
      const theta = around.theta + (dt * Math.PI) / 180;
      for (let dx = -shiftRange; dx <= shiftRange + 1e-9; dx += shiftStep) {
        for (let dy = -shiftRange; dy <= shiftRange + 1e-9; dy += shiftStep) {
          const o = { x: around.o.x + dx, y: around.o.y + dy };
          const score = scoreOf(scanF, pxPerMm, points, theta, o);
          if (score > best.score) best = { theta, o, score };
        }
      }
    }
  }
  if (best.score < MIN_SCORE) return null;
  // Compose into one affine map from cheque mm to scan pixels.
  const map = mapFor(best.theta, best.o);
  const o = map(0, 0), ex = map(1, 0), ey = map(0, 1);
  const k = scanPxPerMm;
  return { a: (ex.x - o.x) * k, b: (ex.y - o.y) * k, c: (ey.x - o.x) * k, d: (ey.y - o.y) * k, e: o.x * k, f: o.y * k, score: best.score };
}

/** The reference picture on a grid (every `stride` pixels), zero-mean and unit-length, in cheque mm. */
function densePoints(ref: Raster, pxPerMm: number, stride: number): Array<{ x: number; y: number; v: number }> {
  const pts: Array<{ x: number; y: number; v: number }> = [];
  for (let y = 0; y < ref.height; y += stride) for (let x = 0; x < ref.width; x += stride) pts.push({ x: (x + 0.5) / pxPerMm, y: (y + 0.5) / pxPerMm, v: ref.data[y * ref.width + x] });
  const mean = pts.reduce((s, p) => s + p.v, 0) / pts.length;
  const norm = Math.sqrt(pts.reduce((s, p) => s + (p.v - mean) ** 2, 0)) || 1;
  return pts.map(p => ({ x: p.x, y: p.y, v: (p.v - mean) / norm }));
}

/** Cuts the cheque out of the scan, upright and straight, at `pxPerMm` (grayscale). */
export function uprightFromAffine(scan: Raster, m: Affine, widthMm: number, heightMm: number, pxPerMm: number): Raster {
  const g = toGray(scan);
  const w = Math.round(widthMm * pxPerMm);
  const h = Math.round(heightMm * pxPerMm);
  const out: Raster = { width: w, height: h, channels: 1, data: new Uint8ClampedArray(w * h) };
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const x = (u + 0.5) / pxPerMm, y = (v + 0.5) / pxPerMm;
      out.data[v * w + u] = bilinear(g, m.a * x + m.c * y + m.e - 0.5, m.b * x + m.d * y + m.f - 0.5);
    }
  }
  return out;
}
