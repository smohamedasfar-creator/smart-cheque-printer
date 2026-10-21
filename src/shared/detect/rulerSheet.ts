// The ruler sheet: an A4 page the app prints with four black squares at known positions. Lay the cheque on it and
// take a phone photo: the squares give the photo's perspective and scale, so the cheque comes out straight and at
// its true size, just like a 300 DPI scan.
import { downscale, toGray, type Raster } from './imaging';

type Pt = { x: number; y: number };

export const RULER_SHEET = {
  width: 210,
  height: 297,
  /** Centres (mm) and side of the corner squares, in order top-left, top-right, bottom-left, bottom-right. */
  markers: [
    { x: 17, y: 17, size: 14 },
    { x: 193, y: 17, size: 14 },
    { x: 17, y: 280, size: 14 },
    { x: 193, y: 280, size: 14 },
  ],
  /** A small square beside the top-left one, so a person can see which way up the sheet is. */
  orientation: { x: 35, y: 17, size: 7 },
  /** Where to lay the cheque: filled grey, so a white cheque stands out from it. */
  box: { x: 26, y: 34, width: 158, height: 236 },
  /** The part of the sheet returned after straightening: just inside the grey box, so grey surrounds the cheque. */
  output: { x: 28, y: 36, width: 154, height: 232 },
};

/** Pixels per millimetre of the straightened photo (about 200 DPI). */
export const RULER_PX_PER_MM = 8;

/** The printable ruler sheet: corner squares, a box for the cheque, a 100 mm check line and short instructions. */
export function buildRulerSheetHtml(): string {
  const S = RULER_SHEET;
  const sq = (m: { x: number; y: number; size: number }) => `<rect x="${m.x - m.size / 2}" y="${m.y - m.size / 2}" width="${m.size}" height="${m.size}" fill="#000"/>`;
  const ticks: string[] = [];
  for (let mm = 0; mm <= 100; mm++) {
    const len = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.2;
    ticks.push(`<line x1="${55 + mm}" y1="${284}" x2="${55 + mm}" y2="${284 - len}" stroke="#000" stroke-width="${mm % 10 ? 0.15 : 0.3}"/>`);
    if (mm % 10 === 0) ticks.push(`<text x="${55 + mm}" y="290" font-size="3" text-anchor="middle">${mm}</text>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${S.width}mm ${S.height}mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: ${S.width}mm; height: ${S.height}mm; overflow: hidden; font-family: Arial, sans-serif; }
svg { position: absolute; left: 0; top: 0; }
</style></head><body>
<svg width="${S.width}mm" height="${S.height}mm" viewBox="0 0 ${S.width} ${S.height}">
${S.markers.map(sq).join('')}${sq(S.orientation)}
<rect x="${S.box.x}" y="${S.box.y}" width="${S.box.width}" height="${S.box.height}" fill="#8c8c8c"/>
<text x="105" y="12" font-size="4.2" text-anchor="middle" font-weight="bold">Smart Cheque Printer · ruler sheet</text>
<text x="105" y="23" font-size="3.4" text-anchor="middle">Lay the blank cheque on the grey box, fully inside it.</text>
<text x="105" y="28.5" font-size="3.4" text-anchor="middle">Take the photo from above with all four black squares in the picture.</text>
<line x1="55" y1="284" x2="155" y2="284" stroke="#000" stroke-width="0.3"/>${ticks.join('')}
<text x="105" y="295" font-size="3" text-anchor="middle">This ruler must measure exactly 100 mm. If not, print again at 100% scale (turn off "Fit to page").</text>
</svg></body></html>`;
}

/** The perspective map that takes the four `from` points to the four `to` points. */
export function homography(from: Pt[], to: Pt[]): (x: number, y: number) => Pt {
  // Solve the 8 unknowns (h33 = 1) by Gaussian elimination with partial pivoting.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  };
}

interface Blob {
  x: number;
  y: number;
  count: number;
}

/** Ink darker than this (0-255) can be a printed square. */
const DARK = 75;
const WORK_MAX_SIDE = 1100;

/** Solid, square-ish dark blobs (any rotation, mild perspective) in a grayscale image. */
function squareBlobs(img: Raster): Blob[] {
  const { width: w, height: h, data } = img;
  const seen = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start] >= DARK) continue;
    seen[start] = 1;
    stack.push(start);
    let [n, sx, sy, sxx, syy, sxy] = [0, 0, 0, 0, 0, 0];
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || data[q] >= DARK) continue;
        if ((q === p - 1 || q === p + 1) && Math.floor(q / w) !== y) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (n < 30) continue;
    // A filled square of side s has variance s²/12 in every direction: compare with its pixel count.
    const [mx, my] = [sx / n, sy / n];
    const [vx, vy, cxy] = [sxx / n - mx * mx, syy / n - my * my, sxy / n - mx * my];
    const tr = vx + vy;
    const det = vx * vy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const [l1, l2] = [tr / 2 + disc, tr / 2 - disc];
    if (l2 <= 0 || l1 / l2 > 2.5) continue;
    const predicted = 12 * Math.sqrt(l1 * l2);
    if (n < predicted * 0.75 || n > predicted * 1.25) continue;
    out.push({ x: mx + 0.5, y: my + 0.5, count: n });
  }
  return out;
}

