import type { ChequeLayout, FieldBox } from '../types';
import { defaultCrossing } from '../layoutDefaults';
import { crop, downscale, rotateQuarter, rotateSmall, toGray, type Raster, type Rect } from './imaging';
import { findSegments, inkColumns, joinCollinear, segLength, segThickness, type Segment } from './segments';

const MM_PER_INCH = 25.4;
const WORK_DPI = 150;
/** Used only for thresholds when the file has no resolution; the user then enters the real width. */
const ASSUMED_WIDTH_MM = 200;
const TEXT_PT = 12;

/** How to turn the uploaded image into an upright, straight cheque. Applied in this order. */
export interface ChequeTransform {
  /** Integer shrink factor applied to the uploaded image before everything else. */
  factor: number;
  region: Rect;
  quarterTurns: number;
  skewDeg: number;
  flip: boolean;
}

export type FieldName = 'payee' | 'payee2' | 'words1' | 'words2' | 'amount' | 'date' | 'bearer';

export interface DetectionResult {
  transform: ChequeTransform;
  /** Resolution of the upright working image. Null when the file did not record it. */
  dpi: number | null;
  sizeKnown: boolean;
  /** True when the upload already showed only the cheque (no scanner margin). */
  croppedUpload: boolean;
  layout: ChequeLayout;
  found: FieldName[];
  guessed: FieldName[];
  warnings: string[];
}

export function applyTransform(img: Raster, t: ChequeTransform): Raster {
  let out = downscale(img, t.factor, img.channels === 1 ? 'min' : 'avg');
  out = crop(out, t.region);
  out = rotateQuarter(out, t.quarterTurns);
  out = rotateSmall(out, t.skewDeg, img.channels === 1 ? 'min' : 'bilinear');
  return t.flip ? rotateQuarter(out, 2) : out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 255;
}

/** Longest run of indexes where pass[i] holds, allowing short gaps. */
function longestRun(pass: boolean[], maxGap: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  let last = -1;
  for (let i = 0; i <= pass.length; i++) {
    if (i < pass.length && pass[i]) {
      if (start < 0 || i - last - 1 > maxGap) {
        if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
        start = i;
      }
      last = i;
    }
  }
  if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
  return best;
}

/** Finds the paper inside a scan by its difference from the scanner background. */
export function findChequeRegion(img: Raster): { rect: Rect; cropped: boolean } {
  const { width: w, height: h, data } = img;
  const border: number[] = [];
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  for (let x = 0; x < w; x += 3) for (let k = 0; k < band; k++) border.push(data[k * w + x], data[(h - 1 - k) * w + x]);
  for (let y = 0; y < h; y += 3) for (let k = 0; k < band; k++) border.push(data[y * w + k], data[y * w + w - 1 - k]);
  const bg = median(border);
  // A scanner lid or table is plain; when the border is printed paper, the upload is already cropped.
  const uniform = border.filter(v => Math.abs(v - bg) <= 8).length / border.length;
  if (uniform < 0.9) return { rect: { x: 0, y: 0, width: w, height: h }, cropped: true };

  const isPaper = bg >= 200 ? (v: number) => v < bg - 6 : (v: number) => v > bg + 40;
  const rowCount = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isPaper(data[y * w + x])) rowCount[y]++;
  const rows = longestRun(rowCount.map(c => c > w * 0.1), Math.round(h * 0.01));
  if (!rows) return { rect: { x: 0, y: 0, width: w, height: h }, cropped: true };
  const inRows = new Array<number>(w).fill(0);
  for (let y = rows[0]; y <= rows[1]; y++) for (let x = 0; x < w; x++) if (isPaper(data[y * w + x])) inRows[x]++;
  const cols = longestRun(inRows.map(c => c > (rows[1] - rows[0] + 1) * 0.03), Math.round(w * 0.01));
  if (!cols) return { rect: { x: 0, y: 0, width: w, height: h }, cropped: true };

  const rect = { x: cols[0], y: rows[0], width: cols[1] - cols[0] + 1, height: rows[1] - rows[0] + 1 };
  const cropped = rect.width > w * 0.92 && rect.height > h * 0.92;
  return cropped ? { rect: { x: 0, y: 0, width: w, height: h }, cropped } : { rect, cropped };
}

/** Printed labels are near-black; security watermarks are much lighter. */
const LABEL_T = 110;

