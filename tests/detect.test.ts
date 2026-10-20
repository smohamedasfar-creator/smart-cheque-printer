import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { detectCheque, estimateSkew, findChequeRegion } from '../src/shared/detect/detectCheque';
import { readImageDpi } from '../src/shared/detect/dpi';
import { createRaster, crop, downscale, isBlank, rotateQuarter, rotateSmall, type Raster } from '../src/shared/detect/imaging';
import { findSegments, joinCollinear } from '../src/shared/detect/segments';

// Synthetic 150 dpi cheque modelled on a UAE layout. 1 mm = 150 / 25.4 px.
const DPI = 150;
const PX = DPI / 25.4;
const p = (mm: number) => Math.round(mm * PX);

function fill(img: Raster, x: number, y: number, w: number, h: number, v: number) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) img.data[yy * img.width + xx] = v;
}

/** Text-like block: dark vertical strokes with gaps, so it is not mistaken for a line. */
function label(img: Raster, x: number, baseline: number, widthMm: number) {
  for (let i = 0; i < p(widthMm); i += 3) fill(img, x + i, baseline - p(3), 1, p(3), 30);
}

const CHEQUE = { w: 158, h: 80 };

function drawCheque(opts: { digitDate?: boolean } = {}): Raster {
  const img = createRaster(p(CHEQUE.w), p(CHEQUE.h), 1, 228);
  // light security pattern
  for (let y = 0; y < img.height; y += 7) for (let x = (y / 7) % 2 ? 0 : 4; x < img.width; x += 9) fill(img, x, y, 2, 2, 195);
  const line = (x1: number, x2: number, y: number) => fill(img, p(x1), p(y), p(x2) - p(x1), 1, 40);

  if (opts.digitDate) {
    // 8 cells: DD MM YYYY, ticks 5 mm tall
    const xs = [112, 116, 121, 125, 130, 134, 138, 142, 146];
    const cells = [[0, 1, 2], [3, 4, 5], [5, 6, 7, 8]];
    for (const group of cells) for (const i of group) fill(img, p(xs[i]), p(14), 1, p(5), 30);
    line(112, 120, 19);
    line(121, 129, 19);
    line(130, 146, 19);
  } else {
    label(img, p(108), p(20), 7); // "Date"
    line(108, 150, 20.5);
    label(img, p(146), p(20), 4); // Arabic label at the end
  }
  label(img, p(4), p(29), 30); // "Pay against this cheque to"
  line(4, 154, 29.5);
  label(img, p(140), p(29), 13); // Arabic
  label(img, p(4), p(36), 14); // "or the Bearer" on its own row
  label(img, p(4), p(40), 10); // "Dirhams"
  line(4, 154, 40.5);
  line(4, 154, 48);
  // amount box with four sides
  fill(img, p(118), p(40.5), p(33), 1, 40);
  fill(img, p(118), p(48), p(33), 1, 40);
  fill(img, p(118), p(40.5), 1, p(7.5), 40);
  fill(img, p(151), p(40.5), 1, p(7.5), 40);
  // thick bar above the MICR band, and MICR blocks
  fill(img, 0, p(68), img.width, p(1.2), 20);
  for (let x = 30; x < 120; x += 4) fill(img, p(x), p(73), p(2), p(3), 10);
  return img;
}

function onPage(cheque: Raster, x: number, y: number): Raster {
  const page = createRaster(p(210), p(297), 1, 255);
  for (let r = 0; r < cheque.height; r++) page.data.set(cheque.data.subarray(r * cheque.width, (r + 1) * cheque.width), (y + r) * page.width + x);
  return page;
}

describe('imaging', () => {
  test('rotateQuarter turns clockwise and back', () => {
    const img = createRaster(3, 2, 1, 0);
    img.data.set([1, 2, 3, 4, 5, 6]);
    const r = rotateQuarter(img, 1);
    expect([r.width, r.height]).toEqual([2, 3]);
    expect([...r.data]).toEqual([4, 1, 5, 2, 6, 3]);
    expect([...rotateQuarter(r, 3).data]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...rotateQuarter(img, 2).data]).toEqual([6, 5, 4, 3, 2, 1]);
  });

  test('downscale min keeps thin dark lines', () => {
    const img = createRaster(4, 4, 1, 255);
    img.data[5] = 0;
    expect([...downscale(img, 2, 'min').data]).toEqual([0, 255, 255, 255]);
    expect(downscale(img, 2, 'avg').data[0]).toBe(191);
  });

  test('isBlank spots a scan that failed to draw', () => {
    expect(isBlank(createRaster(100, 100, 4, 0))).toBe(true);
    expect(isBlank(createRaster(100, 100, 1, 255))).toBe(true);
    expect(isBlank(drawCheque())).toBe(false);
  });

  test('crop copies the requested rectangle', () => {
    const img = createRaster(3, 3, 1, 0);
    img.data.set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...crop(img, { x: 1, y: 1, width: 2, height: 2 }).data]).toEqual([5, 6, 8, 9]);
  });
});

