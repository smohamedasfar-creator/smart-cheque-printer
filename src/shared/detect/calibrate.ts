// Automatic print calibration from a scan of a test print.
// The test page prints two rows of dots across the whole page width. Wherever the cheque really sits in the printer,
// several dots land on it. The dots are evenly spaced and are small or large in a pattern where every 4 neighbours
// are unique, so the dots seen in a scan of the cheque tell exactly which part of the page landed on it: that is
// where the cheque sits, and so where the next print must go.
import { chequePointOnPage, footprint, sheetFor, type Placement } from '../print';
import type { ChequeLayout, FeedRotation } from '../types';
import { applyTransform, detectCheque } from './detectCheque';
import { toGray, type Raster } from './imaging';
import { locateByReference, uprightFromAffine } from './locate';

export const DOT_MM = { small: 5, large: 8 };
/** Distance between neighbouring dots. The two rows differ, so a cheque read the wrong way round cannot fit both. */
export const PITCH_MM = { lead: 11, trail: 13 };
/** The rows sit at different distances from the two ends of the cheque, so the app can tell which way round it went. */
export const ROW_INSETS_MM = { lead: 12, trail: 22 };
const EDGE_MM = 6;
/** Neighbouring dots that identify their place in the row. */
const WINDOW = 4;

type Pt = { x: number; y: number };
export type Disc = Pt & { large: boolean };
export type PatternDot = Pt & { size: number };

/** A binary de Bruijn sequence: every run of `n` bits appears once (as a cycle). */
function deBruijn(n: number): number[] {
  const a = new Array<number>(2 * n).fill(0);
  const seq: number[] = [];
  const db = (t: number, p: number) => {
    if (t > n) {
      if (n % p === 0) seq.push(...a.slice(1, p + 1));
      return;
    }
    a[t] = a[t - p];
    db(t + 1, p);
    for (let j = a[t - p] + 1; j < 2; j++) {
      a[t] = j;
      db(t + 1, t);
    }
  };
  db(1, 1);
  return seq;
}

/** Dot columns across the page: evenly spaced, small or large so that every 4 neighbours form a unique pattern. */
export function patternColumns(pageWidth: number, pitch: number): Array<{ x: number; large: boolean }> {
  const count = Math.floor((pageWidth - 2 * EDGE_MM) / pitch) + 1;
  // A cycle of order n has 2^n windows; laid out in a line it gives 2^n + n - 1 dots with no window repeated.
  let order = WINDOW;
  while (2 ** order + order - 1 < count) order++;
  const cycle = deBruijn(order);
  const bits = [...cycle, ...cycle.slice(0, order - 1)];
  const start = (pageWidth - (count - 1) * pitch) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: Math.round((start + i * pitch) * 100) / 100, large: bits[i] === 1 }));
}

function rowYs(layout: ChequeLayout, placement: Placement): { lead: number; trail: number } {
  const sheet = sheetFor(layout, placement.rotation);
  const [, footH] = footprint(layout, placement.rotation);
  const clampY = (y: number) => Math.min(Math.max(y, EDGE_MM), sheet.height - EDGE_MM);
  return { lead: clampY(placement.y + ROW_INSETS_MM.lead), trail: clampY(placement.y + footH - ROW_INSETS_MM.trail) };
}

/** The test page's dots, in page millimetres, for a cheque the app expects at `placement`. */
export function calibrationPattern(layout: ChequeLayout, placement: Placement): PatternDot[] {
  const rows = rowYs(layout, placement);
  const width = sheetFor(layout, placement.rotation).width;
  return (['lead', 'trail'] as const).flatMap(row =>
    patternColumns(width, PITCH_MM[row]).map(c => ({ x: c.x, y: rows[row], size: c.large ? DOT_MM.large : DOT_MM.small })),
  );
}

/** Ink darker than this (0-255) counts as printed. */
const DARK = 110;
/** A pixel belongs to a dot only if a square this far around it is all ink: thin lines and text never pass. */
const ERODE_MM = 1.2;

