// Every kind of writing space: narrow and wide lines, short and tall boxes, every text size, long payees,
// big amounts and every date format. Text must stay inside its space, or the user must be warned.
import { describe, expect, test } from 'vitest';
import { CHEQUE_EDGE_MM, formatDate, MIN_PT, PT_TO_MM, renderCheque, TEXT_SIZES } from '../src/shared/chequeRender';
import { amountInWords } from '../src/shared/amountInWords';
import { blankLayout } from '../src/shared/layoutDefaults';
import { DEFAULT_SETTINGS, type ChequeLayout, type DateFormat, type FieldBox, type PrintSettings, type TextItem } from '../src/shared/types';

/** Roughly Arial: an average character is 0.55 em wide. */
const measure = (t: string, pt: number) => t.length * 0.55 * pt * PT_TO_MM;

const PAYEES = ['Al', 'Sample Payee Trading LLC', 'International General Trading and Contracting Company LLC Branch'];
/** In fils: 0.01, 100.00, 123,456.78, 99,999,999.99 and 9,999,999,999.99 */
const AMOUNTS = [1, 10_000, 12_345_678, 9_999_999_999, 999_999_999_999];
const FORMATS: DateFormat[] = ['DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD MMM YYYY', 'DD/MM/YY'];
const HEIGHTS = [2.5, 4, 6, 7.8, 12];
const WIDTHS = [16, 23.5, 47.5, 90.6, 161];
const WORDS_LINES: Array<[number, number]> = [[178.8, 137], [132.6, 101.8], [97, 119], [60, 60], [30, 20]];

const box = (b: FieldBox, width: number, height: number): FieldBox => ({ ...b, width, height });

function variant(width: number, height: number, words: [number, number]): ChequeLayout {
  const l = blankLayout(205.74, 87.21);
  return {
    ...l,
    payee: box(l.payee, width, height),
    amount: box(l.amount, width, height),
    words1: box(l.words1, words[0], height),
    words2: box(l.words2, words[1], height),
    date: { mode: 'line', box: box(l.date.mode === 'line' ? l.date.box : l.payee, width, height) },
  };
}

const texts = (items: ReturnType<typeof renderCheque>['items'], role: TextItem['role']) =>
  items.filter((i): i is TextItem => i.kind === 'text' && i.role === role);

function check(layout: ChequeLayout, settings: PrintSettings, payee: string, fils: number, problems: string[], label: string) {
  const { items, warnings } = renderCheque(layout, { date: '2026-12-31', payee, amountFils: fils, crossing: 'ac-payee-bearer' }, settings, measure);
  const fitted = [...texts(items, 'payee'), ...texts(items, 'amount'), ...texts(items, 'words'), ...texts(items, 'date')];
  for (const t of fitted) {
    if (t.fontPt < MIN_PT - 1e-9) problems.push(`${label}: ${t.role} at ${t.fontPt.toFixed(2)} pt is below ${MIN_PT} pt`);
    const tall = t.fontPt * PT_TO_MM > t.height + 0.01;
    if (tall && t.fontPt > MIN_PT + 1e-9) problems.push(`${label}: ${t.role} at ${t.fontPt.toFixed(1)} pt is taller than its ${t.height} mm space`);
    const wide = measure(t.text, t.fontPt) > t.width + 0.02;
    if (wide && !warnings.length) problems.push(`${label}: ${t.role} "${t.text.slice(0, 20)}…" runs past its line with no warning`);
  }
  // No word of the amount may get lost between the two lines.
  const words = amountInWords(fils, { style: settings.wordsStyle, prefix: settings.wordsPrefix, suffix: settings.wordsSuffix, minorUnit: settings.minorUnit, fractionFormat: settings.fractionFormat, hyphenate: settings.hyphenate, capitals: settings.capitals });
  const printed = texts(items, 'words').map(t => t.text).join(' ');
  if (printed !== words) problems.push(`${label}: amount in words printed as "${printed}" instead of "${words}"`);
  if (!texts(items, 'words')[0]?.text) problems.push(`${label}: line 1 of the amount in words is empty`);
}