describe('segments', () => {
  test('finds solid lines and ignores text-like strokes', () => {
    const img = createRaster(200, 40, 1, 230);
    fill(img, 10, 10, 150, 1, 40);
    for (let x = 10; x < 160; x += 3) fill(img, x, 25, 1, 6, 30);
    const segs = findSegments(img, 'h', 150, 50, 2);
    expect(segs).toEqual([{ x1: 10, x2: 159, y1: 10, y2: 10 }]);
  });
});

describe('joinCollinear', () => {
  test('joins broken pieces of one line but not separate lines', () => {
    const pieces = [
      { x1: 0, x2: 100, y1: 10, y2: 10 },
      { x1: 103, x2: 300, y1: 11, y2: 11 },
      { x1: 0, x2: 300, y1: 40, y2: 40 },
    ];
    expect(joinCollinear(pieces, 5, 2)).toEqual([
      { x1: 0, x2: 300, y1: 11, y2: 11 },
      { x1: 0, x2: 300, y1: 40, y2: 40 },
    ]);
  });
});

describe('findChequeRegion', () => {
  test('finds a cheque on a white scanner page', () => {
    const { rect, cropped } = findChequeRegion(onPage(drawCheque(), p(20), p(150)));
    expect(cropped).toBe(false);
    expect(Math.abs(rect.x - p(20))).toBeLessThanOrEqual(2);
    expect(Math.abs(rect.width - p(CHEQUE.w))).toBeLessThanOrEqual(3);
    expect(Math.abs(rect.height - p(CHEQUE.h))).toBeLessThanOrEqual(3);
  });

  test('treats an already cropped cheque as the whole image', () => {
    expect(findChequeRegion(drawCheque()).cropped).toBe(true);
  });
});

describe('estimateSkew', () => {
  test('measures a small tilt', () => {
    const tilted = rotateSmall(drawCheque(), 1.5);
    expect(estimateSkew(tilted, 150)).toBeCloseTo(1.5, 0);
  });
});

