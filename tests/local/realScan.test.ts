// Runs detection on a real scan supplied through SCAN_JPEG (never committed) and writes overlays to SCAN_OUT.
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, test } from 'vitest';
import { applyTransform, detectCheque } from '../../src/shared/detect/detectCheque';
import { crop, rotateQuarter, type Raster } from '../../src/shared/detect/imaging';
import type { ChequeLayout, FieldBox } from '../../src/shared/types';

const file = process.env.SCAN_JPEG;
const out = process.env.SCAN_OUT ?? '.';
const dpi = Number(process.env.SCAN_DPI ?? 300);

function overlay(img: Raster, layout: ChequeLayout, name: string) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  const k = img.width / layout.chequeWidth;
  const rect = (b: FieldBox, rgb: [number, number, number]) => {
    const x0 = Math.round(b.x * k), y0 = Math.round(b.y * k), x1 = Math.round((b.x + b.width) * k), y1 = Math.round((b.y + b.height) * k);
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1, y0 + 1, y1 - 1]) put(x, y, rgb);
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1, x0 + 1, x1 - 1]) put(x, y, rgb);
  };
  const put = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4; png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  };
  rect(layout.payee, [255, 0, 0]);
  if (layout.payee2) rect(layout.payee2, [255, 128, 0]);
  rect(layout.words1, [0, 160, 0]);
  rect(layout.words2, [0, 100, 0]);
  rect(layout.amount, [0, 0, 255]);
  if (layout.date.mode === 'line') rect(layout.date.box, [200, 0, 200]); else layout.date.boxes.forEach(b => rect(b, [200, 0, 200]));
  rect(layout.bearerStrike, [0, 200, 200]);
  fs.writeFileSync(path.join(out, name), PNG.sync.write(png));
}

describe.runIf(file)('real scan', () => {
  let source: Raster;
  beforeAll(() => {
    const decoded = jpeg.decode(fs.readFileSync(file!), { useTArray: true });
    source = { width: decoded.width, height: decoded.height, channels: 4, data: decoded.data };
  });

  test('full A4 scan', () => {
    const r = detectCheque({ image: source, dpi });
    fs.writeFileSync(path.join(out, "detect-full.json"), JSON.stringify(r, null, 1));
    overlay(applyTransform(source, r.transform), r.layout, 'overlay-full.png');
    expect(r.found).toContain('payee');
  });

  test('cropped and rotated upload of the same cheque', () => {
    const first = detectCheque({ image: source, dpi });
    const f = first.transform.factor;
    const reg = first.transform.region;
    const tight = crop(source, { x: reg.x * f + 10, y: reg.y * f + 10, width: reg.width * f - 20, height: reg.height * f - 20 });
    const portrait = rotateQuarter(tight, 1);
    const r = detectCheque({ image: portrait, dpi });
    fs.writeFileSync(path.join(out, "detect-cropped.json"), JSON.stringify(r, null, 1));
    console.log('cropped:', r.croppedUpload, r.layout.chequeWidth, r.layout.chequeHeight, r.transform, r.found, r.guessed);
    overlay(applyTransform(portrait, r.transform), r.layout, 'overlay-cropped.png');
    // A cropped, portrait JPEG without a recorded resolution, like a phone photo, for the app smoke test.
    fs.writeFileSync(path.join(out, 'cropped-upload.jpg'), jpeg.encode({ width: portrait.width, height: portrait.height, data: portrait.data }, 90).data);
    expect(r.croppedUpload).toBe(true);
  });
});
