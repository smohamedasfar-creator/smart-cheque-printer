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
      defaultCrossing: 'ac-payee-bearer',
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
      // RAKBANK prints A/C PAYEE ONLY in the middle of the cheque.
      defaultCrossing: 'bearer-only',
    },
  },
];

/** A detected size may differ from the bank's by this much (mm) and still be that bank. */
const SIZE_TOLERANCE_MM = 2.5;
/** A detected line must run this close (mm) to one of the bank's printed lines. */
const LINE_TOLERANCE_MM = 1.5;

/** With only two lines found, the size must agree this closely (mm) as well. */
const TIGHT_SIZE_MM = 1.5;

type Line = 'payee' | 'words1' | 'words2' | 'amount' | 'date';
const LINES: Line[] = ['payee', 'words1', 'words2', 'amount', 'date'];
const dateBox = (L: ChequeLayout) => (L.date.mode === 'line' ? L.date.box : L.date.boxes[0]);
/** Where a writing space's printed line runs (its bottom edge): detection finds these lines reliably. */
const lineOf = (L: ChequeLayout, line: Line) => {
  const b = line === 'date' ? dateBox(L) : L[line];
  return b.y + b.height;
};

/**
 * The bank whose cheque this detected layout is, or null when it matches none. `found` lists the writing spaces
 * detection really found (the others are guesses and are not compared); without it every space is compared.
 * Lines are compared by height only, whatever role detection gave them, because on a faint photo detection may
 * miss one line and label the rest one row off; the bank's own writing spaces then put every role right.
 */
export function matchBank(detected: ChequeLayout, found?: readonly string[]): BankTemplate | null {
  const compared = found ? LINES.filter(l => found.includes(l)) : LINES;
  if (compared.length < 2) return null;
  for (const bank of BANKS) {
    const L = bank.layout;
    const dw = Math.abs(detected.chequeWidth - L.chequeWidth);
    const dh = Math.abs(detected.chequeHeight - L.chequeHeight);
    if (dw > SIZE_TOLERANCE_MM || dh > SIZE_TOLERANCE_MM) continue;
    if (compared.length < 3 && (dw > TIGHT_SIZE_MM || dh > TIGHT_SIZE_MM)) continue;
    const bankLines = LINES.map(l => lineOf(L, l));
    const matched = compared.filter(l => bankLines.some(y => Math.abs(lineOf(detected, l) - y) <= LINE_TOLERANCE_MM)).length;
    const needed = compared.length >= 3 ? Math.max(3, compared.length - 1) : compared.length;
    if (matched >= needed) return bank;
  }
  return null;
}

/** The bank's writing spaces, scaled to the size measured on this upload. */
export function applyBank(bank: BankTemplate, detected: ChequeLayout): ChequeLayout {
  const scaled = scaleLayout(bank.layout, detected.chequeWidth / bank.layout.chequeWidth);
  return { ...scaled, chequeHeight: detected.chequeHeight };
}
