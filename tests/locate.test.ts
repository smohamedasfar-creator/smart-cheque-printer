import { describe, expect, test } from 'vitest';
import { createRaster, type Raster } from '../src/shared/detect/imaging';
import { locateByReference, uprightFromAffine } from '../src/shared/detect/locate';

const W = 158;
const H = 80;
const REF_PX_PER_MM = 4;

/** A pale cheque with asymmetric artwork (logo block, lines, a box), drawn at `pxPerMm`. */
function chequeArt(pxPerMm: number): Raster {
  const img = createRaster(Math.round(W * pxPerMm), Math.round(H * pxPerMm), 1, 246);
  const fill = (x: number, y: number, w: number, h: number, v: number) => {
    for (let yy = Math.round(y * pxPerMm); yy < Math.round((y + h) * pxPerMm); yy++)
      for (let xx = Math.round(x * pxPerMm); xx < Math.round((x + w) * pxPerMm); xx++) img.data[yy * img.width + xx] = v;
  };
  fill(5, 5, 28, 11, 60);          // logo block
  fill(38, 7, 30, 2, 90);          // bank name
  fill(120, 20, 30, 0.4, 70);      // date line
  fill(6, 32, 140, 0.4, 70);       // payee line
  fill(22, 44, 90, 0.4, 70);       // words lines
  fill(6, 56, 110, 0.4, 70);
  for (const [x, y, w, h] of [[118, 40, 34, 0.5], [118, 49, 34, 0.5], [118, 40, 0.5, 9], [151.5, 40, 0.5, 9]]) fill(x, y, w, h, 70); // amount box
  fill(30, 70, 70, 3, 120);        // MICR band
  return img;
}

/** A scanner page at `pxPerMm`: white lid, the cheque turned by `quarter` and `skewDeg`, placed at (ox, oy) mm. */
function scanOf(quarter: number, skewDeg: number, ox: number, oy: number, pxPerMm: number) {
  const pageW = 216, pageH = 280;
  const out = createRaster(Math.round(pageW * pxPerMm), Math.round(pageH * pxPerMm), 1, 250);
  const art = chequeArt(pxPerMm);
  const t = (skewDeg * Math.PI) / 180;
  // cheque mm -> page mm: quarter turns clockwise about the cheque's origin, then skew, then shift
  const turnPt = (x: number, y: number) => {
    switch (quarter) {
      case 1: return { x: H - y, y: x };
      case 2: return { x: W - x, y: H - y };
      case 3: return { x: y, y: W - x };
      default: return { x, y };
    }
  };
  const map = (x: number, y: number) => {
    const p = turnPt(x, y);
    return { x: ox + p.x * Math.cos(t) - p.y * Math.sin(t), y: oy + p.x * Math.sin(t) + p.y * Math.cos(t) };
  };
  for (let cy = 0; cy < art.height; cy++) {
    for (let cx = 0; cx < art.width; cx++) {
      const p = map((cx + 0.5) / pxPerMm, (cy + 0.5) / pxPerMm);
      const [px, py] = [Math.floor(p.x * pxPerMm), Math.floor(p.y * pxPerMm)];
      if (px >= 0 && py >= 0 && px < out.width && py < out.height) out.data[py * out.width + px] = art.data[cy * art.width + cx];
    }
  }
  return { scan: out, map };
}

// Each search scans a whole A4 page, so these take a second or two.
describe('locateByReference', { timeout: 30_000 }, () => {
  test.each([
    [0, 0, 20, 30],
    [2, 0.8, 35, 120],
    [1, -1.2, 60, 25],
    [3, 0.5, 40, 50],
  ])('finds a cheque turned %i quarter(s), skewed %f°, at (%i, %i) mm on a white scanner lid', (quarter, skew, ox, oy) => {
    const pxPerMm = 300 / 25.4;
    const { scan, map } = scanOf(quarter, skew, ox, oy, pxPerMm);
    const found = locateByReference(scan, pxPerMm, chequeArt(REF_PX_PER_MM), REF_PX_PER_MM);
    expect(found).not.toBeNull();
    // Every corner and the middle of the cheque must map to within 0.4 mm of where it really is.
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]]) {
      const want = map(x, y);
      const got = { x: (found!.a * x + found!.c * y + found!.e) / pxPerMm, y: (found!.b * x + found!.d * y + found!.f) / pxPerMm };
      expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(0.4);
    }
  });

  test('rebuilds the upright cheque from the scan', () => {
    const pxPerMm = 300 / 25.4;
    const { scan } = scanOf(2, 0.6, 30, 70, pxPerMm);
    const found = locateByReference(scan, pxPerMm, chequeArt(REF_PX_PER_MM), REF_PX_PER_MM)!;
    const upright = uprightFromAffine(scan, found, W, H, 6);
    expect(upright.width).toBe(W * 6);
    expect(upright.height).toBe(H * 6);
    // the logo block is back at the top-left
    expect(upright.data[Math.round(10 * 6) * upright.width + Math.round(15 * 6)]).toBeLessThan(100);
    expect(upright.data[Math.round(70 * 6) * upright.width + Math.round(150 * 6)]).toBeGreaterThan(200);
  });

  test('says so when the cheque is not in the scan', () => {
    const blank = createRaster(800, 1000, 1, 250);
    expect(locateByReference(blank, 300 / 25.4, chequeArt(REF_PX_PER_MM), REF_PX_PER_MM)).toBeNull();
  });
});