/** Centres (mm) of the solid round dots in an upright scan of the cheque, and whether each is a large dot. */
export function findDiscs(img: Raster, mmPerPx: number): Disc[] {
  const gray = toGray(img);
  const { width: w, height: h, data } = gray;
  // Summed-area table of dark pixels, so "is this whole square dark?" is a constant-time check.
  const sat = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x] < DARK ? 1 : 0;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(1, Math.round(ERODE_MM / mmPerPx));
  const full = (2 * r + 1) ** 2;
  const core = new Uint8Array(w * h);
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const [x0, y0, x1, y1] = [x - r, y - r, x + r + 1, y + r + 1];
      const sum = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      if (sum === full) core[y * w + x] = 1;
    }
  }
  // What survives is the middle of each solid blob: about 1.6 mm across for a small dot, 4.6 mm for a large one.
  const shrink = 2 * ERODE_MM * Math.SQRT2;
  const largeCore = (DOT_MM.small - shrink + DOT_MM.large - shrink) / 2;
  const maxCore = DOT_MM.large - shrink + 1;
  const found: Disc[] = [];
  const stack: number[] = [];
  for (let start = 0; start < core.length; start++) {
    if (!core[start]) continue;
    core[start] = 0;
    stack.push(start);
    let [n, sx, sy, minX, maxX, minY, maxY] = [0, 0, 0, w, 0, h, 0];
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      n++; sx += px; sy += py;
      if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py;
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < core.length && core[q]) { core[q] = 0; stack.push(q); }
    }
    const [bw, bh] = [(maxX - minX + 1) * mmPerPx, (maxY - minY + 1) * mmPerPx];
    if (bw <= maxCore && bh <= maxCore && Math.abs(bw - bh) <= 1) {
      found.push({ x: (sx / n + 0.5) * mmPerPx, y: (sy / n + 0.5) * mmPerPx, large: (bw + bh) / 2 >= largeCore });
    }
  }
  return found;
}

export interface ChequeLocation {
  /** Where the cheque really sits on the page (its print position), and which way round. */
  placement: Placement;
  /** The cheque went in the other way round from what the app expected. */
  flipped: boolean;
  /** Printed size divided by true size: 1 means the printer did not shrink or enlarge the page. */
  scale: number;
  matched: number;
}

const MATCH_MM = 0.8;
const ROW_MATCH_MM = 1.6;
/** The cheque never sits further than this from where the app expected it along the feed direction. */
const MAX_FEED_ERROR_MM = 20;
const turnHalf = (r: FeedRotation) => ((r + 180) % 360) as FeedRotation;

interface Candidate extends ChequeLocation {
  score: number;
  residual: number;
}

/**
 * Works out where the cheque sits on the page from the dots seen on it (cheque mm), for a test page printed for a
 * cheque expected at `expected`. Handles any sideways position, a cheque loaded the other way round, and reports a
 * printer that scales the page.
 */
export function locateCheque(found: Disc[], layout: ChequeLayout, expected: Placement): ChequeLocation | null {
  if (found.length < WINDOW) return null;
  const rows = rowYs(layout, expected);
  const width = sheetFor(layout, expected.rotation).width;
  const rowList = (['lead', 'trail'] as const).map(row => ({ y: rows[row], cols: patternColumns(width, PITCH_MM[row]) }));

  const tryScale = (s: number): Candidate | null => {
    let best: Candidate | null = null;
    for (const flipped of [false, true]) {
      const rotation = flipped ? turnHalf(expected.rotation) : expected.rotation;
      // Where each dot sits relative to the cheque's corner on the page, for this way round.
      const q = found.map(d => ({ ...chequePointOnPage(layout, rotation, d.x, d.y), large: d.large }));
      for (const anchor of q) {
        for (const anchorRow of rowList) {
          const ty = s * anchorRow.y - anchor.y;
          if (Math.abs(ty - expected.y) > MAX_FEED_ERROR_MM) continue;
          for (const col of anchorRow.cols) {
            if (col.large !== anchor.large) continue;
            const tx = s * col.x - anchor.x;
            let [matched, wrong, residual, sx, sy] = [0, 0, 0, 0, 0];
            for (const p of q) {
              const row = rowList.find(r => Math.abs(s * r.y - p.y - ty) <= ROW_MATCH_MM);
              if (!row) continue;
              const y = s * row.y - p.y;
              const near = row.cols.reduce((m, c) => (Math.abs(s * c.x - p.x - tx) < Math.abs(s * m.x - p.x - tx) ? c : m));
              const off = Math.abs(s * near.x - p.x - tx);
              if (off > MATCH_MM) continue;
              if (near.large !== p.large) { wrong++; continue; }
              matched++;
              residual += off;
              sx += s * near.x - p.x;
              sy += y;
            }
            if (matched < WINDOW) continue;
            const score = matched - 2 * wrong;
            const cand: Candidate = {
              placement: { rotation, x: Math.round((sx / matched) * 10) / 10 || 0, y: Math.round((sy / matched) * 10) / 10 || 0 },
              flipped, scale: s, matched, score, residual,
            };
            if (!best || score > best.score || (score === best.score && residual < best.residual)) best = cand;
          }
        }
      }
    }
    return best;
  };

  let best = tryScale(1);
  if (!best || best.matched < found.length * 0.8) {
    // Maybe the printer shrank or enlarged the page: find the scale that explains the dots best.
    for (let s = 0.7; s <= 1.1; s += 0.002) {
      const c = tryScale(s);
      if (c && (!best || c.score > best.score || (c.score === best.score && c.residual < best.residual))) best = c;
    }
  }
  if (!best) return null;
  return { placement: best.placement, flipped: best.flipped, scale: best.scale, matched: best.matched };
}

