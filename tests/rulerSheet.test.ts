import { describe, expect, test } from 'vitest';
import { createRaster, type Raster } from '../src/shared/detect/imaging';
import { buildRulerSheetHtml, homography, rectifyRulerSheet, RULER_SHEET } from '../src/shared/detect/rulerSheet';

const SHEET_PX_PER_MM = 4;

/** The printed ruler sheet at 4 px/mm with a dark 158 x 80 mm cheque lying on it (turned 90°, as it fits the box). */
function sheetWithCheque(): Raster {
  const k = SHEET_PX_PER_MM;
  const img = createRaster(210 * k, 297 * k, 4, 255);
  const fill = (x: number, y: number, w: number, h: number, v: number) => {
    for (let yy = Math.round(y * k); yy < Math.round((y + h) * k); yy++)
      for (let xx = Math.round(x * k); xx < Math.round((x + w) * k); xx++) {
        const i = (yy * img.width + xx) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
  };
  for (const m of RULER_SHEET.markers) fill(m.x - m.size / 2, m.y - m.size / 2, m.size, m.size, 0);
  fill(60, 70, 80, 158, 190); // the cheque: pale grey paper, 80 wide x 158 tall
  fill(70, 80, 20, 12, 40);   // its logo
  return img;
}

/** A phone photo of the sheet: perspective from a tilted camera, turned 90°, on a darker table. */
function photo(sheet: Raster): Raster {
  const out = createRaster(1600, 1200, 4, 90);
  // photo corners of the sheet (sheet turned 90°: its top edge runs down the right side of the photo)
  const corners: Array<[number, number]> = [[1450, 120], [1490, 1100], [120, 70], [170, 1130]]; // TL TR BL BR of the sheet
  const H = homography(
    [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 0, y: 297 }, { x: 210, y: 297 }],
    corners.map(([x, y]) => ({ x, y })),
  );
  const inv = homography(corners.map(([x, y]) => ({ x, y })), [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 0, y: 297 }, { x: 210, y: 297 }]);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = inv(x + 0.5, y + 0.5);
      if (p.x < 0 || p.y < 0 || p.x >= 210 || p.y >= 297) continue;
      const si = (Math.floor(p.y * SHEET_PX_PER_MM) * sheet.width + Math.floor(p.x * SHEET_PX_PER_MM)) * 4;
      const oi = (y * out.width + x) * 4;
      out.data[oi] = sheet.data[si];
      out.data[oi + 1] = sheet.data[si + 1];
      out.data[oi + 2] = sheet.data[si + 2];
    }
  }
  expect(H(0, 0).x).toBeCloseTo(1450, 3);
  return out;
}

/** Extent (mm) of the pale grey cheque in a straightened image: the rows and columns that are mostly cheque. */
function chequeExtent(img: Raster, pxPerMm: number) {
  const grey = (x: number, y: number) => { const v = img.data[(y * img.width + x) * 4]; return v > 175 && v < 205; };
  const cols: number[] = [];
  const rows: number[] = [];
  for (let x = 0; x < img.width; x++) { let n = 0; for (let y = 0; y < img.height; y++) n += grey(x, y) ? 1 : 0; if (n > img.height * 0.3) cols.push(x); }
  for (let y = 0; y < img.height; y++) { let n = 0; for (let x = 0; x < img.width; x++) n += grey(x, y) ? 1 : 0; if (n > img.width * 0.2) rows.push(y); }
  return { width: (cols[cols.length - 1] - cols[0] + 1) / pxPerMm, height: (rows[rows.length - 1] - rows[0] + 1) / pxPerMm };
}

describe('ruler sheet', () => {
  test('the printed sheet has the four corner squares and the orientation square at their mm positions', () => {
    const html = buildRulerSheetHtml();
    expect(html).toContain('size: 210mm 297mm');
    for (const m of RULER_SHEET.markers) expect(html).toContain(`x="${m.x - m.size / 2}" y="${m.y - m.size / 2}" width="${m.size}"`);
    expect(html).toContain(`x="${RULER_SHEET.orientation.x - RULER_SHEET.orientation.size / 2}"`);
    expect(html).toMatch(/100 mm/);
  });

  test('a tilted, turned phone photo of the sheet is straightened to its true size', () => {
    const result = rectifyRulerSheet(photo(sheetWithCheque()));
    expect(result).not.toBeNull();
    const { width, height } = chequeExtent(result!.image, result!.pxPerMm);
    expect(width).toBeCloseTo(80, 0);
    expect(height).toBeCloseTo(158, 0);
  });

  test('a photo without the sheet is left alone', () => {
    expect(rectifyRulerSheet(createRaster(800, 600, 4, 200))).toBeNull();
  });
});