export function darkThreshold(img: Raster): number {
  const sample: number[] = [];
  for (let i = 0; i < img.data.length; i += 7) sample.push(img.data[i]);
  return Math.min(150, median(sample) - 60);
}

/** Small tilt in degrees (positive = the cheque's lines slope down to the right). */
export function estimateSkew(img: Raster, darkT: number): number {
  const pts: Array<[number, number]> = [];
  const step = Math.max(1, Math.round(img.width / 800));
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) if (img.data[y * img.width + x] < darkT) pts.push([x, y]);
  const cx = img.width / 2;
  let best = 0;
  let bestScore = -1;
  for (let a = -3; a <= 3.0001; a += 0.1) {
    const t = Math.tan((a * Math.PI) / 180);
    const bins = new Map<number, number>();
    for (const [x, y] of pts) {
      const b = Math.round((y - (x - cx) * t) / step);
      bins.set(b, (bins.get(b) ?? 0) + 1);
    }
    let score = 0;
    for (const v of bins.values()) score += v * v;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return Math.round(best * 10) / 10;
}

interface Analysis {
  layout: ChequeLayout;
  score: number;
  found: FieldName[];
  guessed: FieldName[];
}

/** Reads the cheque's printed lines and boxes and turns them into field positions. */
export function analyseUpright(img: Raster, mmPerPx: number): Analysis {
  const px = (mm: number) => Math.max(1, Math.round(mm / mmPerPx));
  const mm = (p: number) => Math.round(p * mmPerPx * 100) / 100;
  const W = img.width;
  const H = img.height;
  const darkT = darkThreshold(img);

  const hSegs = joinCollinear(findSegments(img, 'h', darkT, px(6), px(0.5)), px(3), px(0.6)).filter(s => segLength(s, 'h') >= px(12));
  const vSegs = findSegments(img, 'v', darkT, px(3), px(0.3));
  const bars = hSegs.filter(s => segThickness(s, 'h') >= px(0.8) && segLength(s, 'h') > W * 0.5);
  const lines = hSegs.filter(s => segThickness(s, 'h') < px(0.8));
  const lineY = (s: Segment) => (s.y1 + s.y2) / 2;
  const found: FieldName[] = [];
  const guessed: FieldName[] = [];
  let score = 0;
  if (bars.some(b => lineY(b) > H * 0.6)) score += 2;
  if (bars.some(b => lineY(b) < H * 0.4)) score -= 2;

  // Amount box: two vertical sides of matching height on the right half.
  let box: Rect | null = null;
  const sides = vSegs.filter(v => segLength(v, 'v') >= px(4) && segLength(v, 'v') <= px(22) && v.x1 > W * 0.45);
  for (const a of sides) {
    for (const b of sides) {
      const gap = b.x1 - a.x2;
      const overlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
      if (gap < px(20) || gap > px(95) || overlap < 0.8 * Math.max(segLength(a, 'v'), segLength(b, 'v'))) continue;
      const candidate = { x: a.x1, y: Math.min(a.y1, b.y1), width: b.x2 - a.x1 + 1, height: Math.max(a.y2, b.y2) - Math.min(a.y1, b.y1) + 1 };
      if (!box || candidate.x > box.x) box = candidate;
    }
  }
  // Fallback: a box drawn as top and bottom lines of equal span.
  if (!box) {
    for (const a of lines) {
      for (const b of lines) {
        const dy = lineY(b) - lineY(a);
        if (dy < px(5) || dy > px(20) || a.x1 < W * 0.45) continue;
        if (Math.abs(a.x1 - b.x1) > px(2) || Math.abs(a.x2 - b.x2) > px(2)) continue;
        const width = a.x2 - a.x1;
        if (width < px(20) || width > px(95)) continue;
        box = { x: a.x1, y: a.y1, width, height: b.y2 - a.y1 };
      }
    }
  }
  if (box) score += 3;

  // Date: eight digit cells (vertical ticks) or a short line, top right.
  let date: ChequeLayout['date'] | null = null;
  const ticks = vSegs
    .filter(v => segLength(v, 'v') >= px(3) && segLength(v, 'v') <= px(10) && v.y2 < H * 0.45 && v.x1 > W * 0.5)
    .sort((a, b) => a.x1 - b.x1);
  const rowsOfTicks = new Map<number, Segment[]>();
  for (const t of ticks) {
    const key = [...rowsOfTicks.keys()].find(k => Math.abs(k - t.y1) <= px(1.5)) ?? t.y1;
    rowsOfTicks.set(key, [...(rowsOfTicks.get(key) ?? []), t]);
  }
  for (const row of rowsOfTicks.values()) {
    const cells: FieldBox[] = [];
    for (let i = 0; i + 1 < row.length; i++) {
      const gap = row[i + 1].x1 - row[i].x2;
      if (gap >= px(2.5) && gap <= px(8)) {
        const top = Math.min(row[i].y1, row[i + 1].y1);
        const height = Math.max(row[i].y2, row[i + 1].y2) - top;
        cells.push({ x: mm(row[i].x2 + 1), y: mm(top), width: mm(gap), height: mm(height), fontPt: Math.min(TEXT_PT, Math.round(mm(height) / 0.3528 / 1.3)), align: 'center' });
      }
    }
    if (cells.length === 8) {
      date = { mode: 'digits', boxes: cells };
      break;
    }
  }

  const textBox = (line: Segment, maxHeightMm = 6): FieldBox => {
    const span = freeSpan(img, line, darkT, px);
    const height = Math.min(maxHeightMm, 6);
    const bottom = mm(line.y1) - 0.4;
    return { x: mm(span.start), y: Math.round((bottom - height) * 100) / 100, width: mm(span.end - span.start), height, fontPt: TEXT_PT };
  };

  // Body lines: long lines that start on the left, below the header and above the signature area.
  const top = H * 0.12;
  const body: Segment[] = [];
  for (const s of lines
    .filter(s => s.x1 < W * 0.35 && segLength(s, 'h') > W * 0.35 && lineY(s) > top && lineY(s) < H * 0.82)
    .sort((a, b) => lineY(a) - lineY(b))) {
    // Two edges of one printed line count once.
    const prev = body[body.length - 1];
    if (prev && lineY(s) - lineY(prev) < px(1.5)) {
      if (segLength(s, 'h') > segLength(prev, 'h')) body[body.length - 1] = s;
    } else {
      body.push(s);
    }
  }
  score += Math.min(body.length, 4);

  const spacingMm = body.length > 1 ? mm(median(body.slice(1).map((s, i) => lineY(s) - lineY(body[i])))) : 9;
  const fieldHeight = Math.max(3.5, Math.min(6, spacingMm - 1.5));

  const payeeLine: Segment | undefined = body[0];

  // Written date: a short line on the right above the payee line, preferably with a label ("Date") before it.
  if (!date) {
    const limit = payeeLine ? lineY(payeeLine) - px(3) : H * 0.4;
    const dateLine = lines
      .filter(s => lineY(s) < limit && lineY(s) > px(3) && s.x2 > W * 0.6 && segLength(s, 'h') < W * 0.6 && segLength(s, 'h') >= px(15))
      .map(s => ({ s, labelled: leadingLabel(img, s, darkT, px) !== null || hasLabelBefore(img, s, darkT, px) }))
      .sort((a, b) => Number(b.labelled) - Number(a.labelled) || lineY(b.s) - lineY(a.s))[0]?.s;
    if (dateLine) date = { mode: 'line', box: textBox(dateLine) };
  }
  if (date) score += 2;
  let words2: Segment | undefined;
  let words1: Segment | undefined;
  if (body.length >= 3) {
    words2 = box
      ? body.reduce((best, s) => (Math.abs(lineY(s) - (box!.y + box!.height)) < Math.abs(lineY(best) - (box!.y + box!.height)) ? s : best))
      : body[body.length - 1];
    if (words2 === payeeLine) words2 = body[body.length - 1];
    words1 = body[body.indexOf(words2) - 1];
    if (words1 === payeeLine) words1 = undefined;
  } else if (body.length === 2) {
    words1 = body[1];
  }
  const payee2Line = payeeLine && words1 ? body.find(s => lineY(s) > lineY(payeeLine!) && lineY(s) < lineY(words1!)) : undefined;

  const fallback = (yMm: number, xMm: number, wMm: number): FieldBox => ({ x: xMm, y: yMm, width: wMm, height: fieldHeight, fontPt: TEXT_PT });
  const Wmm = mm(W);
  const Hmm = mm(H);

  // A words line that runs under the amount box (or its currency sign) must stop before it.
  // The first words line also stops there when the box is below it, so the rest of the words
  // wrap to line 2 instead of running across the amount column.
  const clipToBox = (name: FieldName, line: Segment): Segment => {
    if (!box || line.x2 <= box.x) return line;
    const textOverlap = Math.min(line.y1, box.y + box.height) - Math.max(line.y1 - px(5), box.y);
    const boxBelow = name === 'words1' && box.y >= line.y1 - px(2);
    return textOverlap >= px(2) || boxBelow ? { ...line, x2: box.x - px(1) } : line;
  };

  const pick = (name: FieldName, line: Segment | undefined, make: () => FieldBox): FieldBox => {
    (line ? found : guessed).push(name);
    return line ? textBox(clipToBox(name, line), fieldHeight) : make();
  };

  const payee = pick('payee', payeeLine, () => fallback(Hmm * 0.32, Wmm * 0.15, Wmm * 0.7));
  const w1 = pick('words1', words1, () => fallback(payee.y + spacingMm * 1.5, Wmm * 0.12, Wmm * 0.55));
  const w2 = pick('words2', words2, () => fallback(w1.y + spacingMm, Wmm * 0.03, Wmm * 0.55));

  let amount: FieldBox;
  if (box) {
    found.push('amount');
    const height = Math.min(7, mm(box.height) - 1);
    amount = { x: mm(box.x) + 2, y: mm(box.y + box.height / 2) - height / 2, width: mm(box.width) - 4, height, fontPt: TEXT_PT };
  } else {
    guessed.push('amount');
    amount = fallback(w1.y + spacingMm / 2, Wmm * 0.72, Wmm * 0.22);
  }

  let dateField: ChequeLayout['date'];
  if (date) {
    found.push('date');
    dateField = date;
  } else {
    guessed.push('date');
    dateField = { mode: 'line', box: fallback(Hmm * 0.15, Wmm * 0.7, Wmm * 0.22) };
  }

  // "Or bearer": the label at the start of the second payee line, else the end of the payee line.
  let bearerStrike: ChequeLayout['bearerStrike'];
  const label = payee2Line ? leadingLabel(img, payee2Line, darkT, px) : null;
  const rowLabel = !label && payeeLine && words1 ? labelBetween(img, payeeLine, words1, px) : null;
  if (rowLabel) {
    found.push('bearer');
    const width = mm(rowLabel.x2 - rowLabel.x1);
    const height = Math.min(fieldHeight, mm(rowLabel.y2 - rowLabel.y1) + 1);
    bearerStrike = { x: mm(rowLabel.x1), y: mm((rowLabel.y1 + rowLabel.y2) / 2) - height / 2, width, height, fontPt: TEXT_PT, text: 'X'.repeat(Math.max(3, Math.round(width / 2.4))) };
  } else if (payee2Line && label) {
    found.push('bearer');
    const height = fieldHeight;
    const width = mm(label - payee2Line.x1);
    bearerStrike = { x: mm(payee2Line.x1), y: mm(payee2Line.y1) - 0.4 - height, width, height, fontPt: TEXT_PT, text: 'X'.repeat(Math.max(3, Math.round(width / 2.4))) };
  } else {
    guessed.push('bearer');
    bearerStrike = { x: payee.x + payee.width - 22, y: payee.y, width: 22, height: payee.height, fontPt: TEXT_PT, text: 'XXXXXXXX' };
  }

  const crossing = defaultCrossing();
  const layout: ChequeLayout = {
    chequeWidth: Wmm,
    chequeHeight: Hmm,
    payee,
    payee2: null,
    amount,
    words1: w1,
    words2: w2,
    date: dateField,
    bearerStrike,
    acPayee: crossing.acPayee,
    crossingLines: crossing.lines,
  };
  return { layout, score, found, guessed };
}