/** Allowed difference between printed and true size before the printer's own scaling must be fixed. */
export const SCALE_TOLERANCE = 0.015;

export interface CalibrationResult {
  ok: boolean;
  /** The print position that puts the ink in place, when the dots were found and the size is right. */
  placement?: Placement;
  location?: ChequeLocation;
  /** What happened, in plain words. */
  message: string;
}

/** Turns where the cheque was found into the new print position and a plain-words explanation. */
export function calibrationResult(expected: Placement, location: ChequeLocation): CalibrationResult {
  if (Math.abs(location.scale - 1) > SCALE_TOLERANCE) {
    return {
      ok: false,
      location,
      message: `The printer printed the page at ${Math.round(location.scale * 100)}% of its real size. In the printer's settings set the scale to 100% (turn off "Fit to page" or "Reduce/Enlarge"), then print the test again.`,
    };
  }
  const moved = Math.hypot(location.placement.x - expected.x, location.placement.y - expected.y);
  const parts = [
    location.flipped ? 'The cheque went in the other way round, so the app has turned the print to match.' : '',
    moved >= 0.3 ? `The cheque sat ${moved.toFixed(1)} mm from where the app expected. The print position now matches where it really sits.` : 'The print was already in the right place.',
  ];
  return { ok: true, placement: location.placement, location, message: parts.filter(Boolean).join(' ') };
}

/** Resolution of the upright cheque the dots are read from. */
const READ_PX_PER_MM = 6;

/**
 * Reads a scan or photo of a printed test cheque and works out the corrected print position. With the cheque's own
 * picture (`reference`, the uploaded blank leaf) and a scan resolution, the cheque is found by matching that picture,
 * which works whichever way round it was scanned and even when its edges do not show on the scanner lid.
 */
export function calibrateFromScan(image: Raster, dpi: number | null, layout: ChequeLayout, expected: Placement, reference?: Raster): CalibrationResult {
  if (reference && dpi) {
    const found = locateByReference(image, dpi / 25.4, reference, reference.width / layout.chequeWidth);
    if (!found) return { ok: false, message: 'Could not find this cheque in the scan. Scan the printed test cheque at 300 DPI, face down on the glass.' };
    const upright = uprightFromAffine(image, found, layout.chequeWidth, layout.chequeHeight, READ_PX_PER_MM);
    const location = locateCheque(findDiscs(upright, 1 / READ_PX_PER_MM), layout, expected);
    if (!location) return { ok: false, message: 'Could not find the black dots of the test print in this scan. Check the test printed on the cheque, then scan it again at 300 DPI.' };
    return calibrationResult(expected, location);
  }
  const detected = detectCheque({ image, dpi });
  const upright = applyTransform(toGray(image), detected.transform);
  // The template knows the cheque's true size, so the scan needs no resolution of its own.
  const mmPerPx = layout.chequeWidth / upright.width;
  const heightMm = upright.height * mmPerPx;
  if (Math.abs(heightMm - layout.chequeHeight) / layout.chequeHeight > 0.08) {
    return { ok: false, message: `This scan does not look like this cheque (it is ${Math.round(heightMm)} mm tall instead of ${Math.round(layout.chequeHeight)} mm). Scan the printed test cheque on its own.` };
  }
  const location = locateCheque(findDiscs(upright, mmPerPx), layout, expected);
  if (!location) {
    return { ok: false, message: 'Could not find the black dots of the test print in this scan. Check the test printed on the cheque, then scan it again at 300 DPI.' };
  }
  return calibrationResult(expected, location);
}
