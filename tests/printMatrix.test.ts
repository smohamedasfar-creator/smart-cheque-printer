// End-to-end checks of where ink lands on the cheque, for every tray, feed direction, cheque size and position.
// The "virtual printer" below is written independently of the app's placement maths: it models how the sheet
// looks to the user in each tray, how the printer sees that sheet, and where the printer puts each point.
import { describe, expect, test } from 'vitest';
import {
  alignTrayView,
  buildPrintHtml,
  correctPlacement,
  defaultTrayView,
  flipPlacement,
  footprint,
  LEADING_EDGE,
  leafTransform,
  pageGeometry,
  pageToTray,
  printProblems,
  sheetFor,
  trayToPage,
  TRAY_KINDS,
  type Placement,
  type TrayKind,
  type TrayView,
} from '../src/shared/print';
import { blankLayout } from '../src/shared/layoutDefaults';
import { calibrationPattern, calibrationResult, DOT_MM, locateCheque } from '../src/shared/detect/calibrate';
import { correctionFromCorner } from '../src/shared/graph';
import { placementToShift } from '../src/shared/positions';
import { renderCheque } from '../src/shared/chequeRender';
import { DEFAULT_SETTINGS, type ChequeLayout, type FeedRotation, type TextItem } from '../src/shared/types';

const TURNS: FeedRotation[] = [0, 90, 180, 270];
/** Cheque sizes in mm: small, UK, the two real UAE leaves the app was tuned on, US business, and oversize. */
const SIZES: Array<[number, number]> = [
  [140, 65], [152, 70], [157.65, 79.93], [175, 80], [178, 89], [203, 89], [205.74, 87.21], [210, 99], [215.9, 88.9], [230, 95],
];
const SPOTS = ['centre', 'left', 'right', 'odd'] as const;

type Pt = { x: number; y: number };

/** Applies a CSS transform list ("translate(a, b) rotate(cdeg)", "scaleX(-1)", "none") to a point, origin 0 0. */
function applyCss(css: string, p: Pt): Pt {
  const ops = [...css.matchAll(/(translate|rotate|scaleX)\(([^)]*)\)/g)];
  let q = { ...p };
  // CSS applies the right-most function to the point first.
  for (const [, fn, args] of ops.reverse()) {
    const nums = args.split(',').map(a => parseFloat(a));
    if (fn === 'translate') q = { x: q.x + nums[0], y: q.y + (nums[1] ?? 0) };
    else if (fn === 'scaleX') q = { x: q.x * nums[0], y: q.y };
    else {
      const t = (nums[0] * Math.PI) / 180;
      q = { x: q.x * Math.cos(t) - q.y * Math.sin(t), y: q.x * Math.sin(t) + q.y * Math.cos(t) };
    }
  }
  return q;
}

/** Where a cheque point appears on the tray picture, in mm (what the user sees when loading the cheque). */
function seenInTray(layout: ChequeLayout, tray: TrayKind, view: TrayView, c: Pt): Pt {
  const [footW] = footprint(layout, view.turn);
  let q = applyCss(leafTransform(view.turn, layout.chequeWidth, layout.chequeHeight, ''), c);
  // The front drawer is drawn see-through (printed side down), i.e. mirrored inside the cheque's footprint.
  if (TRAY_KINDS[tray].mirrored) q = { x: footW - q.x, y: q.y };
  return { x: view.u + q.x, y: view.v + q.y };
}

/** How the printer sees the sheet: the page's top edge is the edge that goes in first, printed side towards the head. */
function trayToPrinter(tray: TrayKind, sheet: { width: number; height: number }, p: Pt): Pt {
  switch (tray) {
    // Standing at the back, printed side facing you, bottom edge goes in: you see the page upside down.
    case 'rear': return { x: sheet.width - p.x, y: sheet.height - p.y };
    // Lying printed side down, far edge goes in: seen from above (see-through) the page is mirrored.
    case 'front': return { x: sheet.width - p.x, y: p.y };
    // Lying printed side up, far edge goes in: seen from above it is the page as printed.
    case 'manual': return p;
  }
}