/** Text printed on its own row at the left, between two lines (e.g. FAB's "or the Bearer"). */
function labelBetween(img: Raster, above: Segment, below: Segment, px: (mm: number) => number): Segment | null {
  const y1 = above.y2 + px(0.8);
  const y2 = below.y1 - px(4.5);
  if (y2 - y1 < px(2)) return null;
  const cols = inkColumns(img, above.x1, above.x1 + px(60), y1, y2, LABEL_T);
  const first = cols.findIndex(Boolean);
  if (first < 0 || first > px(6)) return null;
  let end = first;
  let blank = 0;
  for (let i = first; i < cols.length && blank < px(2.5); i++) {
    blank = cols[i] ? 0 : blank + 1;
    if (cols[i]) end = i;
  }
  let top = y2;
  let bottom = y1;
  for (let y = y1; y <= y2; y++) {
    for (let x = above.x1 + first; x <= above.x1 + end; x++) {
      if (img.data[y * img.width + x] < LABEL_T) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
  }
  return { x1: above.x1 + first, x2: above.x1 + end + 1, y1: top, y2: bottom };
}

/** True when printed text sits just left of a line on the same baseline (e.g. "Date ____"). */
function hasLabelBefore(img: Raster, line: Segment, darkT: number, px: (mm: number) => number): boolean {
  return inkColumns(img, line.x1 - px(12), line.x1 - px(0.5), line.y1 - px(4), line.y2, Math.min(darkT, LABEL_T)).some(Boolean);
}

/** End (exclusive, px) of the printed label at the start of a line, or null when there is none. */
function leadingLabel(img: Raster, line: Segment, darkT: number, px: (mm: number) => number): number | null {
  const cols = inkColumns(img, line.x1, line.x2, line.y1 - px(4), line.y1 - px(0.5), Math.min(darkT, LABEL_T));
  if (!cols.slice(0, px(3)).some(Boolean)) return null;
  const gap = px(2.5);
  let blank = 0;
  for (let i = 0; i < cols.length; i++) {
    blank = cols[i] ? 0 : blank + 1;
    if (blank >= gap) return line.x1 + i - gap + 1;
  }
  return null;
}

/** The writable part of a line: after any label at the start and before any label at the end. */
function freeSpan(img: Raster, line: Segment, darkT: number, px: (mm: number) => number): { start: number; end: number } {
  const cols = inkColumns(img, line.x1, line.x2 + 1, line.y1 - px(4), line.y1 - px(0.5), Math.min(darkT, LABEL_T));
  const gap = px(2.5);
  const edge = (from: number, step: 1 | -1): number => {
    const hasLabel = Array.from({ length: px(3) }, (_, k) => cols[from + step * k]).some(Boolean);
    if (!hasLabel) return from + step * px(1);
    let blank = 0;
    for (let i = from; i >= 0 && i < cols.length; i += step) {
      blank = cols[i] ? 0 : blank + 1;
      if (blank >= gap) return i - step * (gap - px(1.5));
    }
    return from + step * px(1);
  };
  const start = line.x1 + edge(0, 1);
  const end = line.x1 + edge(cols.length - 1, -1);
  return end - start > px(10) ? { start, end } : { start: line.x1 + px(1), end: line.x2 - px(1) };
}

export interface DetectInput {
  image: Raster;
  /** Resolution of the uploaded image, when known (scanner metadata or PDF render). */
  dpi: number | null;
  /** Overrides the automatic up/down decision: true = turn the cheque upside down from how it was found. */
  flip?: boolean;
}

/** Finds the cheque in a scan or photo and works out where each field should print. */
export function detectCheque({ image, dpi, flip: forceFlip }: DetectInput): DetectionResult {
  const warnings: string[] = [];
  const gray = toGray(image);
  // Without a recorded resolution, assume the longest side is about one cheque width and aim for the same working resolution.
  const factor = Math.max(1, Math.round(dpi ? dpi / WORK_DPI : Math.max(gray.width, gray.height) / ((ASSUMED_WIDTH_MM / MM_PER_INCH) * WORK_DPI)));
  const work = downscale(gray, factor, 'min');

  const { rect, cropped } = findChequeRegion(work);
  let upright = crop(work, rect);
  const quarterTurns = upright.height > upright.width ? 1 : 0;
  upright = rotateQuarter(upright, quarterTurns);
  const skewDeg = -estimateSkew(upright, darkThreshold(upright));
  upright = rotateSmall(upright, skewDeg);

  const workDpi = dpi ? dpi / factor : null;
  const mmPerPx = workDpi ? MM_PER_INCH / workDpi : ASSUMED_WIDTH_MM / upright.width;

  const asIs = analyseUpright(upright, mmPerPx);
  const turned = analyseUpright(rotateQuarter(upright, 2), mmPerPx);
  const flip = forceFlip ?? turned.score > asIs.score;
  const best = flip ? turned : asIs;

  if (!workDpi) warnings.push('This image does not record its scan resolution. Enter the cheque width measured with a ruler.');
  if (best.guessed.length) warnings.push(`Could not find: ${best.guessed.join(', ')}. Drag these fields into place.`);

  return {
    transform: { factor, region: rect, quarterTurns, skewDeg, flip },
    dpi: workDpi,
    sizeKnown: workDpi !== null,
    croppedUpload: cropped,
    layout: best.layout,
    found: best.found,
    guessed: best.guessed,
    warnings,
  };
}
