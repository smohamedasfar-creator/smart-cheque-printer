// Measures the cheque-number (MICR) band clue on real cheques kept outside the repository.
// BOOKS_JSON=books.json SCAN_JPEG=scan.jpg SCAN_DPI=300 npx vitest run tests/local/micr.test.ts
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { describe, expect, test } from 'vitest';
import { applyTransform, detectCheque, micrSide } from '../../src/shared/detect/detectCheque';
import { rotateQuarter, toGray, type Raster } from '../../src/shared/detect/imaging';

const books: Array<{ name: string; image: string }> = process.env.BOOKS_JSON ? JSON.parse(fs.readFileSync(process.env.BOOKS_JSON, 'utf8')).books : [];
const scan = process.env.SCAN_JPEG;

function decode(bytes: Buffer): Raster {
  const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 2048 });
  return { width: img.width, height: img.height, channels: 4, data: new Uint8ClampedArray(img.data) } as Raster;
}

describe.runIf(books.length || scan)('the cheque numbers run along the bottom edge', () => {
  for (const b of books) {
    test(`${b.name}: bottom upright, top when turned`, () => {
      const up = toGray(decode(Buffer.from(b.image.split(',')[1], 'base64')));
      console.log(b.name, micrSide(up), micrSide(rotateQuarter(up, 2)));
      expect(micrSide(up)).toBe('bottom');
      expect(micrSide(rotateQuarter(up, 2))).toBe('top');
    });
  }
  test.runIf(scan)('scanned cheque comes out with the numbers at the bottom', () => {
    const img = decode(fs.readFileSync(scan!));
    const r = detectCheque({ image: img, dpi: Number(process.env.SCAN_DPI ?? 300) });
    const upright = toGray(applyTransform(img, r.transform));
    console.log('scan', r.transform, r.layout.chequeWidth.toFixed(1), r.layout.chequeHeight.toFixed(1), micrSide(upright));
    expect(micrSide(upright)).toBe('bottom');
  });
});
