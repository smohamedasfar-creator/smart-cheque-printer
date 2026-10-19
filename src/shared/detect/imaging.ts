// Minimal raster helpers for cheque detection. Pure TypeScript so they run in the UI and in tests.

export interface Raster {
  width: number;
  height: number;
  /** 1 = grayscale, 4 = RGBA */
  channels: 1 | 4;
  data: Uint8Array | Uint8ClampedArray;
}

export function createRaster(width: number, height: number, channels: 1 | 4, fill = 255): Raster {
  const data = new Uint8ClampedArray(width * height * channels).fill(fill);
  if (channels === 4) for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, channels, data };
}

export function toGray(img: Raster): Raster {
  if (img.channels === 1) return img;
  const out = createRaster(img.width, img.height, 1);
  const d = img.data;
  for (let i = 0, p = 0; p < out.data.length; i += 4, p++) {
    out.data[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  }
  return out;
}

/** Shrinks by an integer factor. "min" keeps thin dark lines visible; "avg" looks natural. */
export function downscale(img: Raster, factor: number, mode: 'min' | 'avg'): Raster {
  if (factor <= 1) return img;
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const c = img.channels;
  const out = createRaster(w, h, c);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let ch = 0; ch < c; ch++) {
        let acc = mode === 'min' ? 255 : 0;
        for (let dy = 0; dy < factor; dy++) {
          const row = ((y * factor + dy) * img.width + x * factor) * c + ch;
          for (let dx = 0; dx < factor; dx++) {
            const v = img.data[row + dx * c];
            acc = mode === 'min' ? Math.min(acc, v) : acc + v;
          }
        }
        out.data[(y * w + x) * c + ch] = mode === 'min' ? acc : acc / (factor * factor);
      }
    }
  }
  return out;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function crop(img: Raster, r: Rect): Raster {
  const c = img.channels;
  const out = createRaster(r.width, r.height, c);
  for (let y = 0; y < r.height; y++) {
    const src = ((r.y + y) * img.width + r.x) * c;
    out.data.set(img.data.subarray(src, src + r.width * c), y * r.width * c);
  }
  return out;
}

/** Rotates clockwise by quarter turns (0..3). */
export function rotateQuarter(img: Raster, turns: number): Raster {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return img;
  const { width: w, height: h, channels: c } = img;
  const [ow, oh] = t === 2 ? [w, h] : [h, w];
  const out = createRaster(ow, oh, c);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (t === 1) { nx = h - 1 - y; ny = x; }
      else if (t === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const s = (y * w + x) * c;
      const d = (ny * ow + nx) * c;
      for (let ch = 0; ch < c; ch++) out.data[d + ch] = img.data[s + ch];
    }
  }
  return out;
}

/**
 * Rotates by a small angle (degrees, positive = clockwise) about the centre, white fill.
 * "min" takes the darkest of the four nearest source pixels so one-pixel lines stay unbroken;
 * "bilinear" blends them for natural-looking photos.
 */
export function rotateSmall(img: Raster, degrees: number, mode: 'min' | 'bilinear' = 'min'): Raster {
  if (Math.abs(degrees) < 0.01) return img;
  const { width: w, height: h, channels: c } = img;
  const out = createRaster(w, h, c);
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // inverse mapping: destination -> source
      const dx = x - cx;
      const dy = y - cy;
      const fx = cos * dx + sin * dy + cx;
      const fy = -sin * dx + cos * dy + cy;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      const tx = fx - x0;
      const ty = fy - y0;
      const d = (y * w + x) * c;
      for (let ch = 0; ch < c; ch++) {
        const a = img.data[(y0 * w + x0) * c + ch];
        const b = img.data[(y0 * w + x0 + 1) * c + ch];
        const e = img.data[((y0 + 1) * w + x0) * c + ch];
        const f = img.data[((y0 + 1) * w + x0 + 1) * c + ch];
        out.data[d + ch] =
          mode === 'min' ? Math.min(a, b, e, f) : a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + e * (1 - tx) * ty + f * tx * ty;
      }
    }
  }
  return out;
}

export const pixel = (img: Raster, x: number, y: number) => img.data[(y * img.width + x) * img.channels];
