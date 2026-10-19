// Reads the scan resolution stored in image files, so sizes can be measured in millimetres.

const CM_PER_INCH = 2.54;

function jpegDpi(b: Uint8Array): number | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    const len = (b[p + 2] << 8) | b[p + 3];
    const seg = p + 4;
    // APP0 JFIF: units (1 = dpi, 2 = dots/cm), Xdensity
    if (marker === 0xe0 && String.fromCharCode(...b.subarray(seg, seg + 4)) === 'JFIF') {
      const units = b[seg + 7];
      const x = (b[seg + 8] << 8) | b[seg + 9];
      if (units === 1 && x > 1) return x;
      if (units === 2 && x > 1) return Math.round(x * CM_PER_INCH);
    }
    // APP1 Exif: IFD0 XResolution (0x011a) rational, ResolutionUnit (0x0128)
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(seg, seg + 4)) === 'Exif') {
      const dpi = exifDpi(b.subarray(seg + 6, p + 2 + len));
      if (dpi) return dpi;
    }
    if (marker === 0xda) break;
    p += 2 + len;
  }
  return null;
}

function exifDpi(t: Uint8Array): number | null {
  const le = t[0] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 2 ** 24 : t[o] * 2 ** 24 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  const ifd = u32(4);
  const count = u16(ifd);
  let res: number | null = null;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e);
    if (tag === 0x011a) {
      const off = u32(e + 8);
      const den = u32(off + 4);
      if (den) res = u32(off) / den;
    }
    if (tag === 0x0128) unit = u16(e + 8);
  }
  if (!res || res <= 1) return null;
  if (unit === 3) return Math.round(res * CM_PER_INCH);
  return unit === 2 ? Math.round(res) : null;
}

function pngDpi(b: Uint8Array): number | null {
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (!sig.every((v, i) => b[i] === v)) return null;
  let p = 8;
  while (p + 12 <= b.length) {
    const len = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    if (type === 'pHYs') {
      const d = p + 8;
      const ppu = ((b[d] << 24) | (b[d + 1] << 16) | (b[d + 2] << 8) | b[d + 3]) >>> 0;
      // unit 1 = metre
      if (b[d + 8] === 1 && ppu > 0) return Math.round((ppu * CM_PER_INCH) / 100);
      return null;
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    p += 12 + len;
  }
  return null;
}

/** Returns dots per inch recorded in a JPEG or PNG, or null when the file does not say. */
export function readImageDpi(bytes: Uint8Array): number | null {
  const dpi = jpegDpi(bytes) ?? pngDpi(bytes);
  // 72/96 dpi are software defaults, not real scan resolutions.
  return dpi && dpi !== 72 && dpi !== 96 ? dpi : null;
}