describe('detectCheque', () => {
  const expectFabLike = (r: ReturnType<typeof detectCheque>) => {
    const L = r.layout;
    expect(L.chequeWidth).toBeCloseTo(CHEQUE.w, -0.3);
    expect(L.chequeHeight).toBeCloseTo(CHEQUE.h, -0.3);
    expect(r.guessed).toEqual([]);
    // payee starts after the "Pay against this cheque to" label and sits just above its line
    expect(L.payee.x).toBeGreaterThan(34);
    expect(L.payee.y + L.payee.height).toBeCloseTo(29.1, 0);
    expect(L.payee.x + L.payee.width).toBeLessThan(140);
    // words: first after "Dirhams", second stops before the amount box
    expect(L.words1.x).toBeGreaterThan(14);
    // line 1 ends before the amount box column so long amounts wrap to line 2
    expect(L.words1.x + L.words1.width).toBeLessThan(118);
    expect(L.words2.x + L.words2.width).toBeLessThan(118);
    // amount inside the box
    expect(L.amount.x).toBeGreaterThan(118);
    expect(L.amount.x + L.amount.width).toBeLessThan(151);
    // "or the Bearer" label gets the strike
    expect(L.bearerStrike.x).toBeLessThan(6);
    expect(L.bearerStrike.y).toBeGreaterThan(30);
    expect(L.bearerStrike.y).toBeLessThan(36);
  };

  test('detects an upright cheque on an A4 scan', () => {
    const r = detectCheque({ image: onPage(drawCheque(), p(20), p(150)), dpi: DPI });
    expect(r.croppedUpload).toBe(false);
    expect(r.transform.flip).toBe(false);
    expect(r.layout.date.mode).toBe('line');
    expectFabLike(r);
  });

  test('turns an upside-down scan the right way up', () => {
    const r = detectCheque({ image: rotateQuarter(onPage(drawCheque(), p(20), p(150)), 2), dpi: DPI });
    expect(r.transform.flip).toBe(true);
    expectFabLike(r);
  });

  test('can be told which way up the cheque is', () => {
    const page = onPage(drawCheque(), p(20), p(150));
    expect(detectCheque({ image: page, dpi: DPI, flip: true }).transform.flip).toBe(true);
    expect(detectCheque({ image: rotateQuarter(page, 2), dpi: DPI, flip: false }).transform.flip).toBe(false);
  });

  test('handles a cropped upload', () => {
    const r = detectCheque({ image: drawCheque(), dpi: DPI });
    expect(r.croppedUpload).toBe(true);
    expectFabLike(r);
  });

  test('handles a cropped upload scanned in portrait', () => {
    const r = detectCheque({ image: rotateQuarter(drawCheque(), 3), dpi: DPI });
    expect(r.transform.quarterTurns).toBe(1);
    expectFabLike(r);
  });

  test('straightens a slightly tilted scan', () => {
    const r = detectCheque({ image: rotateSmall(onPage(drawCheque(), p(20), p(150)), 1), dpi: DPI });
    if (process.env.DEBUG_TILT) fs.writeFileSync(process.env.DEBUG_TILT, JSON.stringify({ t: r.transform, found: r.found, L: r.layout }, null, 1));
    expect(Math.abs(r.transform.skewDeg + 1)).toBeLessThanOrEqual(0.3);
    expect(r.found).toEqual(expect.arrayContaining(['payee', 'words1', 'words2', 'amount', 'date']));
  });

  test('reads eight date boxes', () => {
    const r = detectCheque({ image: drawCheque({ digitDate: true }), dpi: DPI });
    expect(r.layout.date.mode).toBe('digits');
    if (r.layout.date.mode === 'digits') {
      expect(r.layout.date.boxes).toHaveLength(8);
      expect(r.layout.date.boxes[0].x).toBeCloseTo(112, 0);
    }
  });

  test('works at higher scan resolutions', () => {
    const big = createRaster(p(CHEQUE.w) * 2, p(CHEQUE.h) * 2, 1);
    const small = drawCheque();
    for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++) big.data[y * big.width + x] = small.data[(y >> 1) * small.width + (x >> 1)];
    const r = detectCheque({ image: big, dpi: DPI * 2 });
    expect(r.layout.chequeWidth).toBeCloseTo(CHEQUE.w, -0.3);
    expect(r.found).toContain('amount');
  });

  test('detects a large photo without a recorded resolution', () => {
    const big = createRaster(p(CHEQUE.w) * 2, p(CHEQUE.h) * 2, 1);
    const small = drawCheque();
    for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++) big.data[y * big.width + x] = small.data[(y >> 1) * small.width + (x >> 1)];
    const r = detectCheque({ image: big, dpi: null });
    expect(r.transform.factor).toBe(2);
    expect(r.guessed).toEqual([]);
    expect(r.layout.payee2).toBeNull();
  });

  test('asks for the width when the resolution is unknown', () => {
    const r = detectCheque({ image: drawCheque(), dpi: null });
    expect(r.sizeKnown).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/width/);
    expect(r.layout.chequeWidth).toBeCloseTo(200, 0);
  });

  test('guesses fields on a blank image and says so', () => {
    const r = detectCheque({ image: createRaster(600, 300, 1, 240), dpi: DPI });
    expect(r.guessed).toEqual(expect.arrayContaining(['payee', 'amount', 'date']));
    expect(r.warnings.join(' ')).toMatch(/Drag/);
  });
});

describe('readImageDpi', () => {
  test('reads JFIF density in dots per inch and per cm', () => {
    const jfif = (units: number, density: number) =>
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, units, density >> 8, density & 255, density >> 8, density & 255, 0, 0, 0xff, 0xda]);
    expect(readImageDpi(jfif(1, 300))).toBe(300);
    expect(readImageDpi(jfif(2, 118))).toBe(300);
    expect(readImageDpi(jfif(1, 72))).toBeNull();
  });

  test('reads EXIF XResolution in big- and little-endian files', () => {
    const be = [
      0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 2,
      0x01, 0x1a, 0, 5, 0, 0, 0, 1, 0, 0, 0, 38,
      0x01, 0x28, 0, 3, 0, 0, 0, 1, 0, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 1, 0x2c, 0, 0, 0, 1,
    ];
    // 118 dots per centimetre
    const le = [
      0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 2, 0,
      0x1a, 0x01, 5, 0, 1, 0, 0, 0, 38, 0, 0, 0,
      0x28, 0x01, 3, 0, 1, 0, 0, 0, 3, 0, 0, 0,
      0, 0, 0, 0,
      0x76, 0, 0, 0, 1, 0, 0, 0,
    ];
    const exif = (tiff: number[]) => {
      const len = 2 + 6 + tiff.length;
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xda]);
    };
    expect(readImageDpi(exif(be))).toBe(300);
    expect(readImageDpi(exif(le))).toBe(300);
  });

  test('reads PNG pHYs', () => {
    const ppm = Math.round(300 / 0.0254);
    const phys = [0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, ppm >>> 24, (ppm >> 16) & 255, (ppm >> 8) & 255, ppm & 255, ppm >>> 24, (ppm >> 16) & 255, (ppm >> 8) & 255, ppm & 255, 1, 0, 0, 0, 0];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, ...phys]);
    // IHDR chunk with zero length keeps the fixture short
    expect(readImageDpi(png)).toBe(300);
  });

  test('returns null for files without a resolution', () => {
    expect(readImageDpi(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
