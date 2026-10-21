import { amountInWords, formatAmount } from './amountInWords';
import type {
  ChequeLayout,
  DateFormat,
  ChequeData,
  CrossingOption,
  FieldBox,
  MeasureText,
  PrintSettings,
  RenderItem,
  TextItem,
  TextRole,
} from './types';

/** Smallest font a line may shrink to so it stays inside its printed line. */
export const MIN_PT = 8;
/** Millimetres per typographic point. */
export const PT_TO_MM = 25.4 / 72;
/** Text keeps at least this far inside the cheque edge, so nothing prints off the leaf. */
export const CHEQUE_EDGE_MM = 1;
export const TEXT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20];
const FONT_STEP = 0.25;

export function dateDigits(isoDate: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Invalid date: ${isoDate}`);
  const [, y, m, d] = match;
  const parsed = new Date(Date.UTC(+y, +m - 1, +d));
  if (parsed.getUTCMonth() !== +m - 1 || parsed.getUTCDate() !== +d) throw new Error(`Invalid date: ${isoDate}`);
  return [...d, ...m, ...y];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(isoDate: string, format: DateFormat): string {
  const [d1, d2, m1, m2, y1, y2, y3, y4] = dateDigits(isoDate);
  const dd = d1 + d2;
  const mm = m1 + m2;
  const yyyy = y1 + y2 + y3 + y4;
  switch (format) {
    case 'DD-MM-YYYY': return `${dd}-${mm}-${yyyy}`;
    case 'DD.MM.YYYY': return `${dd}.${mm}.${yyyy}`;
    case 'DD MMM YYYY': return `${dd} ${MONTHS[Number(mm) - 1]} ${yyyy}`;
    case 'DD/MM/YY': return `${dd}/${mm}/${y3 + y4}`;
    default: return `${dd}/${mm}/${yyyy}`;
  }
}

/** Greedy word wrap into two lines of different widths. */
export function splitWords(
  text: string,
  width1: number,
  width2: number,
  measure: (text: string) => number,
): { lines: [string, string]; overflow: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: [string, string] = ['', ''];
  const widths = [width1, width2];
  let line = 0;
  let overflow = false;
  for (const word of words) {
    const candidate = lines[line] ? `${lines[line]} ${word}` : word;
    if (measure(candidate) <= widths[line]) {
      lines[line] = candidate;
    } else if (line === 0 && lines[0]) {
      line = 1;
      lines[1] = word;
      overflow ||= measure(word) > widths[1];
    } else {
      lines[line] = candidate;
      overflow = true;
    }
  }
  return { lines, overflow };
}

function text(role: TextRole, value: string, box: FieldBox, overrides: Partial<TextItem> = {}): TextItem {
  return {
    kind: 'text',
    role,
    text: value,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fontPt: box.fontPt,
    align: box.align ?? 'left',
    rotation: box.rotation ?? 0,
    ...overrides,
  };
}

export const splitIntoWords = (text: string) => text.split(/\s+/).filter(Boolean);

/** Largest font (up to the box's own) at which a line fits the box width, but never below MIN_PT. */
function fitFont(line: string, box: FieldBox, measure: MeasureText): { fontPt: number; fits: boolean } {
  const width = measure(line, box.fontPt);
  if (width <= box.width) return { fontPt: box.fontPt, fits: true };
  const fontPt = Math.max(MIN_PT, (box.fontPt * box.width) / width);
  return { fontPt, fits: measure(line, fontPt) <= box.width + 0.01 };
}

export interface TwoLines {
  lines: [string, string];
  fonts: [number, number];
  fits: boolean;
}

/**
 * Places text on two printed lines. A manual break (index of the first word of line 2) is used when valid;
 * otherwise words wrap at the end of line 1. Text never runs past a line: the font shrinks instead.
 */
export function fitTwoLines(text: string, box1: FieldBox, box2: FieldBox, measure: MeasureText, breakAt?: number | null): TwoLines {
  const words = splitIntoWords(text);
  if (breakAt != null && breakAt > 0 && breakAt < words.length) {
    const lines: [string, string] = [words.slice(0, breakAt).join(' '), words.slice(breakAt).join(' ')];
    const a = fitFont(lines[0], box1, measure);
    const b = fitFont(lines[1], box2, measure);
    return { lines, fonts: [a.fontPt, b.fontPt], fits: a.fits && b.fits };
  }
  const minScale = MIN_PT / Math.min(box1.fontPt, box2.fontPt);
  for (let scale = 1; scale >= minScale - 1e-9; scale -= FONT_STEP / box1.fontPt) {
    const [p1, p2] = [box1.fontPt * scale, box2.fontPt * scale];
    const split = splitWords(text, box1.width, box2.width, t => measure(t, p1));
    if (!split.overflow && measure(split.lines[1], p2) <= box2.width) return { lines: split.lines, fonts: [p1, split.lines[1] ? p2 : box2.fontPt], fits: true };
  }
  const split = splitWords(text, box1.width, box2.width, t => measure(t, MIN_PT));
  const a = fitFont(split.lines[0], box1, measure);
  const b = fitFont(split.lines[1], box2, measure);
  return { lines: split.lines, fonts: [a.fontPt, b.fontPt], fits: false };
}

/** The payee always prints on one line; a long name gets a smaller font, down to MIN_PT. */
function payeeItem(box: FieldBox, payee: string, measure: MeasureText, warnings: string[]): TextItem {
  const fit = fitFont(payee, box, measure);
  if (!fit.fits) warnings.push(`The payee name is too long for the payee line even at ${MIN_PT} pt. Shorten it or widen the payee line in the cheque layout.`);
  return text('payee', payee, box, { fontPt: fit.fontPt });
}

function crossingItems(layout: ChequeLayout, crossing: CrossingOption): RenderItem[] {
  if (crossing === 'none') return [];
  // The cheque already carries A/C PAYEE: strike only the "or bearer" words, never print it a second time.
  if (crossing === 'bearer-only') return [text('bearer', layout.bearerStrike.text, layout.bearerStrike)];
  const items: RenderItem[] = layout.crossingLines.map(l => ({ kind: 'line', ...l }));
  if (crossing === 'ac-payee' || crossing === 'ac-payee-bearer') {
    items.push(text('ac-payee', 'A/C PAYEE ONLY', layout.acPayee));
  }
  if (crossing === 'ac-payee-not-negotiable-bearer') {
    items.push(text('ac-payee', 'A/C PAYEE ONLY\nNOT NEGOTIABLE', layout.acPayee));
  }
  if (crossing === 'ac-payee-bearer' || crossing === 'ac-payee-not-negotiable-bearer') {
    items.push(text('bearer', layout.bearerStrike.text, layout.bearerStrike));
  }
  return items;
}

function shift(item: RenderItem, dx: number, dy: number): RenderItem {
  if (item.kind === 'line') return { ...item, x1: item.x1 + dx, x2: item.x2 + dx, y1: item.y1 + dy, y2: item.y2 + dy };
  return { ...item, x: item.x + dx, y: item.y + dy };
}

/** A writing space trimmed to the cheque, e.g. a detected line that runs past the leaf's edge. */
function keepOnCheque(box: FieldBox, layout: ChequeLayout): FieldBox {
  const x1 = Math.max(box.x, CHEQUE_EDGE_MM);
  const x2 = Math.min(box.x + box.width, layout.chequeWidth - CHEQUE_EDGE_MM);
  const y1 = Math.max(box.y, 0);
  const y2 = Math.min(box.y + box.height, layout.chequeHeight);
  if (x2 - x1 < 1 || y2 - y1 < 1) return box;
  return { ...box, x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Lays out every printed element of a cheque. Offsets are applied last, in millimetres. */
export function renderCheque(
  layout: ChequeLayout,
  cheque: ChequeData,
  settings: PrintSettings,
  measure: MeasureText,
): { items: RenderItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const caps = (s: string) => (settings.capitals ? s.toUpperCase() : s);

  // The writing space kept on the cheque, with the chosen text size, never taller than the space (and never below MIN_PT).
  const size = (box: FieldBox): FieldBox => {
    const inside = keepOnCheque(box, layout);
    return { ...inside, fontPt: Math.max(MIN_PT, Math.min(settings.textSize, inside.height / PT_TO_MM)) };
  };
  const items: RenderItem[] = [payeeItem(size(layout.payee), caps(cheque.payee.trim()), measure, warnings)];

  const amount = `${settings.amountPrefix}${formatAmount(cheque.amountFils, { hideZeroFraction: settings.hideZeroFraction })}${settings.amountSuffix}`;
  const amountBox = size(layout.amount);
  const amountFit = fitFont(amount, amountBox, measure);
  if (!amountFit.fits) warnings.push(`The amount is too long for the amount box even at ${MIN_PT} pt. Widen the amount box in the cheque layout.`);
  items.push(text('amount', amount, amountBox, { fontPt: amountFit.fontPt }));

  const words = amountInWords(cheque.amountFils, {
    style: settings.wordsStyle,
    prefix: settings.wordsPrefix,
    suffix: settings.wordsSuffix,
    minorUnit: settings.minorUnit,
    fractionFormat: settings.fractionFormat,
    capitals: settings.capitals,
    hyphenate: settings.hyphenate,
  });
  const [words1, words2] = [size(layout.words1), size(layout.words2)];
  const two = fitTwoLines(words, words1, words2, measure, cheque.wordsBreakAt);
  if (!two.fits) warnings.push('Amount in words does not fit on its two lines even at a small font. Widen the lines in the template or shorten the prefix/suffix.');
  items.push(text('words', two.lines[0], words1, { fontPt: two.fonts[0] }));
  if (two.lines[1]) items.push(text('words', two.lines[1], words2, { fontPt: two.fonts[1] }));

  if (layout.date.mode === 'digits') {
    const boxes = layout.date.boxes;
    dateDigits(cheque.date).forEach((digit, i) => items.push(text('date', digit, boxes[i])));
  } else {
    const written = formatDate(cheque.date, settings.dateFormat);
    const dateBox = size(layout.date.box);
    const dateFit = fitFont(written, dateBox, measure);
    if (!dateFit.fits) warnings.push(`The date is too long for the date line even at ${MIN_PT} pt. Choose a shorter date format or widen the date line.`);
    items.push(text('date', written, dateBox, { fontPt: dateFit.fontPt }));
  }

  items.push(...crossingItems(layout, cheque.crossing));

  return { items: items.map(i => shift(i, settings.offsetX, settings.offsetY)), warnings };
}
