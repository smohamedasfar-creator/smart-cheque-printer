import { defaultCrossing } from '../src/shared/layoutDefaults';
import type { ChequeLayout, FieldBox } from '../src/shared/types';

const digits = (xs: number[], y: number): FieldBox[] => xs.map(x => ({ x, y, width: 4, height: 6, fontPt: 12, align: 'center' }));

/** A cheque layout with eight date boxes. */
export function digitDateLayout(): ChequeLayout {
  const crossing = defaultCrossing();
  return {
    chequeWidth: 204,
    chequeHeight: 94,
    payee: { x: 25.32, y: 33.23, width: 141, height: 6, fontPt: 12 },
    payee2: null,
    amount: { x: 140.8, y: 51.38, width: 41, height: 7, fontPt: 12 },
    words1: { x: 18.61, y: 43.46, width: 97, height: 6, fontPt: 12 },
    words2: { x: 5.74, y: 53.41, width: 119, height: 6, fontPt: 12 },
    date: { mode: 'digits', boxes: digits([133.12, 136.72, 143.91, 147.51, 154.71, 158.31, 161.91, 165.5], 19.05) },
    acPayee: crossing.acPayee,
    bearerStrike: { x: 4.88, y: 38.68, width: 15, height: 5, fontPt: 12, text: 'XXXXX' },
    crossingLines: crossing.lines,
  };
}

/** A cheque layout with a written date line and a second payee line. */
export function lineDateLayout(): ChequeLayout {
  return {
    ...digitDateLayout(),
    chequeWidth: 158,
    chequeHeight: 80,
    payee2: { x: 20, y: 30, width: 100, height: 6, fontPt: 12 },
    date: { mode: 'line', box: { x: 122, y: 16, width: 23, height: 6, fontPt: 12 } },
  };
}
