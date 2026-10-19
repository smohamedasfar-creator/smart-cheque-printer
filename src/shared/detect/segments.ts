import type { Raster } from './imaging';

/** A straight printed line, in pixels. x1..x2 and y1..y2 are inclusive. */
export interface Segment {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export const segLength = (s: Segment, dir: 'h' | 'v') => (dir === 'h' ? s.x2 - s.x1 + 1 : s.y2 - s.y1 + 1);
export const segThickness = (s: Segment, dir: 'h' | 'v') => (dir === 'h' ? s.y2 - s.y1 + 1 : s.x2 - s.x1 + 1);

interface Run {
  pos: number;
  a: number;
  b: number;
}

const MIN_RUN_DENSITY = 0.85;

/**
 * Finds horizontal ('h') or vertical ('v') line segments made of dark pixels.
 * Runs may have small gaps (scan noise) but must be mostly solid, which rejects text.
 */
export function findSegments(img: Raster, dir: 'h' | 'v', darkT: number, minLen: number, maxGap: number): Segment[] {
  const { width: w, height: h } = img;
  const [outer, inner] = dir === 'h' ? [h, w] : [w, h];
  const at = dir === 'h' ? (o: number, i: number) => img.data[o * w + i] : (o: number, i: number) => img.data[i * w + o];

  const runs: Run[] = [];
  for (let o = 0; o < outer; o++) {
    let start = -1;
    let last = -1;
    let dark = 0;
    const close = () => {
      if (start >= 0 && last - start + 1 >= minLen && dark / (last - start + 1) >= MIN_RUN_DENSITY) runs.push({ pos: o, a: start, b: last });
      start = -1;
      dark = 0;
    };
    for (let i = 0; i < inner; i++) {
      if (at(o, i) < darkT) {
        if (start >= 0 && i - last - 1 > maxGap) close();
        if (start < 0) start = i;
        last = i;
        dark++;
      }
    }
    close();
  }

  // Join runs on neighbouring rows (or columns) that overlap into one segment.
  const open: Array<{ pos2: number; a: number; b: number; pos1: number }> = [];
  const done: Segment[] = [];
  for (const r of runs) {
    // Same line on the next row: overlapping, or continuing end-to-end (a slightly tilted line steps between rows).
    const match = open.find(s => {
      if (r.pos - s.pos2 > 2) return false;
      const overlap = Math.min(s.b, r.b) - Math.max(s.a, r.a);
      // Overlap measured against the longer run, so a short run of label text never thickens a long line.
      return overlap >= 0.5 * Math.max(s.b - s.a, r.b - r.a) || (overlap >= -maxGap - 1 && overlap <= 0);
    });
    if (match) {
      match.pos2 = r.pos;
      match.a = Math.min(match.a, r.a);
      match.b = Math.max(match.b, r.b);
    } else {
      open.push({ pos1: r.pos, pos2: r.pos, a: r.a, b: r.b });
    }
    for (let k = open.length - 1; k >= 0; k--) {
      if (r.pos - open[k].pos2 > 2) done.push(...toSegments(open.splice(k, 1), dir));
    }
  }
  done.push(...toSegments(open, dir));
  return done;
}

function toSegments(items: Array<{ pos1: number; pos2: number; a: number; b: number }>, dir: 'h' | 'v'): Segment[] {
  return items.map(s => (dir === 'h' ? { x1: s.a, x2: s.b, y1: s.pos1, y2: s.pos2 } : { x1: s.pos1, x2: s.pos2, y1: s.a, y2: s.b }));
}

/** Returns true for each column in [x1, x2) that has ink between rows y1..y2. */
export function inkColumns(img: Raster, x1: number, x2: number, y1: number, y2: number, darkT: number): boolean[] {
  const cols: boolean[] = [];
  const top = Math.max(0, y1);
  const bottom = Math.min(img.height - 1, y2);
  for (let x = Math.max(0, x1); x < Math.min(img.width, x2); x++) {
    let ink = false;
    for (let y = top; y <= bottom && !ink; y++) ink = img.data[y * img.width + x] < darkT;
    cols.push(ink);
  }
  return cols;
}

/** Joins pieces of the same horizontal line that were split by small breaks (scan dropouts, low resolution). */
export function joinCollinear(segs: Segment[], maxGap: number, maxDy: number): Segment[] {
  const out = [...segs].sort((a, b) => a.x1 - b.x1);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i];
        const b = out[j];
        const dy = Math.abs((a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2);
        const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
        if (dy <= maxDy && gap <= maxGap) {
          // Keep the thickness of the pieces (a sloped line steps between rows; it is not a thick bar).
          const la = a.x2 - a.x1 + 1;
          const lb = b.x2 - b.x1 + 1;
          const centre = (((a.y1 + a.y2) / 2) * la + ((b.y1 + b.y2) / 2) * lb) / (la + lb);
          const thickness = Math.max(a.y2 - a.y1, b.y2 - b.y1) + 1;
          const y1 = Math.round(centre - (thickness - 1) / 2);
          out[i] = { x1: Math.min(a.x1, b.x1), x2: Math.max(a.x2, b.x2), y1, y2: y1 + thickness - 1 };
          out.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return out;
}
