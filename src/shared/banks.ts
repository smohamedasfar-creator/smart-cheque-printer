// Bank library: known cheque designs, so an uploaded cheque of a known bank gets that bank's writing spaces.
// Positions are millimetres from the cheque's top-left corner, measured on real blank leaves. No account,
// name or picture is stored: only where each bank's cheque has room to write.
import { defaultCrossing, scaleLayout } from './layoutDefaults';
import type { ChequeLayout, FieldBox } from './types';

export interface BankTemplate {
  id: string;
  name: string;
  layout: ChequeLayout;
}

const box = (x: number, y: number, width: number, height: number): FieldBox => ({ x, y, width, height, fontPt: 12 });
const crossing = defaultCrossing();

export const BANKS: BankTemplate[] = [
  {
    id: 'fab',
    name: 'First Abu Dhabi Bank (FAB)',
    layout: {
      chequeWidth: 157.65,
      chequeHeight: 79.93,
      date: { mode: 'line', box: box(122, 15.6, 23, 6) },
      payee: box(34, 23.3, 89, 6),
      payee2: null,
      words1: box(31.3, 33.6, 115.7, 6),
      words2: box(10.5, 41.7, 95.5, 6),
      amount: box(118, 40.7, 34, 7),
      bearerStrike: { ...box(3.2, 30.15, 14, 2.9), text: 'XXXXXX' },
      acPayee: crossing.acPayee,
      crossingLines: crossing.lines,
    },
  },
  {
    id: 'rakbank',
    name: 'RAKBANK',
    layout: {
      chequeWidth: 205.74,
      chequeHeight: 87.21,
      date: { mode: 'line', box: box(156, 18.6, 32, 7.8) },
      payee: box(43, 34.9, 117, 6),
      payee2: null,
      words1: box(21.8, 47.8, 115.2, 6),
      words2: box(6.6, 57.4, 137, 6),
      amount: box(158, 55, 38, 7),
      bearerStrike: { ...box(6.6, 39.4, 22, 6), text: 'XXXXXXXX' },
      acPayee: crossing.acPayee,
      crossingLines: crossing.lines,
    },
  },
];

/** A detected size may differ from the bank's by this much (mm) and still be that bank. */
const SIZE_TOLERANCE_MM = 2.5;
/** Each writing line must sit this close (mm) to the same line on the bank's cheque. */
const LINE_TOLERANCE_MM = 2.5;

const dateBox = (L: ChequeLayout) => (L.date.mode === 'line' ? L.date.box : L.date.boxes[0]);
/** How high each writing space sits: detection finds these reliably, unlike where a line starts. */
const heights = (L: ChequeLayout) => [L.payee.y, L.words1.y, L.words2.y, L.amount.y, dateBox(L).y];

/** The bank whose cheque this detected layout is, or null when it matches none. */
export function matchBank(detected: ChequeLayout): BankTemplate | null {
  for (const bank of BANKS) {
    const L = bank.layout;
    if (Math.abs(detected.chequeWidth - L.chequeWidth) > SIZE_TOLERANCE_MM || Math.abs(detected.chequeHeight - L.chequeHeight) > SIZE_TOLERANCE_MM) continue;
    const mine = heights(detected);
    if (heights(L).every((y, i) => Math.abs(mine[i] - y) <= LINE_TOLERANCE_MM)) return bank;
  }
  return null;
}

/** The bank's writing spaces, scaled to the size measured on this upload. */
export function applyBank(bank: BankTemplate, detected: ChequeLayout): ChequeLayout {
  const scaled = scaleLayout(bank.layout, detected.chequeWidth / bank.layout.chequeWidth);
  return { ...scaled, chequeHeight: detected.chequeHeight };
}