/** Reads the cheque box placement out of the print HTML and maps a cheque point to the page, like Chromium does. */
function printedAt(html: string, c: Pt): Pt {
  const m = /class="cheque" style="left:(-?[\d.]+)mm;top:(-?[\d.]+)mm;[^"]*transform:([^"]*)"/.exec(html);
  if (!m) throw new Error('no cheque box in the print page');
  const q = applyCss(m[3] === 'none' ? '' : m[3].replace(/mm/g, ''), c);
  return { x: Number(m[1]) + q.x, y: Number(m[2]) + q.y };
}

const near = (a: Pt, b: Pt, tol = 0.11) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

function layoutOf(w: number, h: number): ChequeLayout {
  return blankLayout(w, h);
}

function spot(layout: ChequeLayout, tray: TrayKind, turn: FeedRotation, s: (typeof SPOTS)[number]): TrayView {
  const base = defaultTrayView(layout, tray, turn);
  if (s === 'centre') return base;
  if (s === 'odd') return { ...base, u: base.u > 20 ? 17.3 : base.u };
  return alignTrayView(layout, tray, base, s);
}

/** The cheque points the tests follow: the four corners and the middle of every field. */
function probes(layout: ChequeLayout): Pt[] {
  const mid = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const date = layout.date.mode === 'line' ? layout.date.box : layout.date.boxes[0];
  return [
    { x: 0, y: 0 }, { x: layout.chequeWidth, y: 0 }, { x: 0, y: layout.chequeHeight }, { x: layout.chequeWidth, y: layout.chequeHeight },
    mid(layout.payee), mid(layout.amount), mid(layout.words1), mid(layout.words2), mid(date),
  ];
}

function printHtml(layout: ChequeLayout, p: Placement): string {
  const g = pageGeometry(layout, DEFAULT_SETTINGS, { rotation: p.rotation, x: p.x, y: p.y });
  return buildPrintHtml([], g, { fontFamily: 'Arial' });
}

const cases = TRAY_KINDS_LIST().flatMap(tray => TURNS.flatMap(turn => SIZES.flatMap(([w, h]) => SPOTS.map(s => ({ tray, turn, w, h, s })))));
function TRAY_KINDS_LIST(): TrayKind[] {
  return Object.keys(TRAY_KINDS) as TrayKind[];
}

describe('virtual printer: every tray, direction, size and position', () => {
  test('covers three kinds of tray', () => {
    expect(TRAY_KINDS_LIST().sort()).toEqual(['front', 'manual', 'rear']);
    expect(cases.length).toBe(3 * 4 * SIZES.length * SPOTS.length);
  });

  test('ink lands exactly where it belongs on the cheque', () => {
    const misses: string[] = [];
    for (const { tray, turn, w, h, s } of cases) {
      const layout = layoutOf(w, h);
      const view = spot(layout, tray, turn, s);
      const sheet = sheetFor(layout, turn);
      const html = printHtml(layout, trayToPage(layout, tray, view));
      for (const c of probes(layout)) {
        const truth = trayToPrinter(tray, sheet, seenInTray(layout, tray, view, c));
        const ink = printedAt(html, c);
        if (!near(ink, truth)) misses.push(`${tray} turn ${turn} ${w}x${h} ${s}: cheque (${c.x.toFixed(1)},${c.y.toFixed(1)}) inked at (${ink.x.toFixed(1)},${ink.y.toFixed(1)}) not (${truth.x.toFixed(1)},${truth.y.toFixed(1)})`);
      }
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  test('the tray picture and the saved page placement convert both ways', () => {
    for (const { tray, turn, w, h, s } of cases) {
      const layout = layoutOf(w, h);
      const view = spot(layout, tray, turn, s);
      const back = pageToTray(layout, tray, trayToPage(layout, tray, view));
      expect(back.turn).toBe(view.turn);
      // the saved placement and the picture are each rounded to 0.1 mm
      expect(near({ x: back.u, y: back.v }, { x: view.u, y: view.v }, 0.101)).toBe(true);
    }
  });

  test('the cheque is pushed fully in: its leading edge is the top of the page', () => {
    for (const { tray, turn, w, h } of cases) {
      const layout = layoutOf(w, h);
      expect(trayToPage(layout, tray, defaultTrayView(layout, tray, turn)).y).toBeCloseTo(0, 5);
    }
  });

  test('"which end goes in first" names the end that really goes in first', () => {
    // The printer pulls the page in from its top edge, so the named end must sit at the top of the page.
    const end = (layout: ChequeLayout, r: FeedRotation): Pt => {
      const { chequeWidth: w, chequeHeight: h } = layout;
      return { 0: { x: w / 2, y: 0 }, 180: { x: w / 2, y: h }, 90: { x: 0, y: h / 2 }, 270: { x: w, y: h / 2 } }[r];
    };
    expect(LEADING_EDGE[90]).toMatch(/logo/i);
    expect(LEADING_EDGE[270]).toMatch(/date/i);
    for (const tray of TRAY_KINDS_LIST()) {
      for (const r of TURNS) {
        const layout = layoutOf(205.74, 87.21);
        const view = defaultTrayView(layout, tray, TRAY_KINDS[tray].turnFor(r));
        const p = trayToPage(layout, tray, view);
        expect(p.rotation).toBe(r);
        const ink = printedAt(printHtml(layout, p), end(layout, r));
        expect(ink.y).toBeCloseTo(0, 1);
      }
    }
  });

  test('lining the cheque up with a guide puts it against that side of the tray picture', () => {
    for (const tray of TRAY_KINDS_LIST()) {
      for (const turn of TURNS) {
        const layout = layoutOf(157.65, 79.93);
        const sheet = sheetFor(layout, turn);
        const [footW] = footprint(layout, turn);
        const base = defaultTrayView(layout, tray, turn);
        expect(alignTrayView(layout, tray, base, 'left').u).toBe(0);
        expect(alignTrayView(layout, tray, base, 'right').u).toBeCloseTo(sheet.width - footW, 5);
        expect(alignTrayView(layout, tray, base, 'centre').u).toBeCloseTo((sheet.width - footW) / 2, 1);
        // lining up never moves the cheque in or out of the printer
        expect(alignTrayView(layout, tray, { ...base, v: 3 }, 'left').v).toBe(3);
      }
    }
  });
});

describe('virtual printer: fixing a test print by dragging', () => {
  /** A printer that puts everything (ex, ey) mm away on its page, and a cheque that really sits at `actual`. */
  function landsOnCheque(layout: ChequeLayout, tray: TrayKind, actual: TrayView, printed: Placement, error: Pt, c: Pt): Pt {
    const sheet = sheetFor(layout, actual.turn);
    const ink = printedAt(printHtml(layout, printed), c);
    const onPage = { x: ink.x + error.x, y: ink.y + error.y };
    // Find the cheque point under that ink by inverting the (affine) physical mapping numerically.
    const f = (q: Pt) => trayToPrinter(tray, sheet, seenInTray(layout, tray, actual, q));
    const o = f({ x: 0, y: 0 });
    const ex = f({ x: 1, y: 0 });
    const ey = f({ x: 0, y: 1 });
    const a = ex.x - o.x, b = ey.x - o.x, cc = ex.y - o.y, d = ey.y - o.y;
    const det = a * d - b * cc;
    const rx = onPage.x - o.x, ry = onPage.y - o.y;
    return { x: (d * rx - b * ry) / det, y: (a * ry - cc * rx) / det };
  }

  const ERRORS: Pt[] = [{ x: 0, y: 0 }, { x: 3.5, y: -7 }, { x: -12, y: 20 }];

  test('one drag of the text fixes a printer that prints off, for every tray, direction and size', () => {
    const left: string[] = [];
    for (const { tray, turn, w, h, s } of cases) {
      if (s === 'odd') continue;
      const layout = layoutOf(w, h);
      const actual = spot(layout, tray, turn, s);
      for (const error of ERRORS) {
        const p1 = trayToPage(layout, tray, actual);
        const field = probes(layout)[4];
        const landed = landsOnCheque(layout, tray, actual, p1, error, field);
        // The user drags the preview text to where it printed: the same shift for every field.
        const drag = { x: Math.round((landed.x - field.x) * 2) / 2, y: Math.round((landed.y - field.y) * 2) / 2 };
        const other = probes(layout)[6];
        const landedOther = landsOnCheque(layout, tray, actual, p1, error, other);
        expect(landedOther.x - other.x).toBeCloseTo(landed.x - field.x, 5);
        const p2 = correctPlacement(layout, p1, drag.x, drag.y);
        for (const c of probes(layout)) {
          const now = landsOnCheque(layout, tray, actual, p2, error, c);
          if (!near(now, c, 0.36)) left.push(`${tray} ${turn} ${w}x${h} ${s} error ${error.x},${error.y}: still ${(now.x - c.x).toFixed(2)},${(now.y - c.y).toFixed(2)} off`);
        }
      }
    }
    expect(left.slice(0, 5)).toEqual([]);
  });

  test('a cheque shown centred but really pushed against a guide is fixed by one drag', () => {
    for (const tray of TRAY_KINDS_LIST()) {
      for (const turn of TURNS) {
        const layout = layoutOf(205.74, 87.21);
        const shown = defaultTrayView(layout, tray, turn);
        const actual = alignTrayView(layout, tray, shown, 'right');
        const p1 = trayToPage(layout, tray, shown);
        const field = probes(layout)[4];
        const landed = landsOnCheque(layout, tray, actual, p1, { x: 0, y: 0 }, field);
        const p2 = correctPlacement(layout, p1, landed.x - field.x, landed.y - field.y);
        for (const c of probes(layout)) expect(near(landsOnCheque(layout, tray, actual, p2, { x: 0, y: 0 }, c), c, 0.11)).toBe(true);
      }
    }
  });

  test('"Text printed upside down" fixes a cheque loaded the other way round', () => {
    for (const tray of TRAY_KINDS_LIST()) {
      for (const turn of TURNS) {
        for (const [w, h] of SIZES) {
          const layout = layoutOf(w, h);
          const shown = defaultTrayView(layout, tray, turn);
          const actual = { ...shown, turn: (((turn + 180) % 360) as FeedRotation) };
          const p1 = trayToPage(layout, tray, shown);
          const c = probes(layout)[5];
          const wrong = landsOnCheque(layout, tray, actual, p1, { x: 0, y: 0 }, c);
          expect(near(wrong, { x: w - c.x, y: h - c.y }, 0.11)).toBe(true);
          const fixed = flipPlacement(p1);
          for (const q of probes(layout)) expect(near(landsOnCheque(layout, tray, actual, fixed, { x: 0, y: 0 }, q), q, 0.11)).toBe(true);
        }
      }
    }
  });

  // About 1,000 simulated test prints, so this one takes a few seconds.
  test('scanning one test print finds where the cheque sits in every tray, direction, size and position', { timeout: 30_000 }, () => {
    const left: string[] = [];
    for (const { tray, turn, w, h, s } of cases) {
      if (s === 'odd') continue;
      const layout = layoutOf(w, h);
      const shown = spot(layout, tray, turn, s);
      const p1 = trayToPage(layout, tray, shown);
      // Loaded as shown, against the opposite side, the other way round, and with a printer that prints off.
      const opposite = alignTrayView(layout, tray, shown, s === 'left' ? 'right' : 'left');
      const flippedView = { ...shown, turn: (((shown.turn + 180) % 360) as FeedRotation) };
      for (const [actual, error, label] of [[shown, { x: 0, y: 0 }, 'as shown'], [opposite, { x: 0, y: 0 }, 'other side'], [flippedView, { x: 0, y: 0 }, 'other way round'], [shown, { x: 3.5, y: -4 }, 'printer off']] as Array<[TrayView, Pt, string]>) {
        // Where a point of the printed page lands on the cheque: invert the (affine) physical mapping.
        const sheet = sheetFor(layout, actual.turn);
        const f = (q: Pt) => trayToPrinter(tray, sheet, seenInTray(layout, tray, actual, q));
        const o = f({ x: 0, y: 0 }), ex = f({ x: 1, y: 0 }), ey = f({ x: 0, y: 1 });
        const [a, b, c2, d2] = [ex.x - o.x, ey.x - o.x, ex.y - o.y, ey.y - o.y];
        const toCheque = (p: Pt) => {
          const [rx, ry] = [p.x - o.x, p.y - o.y];
          const det = a * d2 - b * c2;
          return { x: (d2 * rx - b * ry) / det, y: (a * ry - c2 * rx) / det };
        };
        // What the scan shows: the dots that landed fully on the cheque.
        const seen = calibrationPattern(layout, p1)
          .map(d => ({ ...toCheque({ x: d.x + error.x, y: d.y + error.y }), large: d.size === DOT_MM.large, size: d.size }))
          .filter(p => p.x > p.size && p.y > p.size && p.x < w - p.size && p.y < h - p.size);
        const name = `${tray} ${turn} ${w}x${h} ${s} ${label}`;
        const loc = locateCheque(seen, layout, p1);
        const fix = loc && calibrationResult(p1, loc);
        if (!fix?.ok || !fix.placement) { left.push(`${name}: not found (${seen.length} dots on the cheque)`); continue; }
        for (const c of probes(layout)) {
          const now = landsOnCheque(layout, tray, actual, fix.placement, error, c);
          if (!near(now, c, 0.15)) { left.push(`${name}: still ${(now.x - c.x).toFixed(2)},${(now.y - c.y).toFixed(2)} off`); break; }
        }
      }
    }
    expect(left.slice(0, 6)).toEqual([]);
  });

  test('a dragged, scanned or graph-read correction becomes the position adjustment and prints the same', () => {
    const left: string[] = [];
    for (const { tray, turn, w, h, s } of cases) {
      if (s !== 'centre') continue;
      const layout = layoutOf(w, h);
      const actual = spot(layout, tray, turn, s);
      const p0 = trayToPage(layout, tray, actual);
      for (const error of ERRORS) {
        // The exact page correction for this printer, as the scan or graph would find it.
        const field = probes(layout)[4];
        const landed = landsOnCheque(layout, tray, actual, p0, error, field);
        const fixed = correctPlacement(layout, p0, landed.x - field.x, landed.y - field.y);
        // Kept as an adjustment of the text instead: same page placement, every point moved right and up by it.
        const shift = placementToShift(layout, p0, fixed);
        for (const c of probes(layout)) {
          const now = landsOnCheque(layout, tray, actual, p0, error, { x: c.x + shift.x, y: c.y - shift.y });
          if (!near(now, c, 0.2)) { left.push(`${tray} ${turn} ${w}x${h} error ${error.x},${error.y}: ${(now.x - c.x).toFixed(2)},${(now.y - c.y).toFixed(2)} off`); break; }
        }
      }
    }
    expect(left.slice(0, 6)).toEqual([]);
  });

  test('reading the printed graph at the paper corner fixes every tray, direction, size and position', () => {
    const left: string[] = [];
    for (const { tray, turn, w, h, s } of cases) {
      const layout = layoutOf(w, h);
      const actual = spot(layout, tray, turn, s);
      const p1 = trayToPage(layout, tray, actual);
      for (const error of [{ x: 0, y: 0 }, { x: 3.5, y: -7 }, { x: -12, y: 9 }]) {
        // Which printed cheque point landed on the paper's bottom-left corner (cheque (0, h) from the top-left)?
        const f = (c: Pt) => landsOnCheque(layout, tray, actual, p1, error, c);
        const o = f({ x: 0, y: 0 }), ex = f({ x: 1, y: 0 }), ey = f({ x: 0, y: 1 });
        const [a, b, c2, d2] = [ex.x - o.x, ey.x - o.x, ex.y - o.y, ey.y - o.y];
        const det = a * d2 - b * c2;
        const [rx, ry] = [0 - o.x, h - o.y];
        const printed = { x: (d2 * rx - b * ry) / det, y: (a * ry - c2 * rx) / det };
        // The person reads the graph numbers there, to the nearest 0.5 mm like on a ruler.
        const reading = { x: Math.round(printed.x * 2) / 2, y: Math.round((h - printed.y) * 2) / 2 };
        const fixed = correctionFromCorner(layout, p1, reading);
        for (const c of probes(layout)) {
          const now = landsOnCheque(layout, tray, actual, fixed, error, c);
          if (!near(now, c, 0.36)) { left.push(`${tray} ${turn} ${w}x${h} ${s} error ${error.x},${error.y}: still ${(now.x - c.x).toFixed(2)},${(now.y - c.y).toFixed(2)} off`); break; }
        }
      }
    }
    expect(left.slice(0, 6)).toEqual([]);
  });
});

describe('page size for every cheque size', () => {
  test('uses A4 whenever the cheque fits, so every printer driver accepts the page', () => {
    for (const [w, h] of SIZES.filter(([w]) => w <= 210)) {
      for (const turn of TURNS) expect(sheetFor(layoutOf(w, h), turn)).toMatchObject({ name: 'A4', width: 210, height: 297 });
    }
  });

  test('a cheque wider than A4 fed long edge first uses Letter, then a page of its own size', () => {
    expect(sheetFor(layoutOf(215.9, 88.9), 0)).toMatchObject({ name: 'Letter', width: 215.9 });
    expect(sheetFor(layoutOf(215.9, 88.9), 90)).toMatchObject({ name: 'A4' });
    const big = sheetFor(layoutOf(230, 95), 180);
    expect(big.name).toBe('Custom');
    expect(big.width).toBeGreaterThanOrEqual(230);
  });

  test('the print page uses that sheet', () => {
    const layout = layoutOf(215.9, 88.9);
    const g = pageGeometry(layout, DEFAULT_SETTINGS, { rotation: 0, x: 0, y: 0 });
    expect([g.pageWidth, g.pageHeight]).toEqual([215.9, 279.4]);
    expect(buildPrintHtml([], g, { fontFamily: 'Arial' })).toContain('size: 215.9mm 279.4mm');
  });

  test('no text is cut off in any tray, direction, size and position', () => {
    const measure = (t: string, pt: number) => t.length * 2.1 * (pt / 12);
    const cut: string[] = [];
    for (const { tray, turn, w, h, s } of cases) {
      const layout = layoutOf(w, h);
      const p = trayToPage(layout, tray, spot(layout, tray, turn, s));
      const g = pageGeometry(layout, DEFAULT_SETTINGS, { rotation: p.rotation, x: p.x, y: p.y });
      const { items } = renderCheque(layout, { date: '2026-12-31', payee: 'Sample Payee', amountFils: 123_450, crossing: 'ac-payee-bearer' }, DEFAULT_SETTINGS, measure);
      const problems = printProblems(items, g);
      if (problems.length) cut.push(`${tray} ${turn} ${w}x${h} ${s}: ${problems.join('; ')}`);
    }
    expect(cut.slice(0, 5)).toEqual([]);
  });

  test('warns when text would print off the page or in the edge the printer cannot reach', () => {
    const layout = layoutOf(205.74, 87.21);
    const measure = (t: string, pt: number) => t.length * 2.1 * (pt / 12);
    const { items } = renderCheque(layout, { date: '2026-12-31', payee: 'Sample Payee', amountFils: 123_450, crossing: 'none' }, DEFAULT_SETTINGS, measure);
    const off = pageGeometry(layout, DEFAULT_SETTINGS, { rotation: 270, x: -60, y: 0 });
    expect(printProblems(items, off).join(' ')).toMatch(/off the page/i);
    const edge = pageGeometry(layout, DEFAULT_SETTINGS, { rotation: 0, x: 2, y: -12 });
    expect(printProblems(items as TextItem[], edge).join(' ')).toMatch(/edge/i);
  });
  test('checks where the text really is, not the empty end of its line', () => {
    const layout = layoutOf(157.65, 79.93);
    const measure = (t: string, pt: number) => t.length * 2.1 * (pt / 12);
    // a date line reaching the cheque edge, with the date written at its left end
    const dated = { ...layout, date: { mode: 'line' as const, box: { x: 120, y: 15.6, width: 37.65, height: 6, fontPt: 12 } } };
    const { items } = renderCheque(dated, { date: '2026-12-31', payee: 'P', amountFils: 100, crossing: 'none' }, DEFAULT_SETTINGS, measure);
    const g = pageGeometry(dated, DEFAULT_SETTINGS, { rotation: 270, x: 60, y: 0 });
    expect(printProblems(items, g)).not.toEqual([]);
    expect(printProblems(items, g, measure)).toEqual([]);
  });
  test('warns when fine-tuning pushes text past the edge of the cheque, or text overflows its box', () => {
    const layout = layoutOf(203.2, 89);
    const measure = (t: string, pt: number) => t.length * 2.1 * (pt / 12);
    const right = { ...layout, amount: { ...layout.amount, x: 160, width: 50, align: 'right' as const } };
    const g = pageGeometry(right, DEFAULT_SETTINGS, { rotation: 0, x: 3, y: 0 });
    const pushed = renderCheque(right, { date: '2026-12-31', payee: 'P', amountFils: 100, crossing: 'none' }, { ...DEFAULT_SETTINGS, offsetX: 3 }, measure);
    expect(printProblems(pushed.items, g, measure).join(' ')).toMatch(/edge of the cheque/i);
    const long = renderCheque(layout, { date: '2026-12-31', payee: 'X'.repeat(200), amountFils: 100, crossing: 'none' }, DEFAULT_SETTINGS, measure);
    expect(printProblems(long.items, g, measure).join(' ')).toMatch(/Payee/);
  });
});