const quadArea = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The four corner squares of the ruler sheet in the photo (pixels), in the order top-left, top-right, bottom-left, bottom-right. */
function findMarkers(gray: Raster): Pt[] | null {
  const blobs = squareBlobs(gray).sort((a, b) => b.count - a.count).slice(0, 10);
  let best: { pts: Blob[]; area: number } | null = null;
  for (let i = 0; i < blobs.length; i++)
    for (let j = i + 1; j < blobs.length; j++)
      for (let k = j + 1; k < blobs.length; k++)
        for (let l = k + 1; l < blobs.length; l++) {
          const pts = [blobs[i], blobs[j], blobs[k], blobs[l]];
          const counts = pts.map(p => p.count);
          if (Math.max(...counts) / Math.min(...counts) > 3) continue;
          const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
          const ordered = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
          const area = quadArea(ordered);
          if (!best || area > best.area) best = { pts: ordered, area };
        }
  if (!best) return null;
  // Clockwise order on screen; the sheet's short sides (top and bottom) are the shorter pair of opposite sides.
  const p = best.pts;
  const pairA = (dist(p[0], p[1]) + dist(p[2], p[3])) / 2;
  const pairB = (dist(p[1], p[2]) + dist(p[3], p[0])) / 2;
  const [shortSide, longSide] = [Math.min(pairA, pairB), Math.max(pairA, pairB)];
  const side = Math.sqrt(p.reduce((s, b) => s + b.count, 0) / 4);
  // It must look like the sheet: squares 14 mm against 176 x 263 mm between them, allowing for perspective.
  const S = RULER_SHEET;
  const sheetShort = S.markers[1].x - S.markers[0].x;
  const sheetLong = S.markers[2].y - S.markers[0].y;
  const sizeRatio = side / shortSide / (S.markers[0].size / sheetShort);
  const aspect = longSide / shortSide / (sheetLong / sheetShort);
  if (sizeRatio < 0.6 || sizeRatio > 1.6 || aspect < 0.75 || aspect > 1.3) return null;
  const [tl, tr, br, bl] = pairA < pairB ? [p[0], p[1], p[2], p[3]] : [p[1], p[2], p[3], p[0]];
  // And the small orientation square must sit beside exactly one corner square, where the sheet has it.
  const small = squareBlobs(gray).filter(b => b.count > side * side * 0.1 && b.count < side * side * 0.5);
  const gapPx = ((S.orientation.x - S.markers[0].x) / S.markers[0].size) * side;
  const beside = [tl, tr, br, bl].filter(m => small.some(b => Math.abs(dist(b, m) - gapPx) < gapPx * 0.45));
  if (beside.length !== 1) return null;
  return [tl, tr, bl, br];
}

function bilinearRgba(img: Raster, x: number, y: number, out: Uint8ClampedArray, o: number) {
  const c = img.channels;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= img.width || y0 + 1 >= img.height) {
    out[o] = out[o + 1] = out[o + 2] = 255;
    out[o + 3] = 255;
    return;
  }
  const tx = x - x0, ty = y - y0;
  for (let ch = 0; ch < 3; ch++) {
    const k = c === 1 ? 0 : ch;
    const at = (xx: number, yy: number) => img.data[(yy * img.width + xx) * c + k];
    out[o + ch] = at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
  }
  out[o + 3] = 255;
}

/**
 * Finds the ruler sheet in a photo and returns the cheque area straightened to true millimetres
 * (RULER_PX_PER_MM pixels per mm), or null when the photo does not show the sheet.
 */
export function rectifyRulerSheet(photo: Raster): { image: Raster; pxPerMm: number } | null {
  const gray = toGray(photo);
  const factor = Math.max(1, Math.ceil(Math.max(gray.width, gray.height) / WORK_MAX_SIDE));
  const work = downscale(gray, factor, 'avg');
  const markers = findMarkers(work);
  if (!markers) return null;
  const inPhoto = markers.map(m => ({ x: m.x * factor, y: m.y * factor }));
  const toPhoto = homography(RULER_SHEET.markers.map(m => ({ x: m.x, y: m.y })), inPhoto);
  const { x: ox, y: oy, width, height } = RULER_SHEET.output;
  const k = RULER_PX_PER_MM;
  const w = Math.round(width * k);
  const h = Math.round(height * k);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const p = toPhoto(ox + (u + 0.5) / k, oy + (v + 0.5) / k);
      bilinearRgba(photo, p.x - 0.5, p.y - 0.5, data, (v * w + u) * 4);
    }
  }
  return { image: { width: w, height: h, channels: 4, data }, pxPerMm: k };
}
