import { describe, expect, test } from 'vitest';
import { applyBank, bankBySize, BANKS, crossingFor, matchBank } from '../src/shared/banks';
import { blankLayout, scaleLayout } from '../src/shared/layoutDefaults';
import { editableFields } from '../src/shared/layoutFields';

describe('bank library', () => {
  test('has FAB and RAKBANK, every writing space inside the cheque', () => {
    expect(BANKS.map(b => b.id)).toEqual(['fab', 'rakbank']);
    for (const bank of BANKS) {
      const L = bank.layout;
      for (const f of editableFields(L)) {
        expect(f.box.x, `${bank.id} ${f.key}`).toBeGreaterThanOrEqual(0);
        expect(f.box.x + f.box.width, `${bank.id} ${f.key}`).toBeLessThanOrEqual(L.chequeWidth);
        expect(f.box.y + f.box.height, `${bank.id} ${f.key}`).toBeLessThanOrEqual(L.chequeHeight);
      }
      // the second words line and the amount never overlap
      expect(L.words2.x + L.words2.width).toBeLessThanOrEqual(L.amount.x);
    }
  });

  test('recognises a detected FAB or RAKBANK cheque from its size and writing spaces', () => {
    for (const bank of BANKS) {
      // a detection a little off: 0.5% bigger and fields nudged
      const detected = scaleLayout(bank.layout, 1.005);
      const nudged = { ...detected, payee: { ...detected.payee, x: detected.payee.x + 3, y: detected.payee.y + 1 } };
      expect(matchBank(nudged)?.id).toBe(bank.id);
    }
  });

  test('compares only the writing spaces detection really found (a soft photo may find just two)', () => {
    const fab = BANKS[0].layout;
    const guessedWrong = { ...fab, words1: { ...fab.words1, y: 50 }, amount: { ...fab.amount, y: 20 } };
    expect(matchBank(guessedWrong)).toBeNull();
    expect(matchBank(guessedWrong, ['payee', 'date'])?.id).toBe('fab');
    // two lines are enough only when the size agrees closely too
    expect(matchBank({ ...guessedWrong, chequeWidth: fab.chequeWidth + 2 }, ['payee', 'date'])).toBeNull();
    expect(matchBank(fab, ['payee'])).toBeNull();
  });

  test('does not claim a cheque of another size, or the same size with different writing spaces', () => {
    expect(matchBank(blankLayout(175, 80))).toBeNull();
    expect(matchBank(blankLayout(157.65, 79.93))).toBeNull();
  });

  test('RAKBANK cheques already say A/C PAYEE, so only "or bearer" is struck; FAB gets the corner crossing', () => {
    expect(BANKS.find(b => b.id === 'rakbank')!.layout.defaultCrossing).toBe('bearer-only');
    expect(BANKS.find(b => b.id === 'fab')!.layout.defaultCrossing).toBe('ac-payee-bearer');
  });

  test('applying a bank keeps the measured size and scales the bank layout to it', () => {
    const bank = BANKS[1];
    const detected = scaleLayout(bank.layout, 1.01);
    const applied = applyBank(bank, detected);
    expect(applied.chequeWidth).toBeCloseTo(detected.chequeWidth, 5);
    expect(applied.words1.x + applied.words1.width).toBeCloseTo((bank.layout.words1.x + bank.layout.words1.width) * 1.01, 1);
  });

  test('a RAKBANK design whose fields were moved by hand is still known by its size', () => {
    const rak = BANKS.find(b => b.id === 'rakbank')!;
    const moved = { ...rak.layout, defaultCrossing: undefined, payee: { ...rak.layout.payee, y: rak.layout.payee.y - 10 }, words1: { ...rak.layout.words1, y: 30 } };
    expect(matchBank(moved)?.id).not.toBe('rakbank');
    expect(bankBySize(moved)?.id).toBe('rakbank');
  });

  test('a cheque of no library size is no bank', () => {
    expect(bankBySize(blankLayout(175, 70))).toBeNull();
  });

  test('crossing: own choice first, then the bank (A/C PAYEE once on RAKBANK), else A/C Payee + strike', () => {
    const rak = BANKS.find(b => b.id === 'rakbank')!;
    expect(crossingFor({ ...rak.layout, defaultCrossing: undefined })).toBe('bearer-only');
    expect(crossingFor({ ...rak.layout, defaultCrossing: 'ac-payee' })).toBe('ac-payee');
    expect(crossingFor(blankLayout(175, 70))).toBe('ac-payee-bearer');
  });
});
