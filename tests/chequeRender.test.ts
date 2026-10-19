import { describe, expect, test } from 'vitest';
import { dateDigits, formatDate, renderCheque, splitWords } from '../src/shared/chequeRender';
import { blankLayout, scaleLayout } from '../src/shared/layoutDefaults';
import { digitDateLayout, lineDateLayout } from './fixtures';
import { DEFAULT_SETTINGS, type ChequeData, type RenderItem, type TextItem } from '../src/shared/types';

// 2 mm per character at 12pt: predictable fake text measurement.
const measure = (text: string, fontPt: number) => text.length * 2 * (fontPt / 12);

const cheque: ChequeData = {
  date: '2026-10-19',
  payee: 'Acme Gulf Contracting LLC',
  amountFils: 125050,
  crossing: 'ac-payee-bearer',
};

const texts = (items: RenderItem[]) => items.filter((i): i is TextItem => i.kind === 'text');
const byRole = (items: RenderItem[], role: string) => texts(items).filter(i => i.role === role);

describe('layouts', () => {
  test('blankLayout fits inside the cheque', () => {
    const l = blankLayout(158, 80);
    for (const b of [l.payee, l.words1, l.words2, l.amount, l.bearerStrike]) {
      expect(b.x + b.width).toBeLessThanOrEqual(158);
      expect(b.y + b.height).toBeLessThanOrEqual(80);
    }
  });

  test('scaleLayout scales positions but not fonts', () => {
    const l = scaleLayout(lineDateLayout(), 0.5);
    expect(l.chequeWidth).toBe(79);
    expect(l.payee.x).toBeCloseTo(12.66);
    expect(l.payee.fontPt).toBe(12);
    expect(l.payee2?.width).toBe(50);
    expect(l.date.mode === 'line' && l.date.box.x).toBe(61);
    const d = scaleLayout(digitDateLayout(), 2);
    expect(d.date.mode === 'digits' && d.date.boxes[0].x).toBeCloseTo(266.24);
  });
});

describe('formatDate', () => {
  test('supports the date formats', () => {
    expect(formatDate('2026-10-09', 'DD/MM/YYYY')).toBe('09/10/2026');
    expect(formatDate('2026-10-09', 'DD-MM-YYYY')).toBe('09-10-2026');
    expect(formatDate('2026-10-09', 'DD.MM.YYYY')).toBe('09.10.2026');
    expect(formatDate('2026-10-09', 'DD MMM YYYY')).toBe('09 Oct 2026');
    expect(formatDate('2026-10-09', 'DD/MM/YY')).toBe('09/10/26');
  });
});

describe('dateDigits', () => {
  test('turns an ISO date into DDMMYYYY digits', () => {
    expect(dateDigits('2026-10-19')).toEqual(['1', '9', '1', '0', '2', '0', '2', '6']);
  });

  test('rejects invalid dates', () => {
    expect(() => dateDigits('19/10/2026')).toThrow();
    expect(() => dateDigits('2026-13-01')).toThrow();
  });
});

describe('splitWords', () => {
  test('keeps short text on line one', () => {
    expect(splitWords('One Two', 100, 100, t => t.length)).toEqual({ lines: ['One Two', ''], overflow: false });
  });

  test('moves remaining words to line two', () => {
    expect(splitWords('aaa bbb ccc', 7, 20, t => t.length)).toEqual({ lines: ['aaa bbb', 'ccc'], overflow: false });
  });

  test('flags overflow when two lines are not enough', () => {
    expect(splitWords('aaa bbb ccc', 3, 3, t => t.length).overflow).toBe(true);
  });
});