describe('writing spaces', () => {
  test('a point is 0.3528 mm', () => {
    expect(PT_TO_MM).toBeCloseTo(25.4 / 72, 6);
    expect(measure('abcd', 12)).toBeGreaterThan(0);
  });

  test('payee, amount, words and date stay inside every writing space at every text size', () => {
    const problems: string[] = [];
    for (const width of WIDTHS) {
      for (const height of HEIGHTS) {
        for (const textSize of TEXT_SIZES) {
          const settings = { ...DEFAULT_SETTINGS, textSize };
          const layout = variant(width, height, WORDS_LINES[WIDTHS.indexOf(width)]);
          for (const payee of PAYEES) for (const fils of AMOUNTS) check(layout, settings, payee, fils, problems, `w${width} h${height} ${textSize}pt ${fils}`);
        }
      }
    }
    expect(problems.slice(0, 8)).toEqual([]);
  });

  test('every date format fits a narrow date line, shrinking but never below 8 pt', () => {
    const problems: string[] = [];
    for (const dateFormat of FORMATS) {
      for (const width of [16, 18, 23.5]) {
        for (const textSize of TEXT_SIZES) {
          const layout = variant(width, 7.8, WORDS_LINES[0]);
          check(layout, { ...DEFAULT_SETTINGS, textSize, dateFormat }, 'Sample Payee', 12_345_678, problems, `${dateFormat} w${width} ${textSize}pt`);
          const date = texts(renderCheque(layout, { date: '2026-12-31', payee: 'P', amountFils: 100, crossing: 'none' }, { ...DEFAULT_SETTINGS, textSize, dateFormat }, measure).items, 'date')[0];
          expect(date.text).toBe(formatDate('2026-12-31', dateFormat));
        }
      }
    }
    expect(problems.slice(0, 8)).toEqual([]);
  });

  test('word options (capitals, US style, hyphens, numeric fils, no prefix) keep every word', () => {
    const problems: string[] = [];
    const options: Array<Partial<PrintSettings>> = [
      { capitals: true }, { wordsStyle: 'us' }, { hyphenate: true }, { fractionFormat: 'numeric' }, { wordsPrefix: '', wordsSuffix: '' },
      { wordsPrefix: 'Dirhams', wordsSuffix: 'Only', minorUnit: 'Fils', hideZeroFraction: true },
    ];
    for (const extra of options) {
      for (const words of WORDS_LINES) {
        const layout = variant(90.6, 6, words);
        for (const fils of AMOUNTS) check(layout, { ...DEFAULT_SETTINGS, ...extra }, 'Sample Payee', fils, problems, `${JSON.stringify(extra)} ${words}`);
      }
    }
    expect(problems.slice(0, 8)).toEqual([]);
  });

  test('a manual line-2 start keeps every word for every possible break', () => {
    const layout = variant(90.6, 6, [132.6, 101.8]);
    const fils = 12_345_678;
    const all = amountInWords(fils, { style: 'uk', prefix: 'Dirhams', suffix: 'Only', minorUnit: 'Fils', fractionFormat: 'words' });
    const n = all.split(' ').length;
    for (let breakAt = 0; breakAt <= n + 1; breakAt++) {
      const { items } = renderCheque(layout, { date: '2026-12-31', payee: 'P', amountFils: fils, crossing: 'none', wordsBreakAt: breakAt }, DEFAULT_SETTINGS, measure);
      expect(texts(items, 'words').map(t => t.text).join(' ')).toBe(all);
    }
  });

  test('a big amount that cannot fit its box is reported, not printed over the box edge silently', () => {
    const layout = variant(16, 6, WORDS_LINES[0]);
    const { warnings } = renderCheque(layout, { date: '2026-12-31', payee: 'P', amountFils: 999_999_999_999, crossing: 'none' }, DEFAULT_SETTINGS, measure);
    expect(warnings.join(' ')).toMatch(/amount/i);
  });
  test('a writing space drawn past the cheque edge is kept on the cheque', () => {
    const l = blankLayout(157.65, 79.93);
    // e.g. a detected amount-in-words line that runs 6 mm past the right edge of the leaf
    const layout = { ...l, words1: { ...l.words1, x: 31.3, width: 132.6 }, amount: { ...l.amount, x: 124.4, width: 40 } };
    const { items } = renderCheque(layout, { date: '2026-12-31', payee: 'P', amountFils: 987_654_321, crossing: 'none' }, DEFAULT_SETTINGS, measure);
    for (const t of [...texts(items, 'words'), ...texts(items, 'amount')]) {
      expect(t.x + t.width).toBeLessThanOrEqual(157.65 - CHEQUE_EDGE_MM + 1e-9);
      expect(measure(t.text, t.fontPt)).toBeLessThanOrEqual(t.width + 0.02);
    }
  });
});
