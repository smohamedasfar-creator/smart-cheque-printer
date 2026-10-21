import { describe, expect, test } from 'vitest';
import { calibrationPattern, DOT_MM, findDiscs, locateCheque, patternColumns, PITCH_MM } from '../src/shared/detect/calibrate';
import { createRaster, type Raster } from '../src/shared/detect/imaging';
import { blankLayout } from '../src/shared/layoutDefaults';
import { chequePointOnPage, type Placement } from '../src/shared/print';

const PX_PER_MM = 150 / 25.4;
type Dot = { x: number; y: number; size: number };

describe('patternColumns', () => {
  test('spaces dots evenly across the page, and every 4 neighbouring dots have a different small/large pattern', () => {
    for (const [width, pitch] of [[210, PITCH_MM.lead], [210, PITCH_MM.trail], [215.9, PITCH_MM.lead], [215.9, PITCH_MM.trail]]) {
      const cols = patternColumns(width, pitch);
      expect(cols[0].x).toBeGreaterThanOrEqual(5);
      expect(cols[cols.length - 1].x).toBeLessThanOrEqual(width - 5);
      for (let i = 1; i < cols.length; i++) expect(cols[i].x - cols[i - 1].x).toBeCloseTo(pitch, 5);
      const windows = new Set<string>();
      for (let i = 0; i + 4 <= cols.length; i++) windows.add(cols.slice(i, i + 4).map(c => (c.large ? 'L' : 's')).join(''));
      expect(windows.size).toBe(cols.length - 3);
    }
  });
});

/** A scanned cheque at 150 dpi with printed lines, text-like strokes and the given dots (cheque mm). */
function scan(w: number, h: number, dots: Dot[]): Raster {
  const img = createRaster(Math.round(w * PX_PER_MM), Math.round(h * PX_PER_MM), 1, 235);
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.data[y * img.width + x] = v;
  };
  const px = (mm: number) => Math.round(mm * PX_PER_MM);
  for (const y of [15, 32, 48, 60]) for (let x = px(4); x < px(w - 4); x++) for (let t = 0; t < 2; t++) set(x, px(y) + t, 60);
  for (let k = 0; k < 30; k++) {
    const x0 = px(30 + k * 4), y0 = px(22);
    for (let y = 0; y < px(2.5); y++) { set(x0, y0 + y, 40); set(x0 + 1, y0 + y, 40); }
  }
  for (const d of dots) {
    const r = (d.size / 2) * PX_PER_MM, cx = d.x * PX_PER_MM, cy = d.y * PX_PER_MM;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) set(x, y, 20);
  }
  return img;
}

describe('findDiscs', () => {
  test('finds small and large dots, ignoring printed lines and text, even where a line crosses a dot', () => {
    const dots: Dot[] = [{ x: 20, y: 15, size: DOT_MM.small }, { x: 60, y: 40, size: DOT_MM.small }, { x: 120, y: 60, size: DOT_MM.large }, { x: 170, y: 75, size: DOT_MM.large }];
    const found = findDiscs(scan(205.74, 87.21, dots), 1 / PX_PER_MM);
    expect(found.length).toBe(4);
    for (const d of dots) {
      const f = found.find(p => Math.hypot(p.x - d.x, p.y - d.y) < 0.3);
      expect(f).toBeTruthy();
      expect(f!.large).toBe(d.size === DOT_MM.large);
    }
  });

  test('finds nothing on a scan without dots', () => {
    expect(findDiscs(scan(205.74, 87.21, []), 1 / PX_PER_MM)).toEqual([]);
  });
});

describe('locateCheque', () => {
  const layout = blankLayout(205.74, 87.21);
  const expected: Placement = { rotation: 270, x: 61.4, y: 0 };

  /** What a scan of the test print shows when the cheque really sits at `actual` and the printer scales by `scale`. */
  function landed(actual: Placement, scale = 1): Dot[] {
    const out: Dot[] = [];
    for (const d of calibrationPattern(layout, expected)) {
      // The printer puts page point P at scale × P on the paper; the cheque sits at `actual`.
      const c = invert(actual, { x: d.x * scale, y: d.y * scale });
      if (c.x > d.size && c.y > d.size && c.x < layout.chequeWidth - d.size && c.y < layout.chequeHeight - d.size) out.push({ ...c, size: d.size });
    }
    return out;
  }
  function invert(p: Placement, page: { x: number; y: number }) {
    const o = chequePointOnPage(layout, p.rotation, 0, 0);
    const ex = chequePointOnPage(layout, p.rotation, 1, 0);
    const ey = chequePointOnPage(layout, p.rotation, 0, 1);
    const [a, b, c, d] = [ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y];
    const [rx, ry] = [page.x - p.x - o.x, page.y - p.y - o.y];
    const det = a * d - b * c;
    return { x: (d * rx - c * ry) / det, y: (a * ry - b * rx) / det };
  }
  const asFound = (dots: Dot[]) => dots.map(d => ({ x: d.x, y: d.y, large: d.size === DOT_MM.large }));

  test('finds where the cheque really sits: exactly where expected', () => {
    const r = locateCheque(asFound(landed(expected)), layout, expected);
    expect(r).not.toBeNull();
    expect(r!.flipped).toBe(false);
    expect(r!.placement.x).toBeCloseTo(61.4, 1);
    expect(r!.placement.y).toBeCloseTo(0, 1);
  });

  test('finds a cheque pushed against the side of the tray, 60 mm from where the app expected', () => {
    const actual = { rotation: 270 as const, x: 0, y: 1.5 };
    const r = locateCheque(asFound(landed(actual)), layout, expected);
    expect(r!.placement.x).toBeCloseTo(0, 1);
    expect(r!.placement.y).toBeCloseTo(1.5, 1);
  });

  test('notices a cheque that went in the other way round', () => {
    const actual = { rotation: 90 as const, x: 70, y: -2 };
    const r = locateCheque(asFound(landed(actual)), layout, expected);
    expect(r!.flipped).toBe(true);
    expect(r!.placement.rotation).toBe(90);
    expect(r!.placement.x).toBeCloseTo(70, 1);
    expect(r!.placement.y).toBeCloseTo(-2, 1);
  });

  test('reports a printer that shrinks the page', () => {
    const r = locateCheque(asFound(landed(expected, 0.786)), layout, expected);
    expect(r).not.toBeNull();
    expect(r!.scale).toBeCloseTo(0.786, 2);
  });

  test('gives up when the dots are not there', () => {
    expect(locateCheque([{ x: 50, y: 40, large: false }, { x: 90, y: 30, large: true }], layout, expected)).toBeNull();
  });

  test('reads a real scan raster end to end', () => {
    const dots = landed({ rotation: 270, x: 40, y: 0.5 });
    const found = findDiscs(scan(layout.chequeWidth, layout.chequeHeight, dots), 1 / PX_PER_MM);
    const r = locateCheque(found, layout, expected);
    expect(r!.placement.x).toBeCloseTo(40, 0);
    expect(Math.abs(r!.placement.x - 40)).toBeLessThan(0.3);
    expect(Math.abs(r!.placement.y - 0.5)).toBeLessThan(0.3);
  });
});