describe('renderCheque', () => {
  const layout = digitDateLayout();

  test('places payee, amount and date digits at layout positions', () => {
    const { items } = renderCheque(layout, cheque, DEFAULT_SETTINGS, measure);
    const [payee] = byRole(items, 'payee');
    expect(payee.text).toBe('Acme Gulf Contracting LLC');
    expect(payee.x).toBeCloseTo(layout.payee.x);
    expect(byRole(items, 'amount')[0].text).toBe('1,250.50');
    expect(byRole(items, 'date').map(i => i.text).join('')).toBe('19102026');
  });

  test('applies printer offsets to every item', () => {
    const shifted = renderCheque(layout, cheque, { ...DEFAULT_SETTINGS, offsetX: 2, offsetY: -1.5 }, measure);
    const [payee] = byRole(shifted.items, 'payee');
    expect(payee.x).toBeCloseTo(layout.payee.x + 2);
    expect(payee.y).toBeCloseTo(layout.payee.y - 1.5);
    const line = shifted.items.find(i => i.kind === 'line');
    expect(line && line.kind === 'line' && line.x1).toBeCloseTo(layout.crossingLines[0].x1 + 2);
  });

  test('splits amount in words across two lines when needed', () => {
    const { items } = renderCheque(layout, cheque, DEFAULT_SETTINGS, measure);
    const words = byRole(items, 'words');
    expect(words.length).toBe(2);
    expect(`${words[0].text} ${words[1].text}`).toBe(
      'Dirhams One Thousand Two Hundred and Fifty and Fils Fifty Only',
    );
  });

  test('draws crossing, A/C payee text and bearer strike for the default option', () => {
    const { items } = renderCheque(layout, cheque, DEFAULT_SETTINGS, measure);
    expect(items.filter(i => i.kind === 'line')).toHaveLength(2);
    expect(byRole(items, 'ac-payee')[0].text).toBe('A/C PAYEE ONLY');
    expect(byRole(items, 'bearer')[0].text).toMatch(/^X+$/);
  });

  test('adds NOT NEGOTIABLE for that crossing option', () => {
    const { items } = renderCheque(layout, { ...cheque, crossing: 'ac-payee-not-negotiable-bearer' }, DEFAULT_SETTINGS, measure);
    expect(byRole(items, 'ac-payee')[0].text).toBe('A/C PAYEE ONLY\nNOT NEGOTIABLE');
  });

  test('cross only draws lines without text', () => {
    const { items } = renderCheque(layout, { ...cheque, crossing: 'cross-only' }, DEFAULT_SETTINGS, measure);
    expect(items.filter(i => i.kind === 'line')).toHaveLength(2);
    expect(byRole(items, 'ac-payee')).toHaveLength(0);
    expect(byRole(items, 'bearer')).toHaveLength(0);
  });

  test('no crossing draws nothing extra', () => {
    const { items } = renderCheque(layout, { ...cheque, crossing: 'none' }, DEFAULT_SETTINGS, measure);
    expect(items.filter(i => i.kind === 'line')).toHaveLength(0);
    expect(byRole(items, 'ac-payee')).toHaveLength(0);
  });

  test('keeps a long payee on one line with a smaller font', () => {
    const longPayee = { ...cheque, payee: 'X'.repeat(100) };
    const { items, warnings } = renderCheque(layout, longPayee, DEFAULT_SETTINGS, measure);
    const payees = byRole(items, 'payee');
    expect(payees).toHaveLength(1);
    expect(payees[0].fontPt).toBeLessThan(12);
    expect(payees[0].fontPt).toBeGreaterThanOrEqual(8);
    expect(measure(payees[0].text, payees[0].fontPt)).toBeLessThanOrEqual(layout.payee.width + 0.01);
    expect(warnings).toEqual([]);
  });

  test('never shrinks the payee below 8 pt and warns instead', () => {
    const veryLong = { ...cheque, payee: 'X'.repeat(200) };
    const { items, warnings } = renderCheque(lineDateLayout(), veryLong, DEFAULT_SETTINGS, measure);
    const payees = byRole(items, 'payee');
    expect(payees).toHaveLength(1);
    expect(payees[0].fontPt).toBe(8);
    expect(warnings.join(' ')).toMatch(/payee name is too long/);
  });

  test('uses the text size setting for payee, amount, words and a written date', () => {
    const { items } = renderCheque(lineDateLayout(), cheque, { ...DEFAULT_SETTINGS, textSize: 10 }, measure);
    for (const role of ['payee', 'amount', 'words', 'date'] as const) {
      for (const item of byRole(items, role)) expect(item.fontPt).toBe(10);
    }
  });

  test('shrinks the amount to fit its box', () => {
    const tightBox = { ...layout, amount: { ...layout.amount, width: 10 } };
    const [amount] = byRole(renderCheque(tightBox, cheque, DEFAULT_SETTINGS, measure).items, 'amount');
    expect(amount.fontPt).toBeLessThan(12);
  });

  test('warns when the amount in words does not fit', () => {
    const huge = { ...cheque, amountFils: 99_999_999_999 };
    const tinyMeasure = (t: string) => t.length * 10;
    const { warnings } = renderCheque(layout, huge, DEFAULT_SETTINGS, tinyMeasure);
    expect(warnings.join(' ')).toMatch(/Amount in words/);
  });

  test('writes the date on a line in the chosen format', () => {
    const { items } = renderCheque(lineDateLayout(), cheque, { ...DEFAULT_SETTINGS, dateFormat: 'DD MMM YYYY' }, measure);
    expect(byRole(items, 'date').map(i => i.text)).toEqual(['19 Oct 2026']);
  });

  test('starts line 2 from the chosen word', () => {
    const { items } = renderCheque(layout, { ...cheque, wordsBreakAt: 3 }, DEFAULT_SETTINGS, measure);
    expect(byRole(items, 'words').map(i => i.text)).toEqual(['Dirhams One Thousand', 'Two Hundred and Fifty and Fils Fifty Only']);
  });

  test('ignores a break outside the words and wraps automatically', () => {
    const auto = renderCheque(layout, cheque, DEFAULT_SETTINGS, measure).items;
    expect(byRole(renderCheque(layout, { ...cheque, wordsBreakAt: 0 }, DEFAULT_SETTINGS, measure).items, 'words')).toEqual(byRole(auto, 'words'));
    expect(byRole(renderCheque(layout, { ...cheque, wordsBreakAt: 99 }, DEFAULT_SETTINGS, measure).items, 'words')).toEqual(byRole(auto, 'words'));
  });

  test('never lets a words line run past its printed line', () => {
    const narrow = { ...layout, words1: { ...layout.words1, width: 60 }, words2: { ...layout.words2, width: 70 } };
    const { items, warnings } = renderCheque(narrow, cheque, DEFAULT_SETTINGS, measure);
    const words = byRole(items, 'words');
    expect(words).toHaveLength(2);
    expect(measure(words[0].text, words[0].fontPt)).toBeLessThanOrEqual(60.01);
    expect(measure(words[1].text, words[1].fontPt)).toBeLessThanOrEqual(70.01);
    expect(words[0].fontPt).toBeLessThan(12);
    expect(warnings).toEqual([]);
  });

  test('shrinks a manually broken line that is too long for its line', () => {
    const { items } = renderCheque(layout, { ...cheque, wordsBreakAt: 10 }, DEFAULT_SETTINGS, measure);
    const [first] = byRole(items, 'words');
    expect(first.fontPt).toBeLessThan(12);
    expect(measure(first.text, first.fontPt)).toBeLessThanOrEqual(layout.words1.width + 0.01);
  });

  test('ignores an old second payee line in saved layouts', () => {
    const longPayee = { ...cheque, payee: 'Acme Gulf Contracting And General Maintenance Company LLC Dubai Main Branch' };
    expect(byRole(renderCheque(lineDateLayout(), longPayee, DEFAULT_SETTINGS, measure).items, 'payee')).toHaveLength(1);
  });

  test('uses capitals when enabled', () => {
    const { items } = renderCheque(layout, cheque, { ...DEFAULT_SETTINGS, capitals: true }, measure);
    expect(byRole(items, 'payee')[0].text).toBe('ACME GULF CONTRACTING LLC');
  });

  test('wraps the amount with prefix and suffix', () => {
    const { items } = renderCheque(layout, cheque, { ...DEFAULT_SETTINGS, amountPrefix: '**', amountSuffix: '/-' }, measure);
    expect(byRole(items, 'amount')[0].text).toBe('**1,250.50/-');
  });
});
