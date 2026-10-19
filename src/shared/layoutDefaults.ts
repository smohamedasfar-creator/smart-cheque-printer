import type { ChequeLayout, FieldBox, LineSegment } from './types';

/** Standard crossing in the top-left corner: two parallel diagonal lines with the text between them. */
export function defaultCrossing(): { acPayee: FieldBox; lines: LineSegment[] } {
  return {
    acPayee: { x: 3.7, y: 1.3, width: 34, height: 26, fontPt: 8.3, rotation: 35 },
    lines: [
      { x1: -0.5, y1: 18.9, x2: 27.5, y2: -1.1 },
      { x1: -0.3, y1: 26.1, x2: 38.7, y2: -1.9 },
    ],
  };
}

const scaleBox = <T extends FieldBox>(b: T, f: number): T => ({ ...b, x: b.x * f, y: b.y * f, width: b.width * f, height: b.height * f });

/** Scales every position and size, e.g. after the user corrects the cheque width. Font sizes stay the same. */
export function scaleLayout(layout: ChequeLayout, factor: number): ChequeLayout {
  return {
    ...layout,
    chequeWidth: layout.chequeWidth * factor,
    chequeHeight: layout.chequeHeight * factor,
    payee: scaleBox(layout.payee, factor),
    payee2: layout.payee2 && scaleBox(layout.payee2, factor),
    amount: scaleBox(layout.amount, factor),
    words1: scaleBox(layout.words1, factor),
    words2: scaleBox(layout.words2, factor),
    date: layout.date.mode === 'line' ? { mode: 'line', box: scaleBox(layout.date.box, factor) } : { mode: 'digits', boxes: layout.date.boxes.map(b => scaleBox(b, factor)) },
    bearerStrike: scaleBox(layout.bearerStrike, factor),
  };
}

/** A starting layout for a cheque size when there is no scan to detect from. */
export function blankLayout(widthMm: number, heightMm: number): ChequeLayout {
  const w = widthMm;
  const h = heightMm;
  const crossing = defaultCrossing();
  const field = (x: number, y: number, width: number): FieldBox => ({ x: w * x, y: h * y, width: w * width, height: 5.5, fontPt: 12 });
  return {
    chequeWidth: w,
    chequeHeight: h,
    date: { mode: 'line', box: field(0.72, 0.17, 0.2) },
    payee: field(0.18, 0.3, 0.7),
    payee2: null,
    words1: field(0.12, 0.42, 0.6),
    words2: field(0.03, 0.52, 0.6),
    amount: field(0.72, 0.47, 0.22),
    bearerStrike: { ...field(0.82, 0.3, 0.12), text: 'XXXXXX' },
    acPayee: crossing.acPayee,
    crossingLines: crossing.lines,
  };
}
