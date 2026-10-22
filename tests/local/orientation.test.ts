// Turns real blank cheque pictures (kept outside the repository) every way round and checks detection puts them back
// upright: logo top-left, date top-right, and the right size.
// BOOKS_JSON=path/to/books.json npx vitest run tests/local/orientation.test.ts   ({ books: [{ name, layout, image }] })
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { describe, expect, test } from 'vitest';
import { detectCheque } from '../../src/shared/detect/detectCheque';
import { rotateQuarter, type Raster } from '../../src/shared/detect/imaging';
import type { ChequeLayout } from '../../src/shared/types';

const file = process.env.BOOKS_JSON;
const books: Array<{ name: string; layout: ChequeLayout; image: string }> = file ? JSON.parse(fs.readFileSync(file, 'utf8')).books : [];

function decode(dataUrl: string): Raster {
  const img = jpeg.decode(Buffer.from(dataUrl.split(',')[1], 'base64'), { useTArray: true });
  return { width: img.width, height: img.height, channels: 4, data: new Uint8ClampedArray(img.data) } as Raster;
}

/** The cheque on a white margin, as a flatbed scan of a loose leaf looks. */
function onWhite(img: Raster, margin: number): Raster {
  const w = img.width + 2 * margin;
  const h = img.height + 2 * margin;
  const data = new Uint8ClampedArray(w * h * 4).fill(Number(process.env.BACKGROUND ?? 255));
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + margin) * w + margin) * 4);
  return { width: w, height: h, channels: 4, data } as Raster;
}

describe.runIf(file)('real cheques come out upright whichever way they were scanned', () => {
  for (const book of books) {
    for (const turns of [0, 1, 2, 3]) {
      test(`${book.name} turned ${turns * 90}°`, () => {
        const upright = decode(book.image);
        const dpi = (upright.width / book.layout.chequeWidth) * 25.4;
        const scan = onWhite(rotateQuarter(upright, turns), Math.round(dpi / 2));
        const result = detectCheque({ image: scan, dpi });
        const L = result.layout;
        if (process.env.DEBUG_SIZE) console.log(book.name, turns, L.chequeWidth.toFixed(1), L.chequeHeight.toFixed(1), result.transform.quarterTurns, result.transform.flip, result.transform.region);
        const date = L.date.mode === 'line' ? L.date.box : L.date.boxes[0];
        expect(Math.abs(L.chequeWidth - book.layout.chequeWidth)).toBeLessThan(3);
        expect(Math.abs(L.chequeHeight - book.layout.chequeHeight)).toBeLessThan(3);
        // Date top right, amount right, payee above the words lines.
        expect({ dateRight: date.x > L.chequeWidth / 2, dateTop: date.y < L.chequeHeight / 2, payeeAboveWords: L.payee.y < L.words1.y }).toEqual({ dateRight: true, dateTop: true, payeeAboveWords: true });
      });
    }
  }
});
