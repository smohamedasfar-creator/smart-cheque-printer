import type { FractionFormat, WordsStyle } from './types';

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES: Array<[number, string]> = [
  [1_000_000_000, 'Billion'],
  [1_000_000, 'Million'],
  [1_000, 'Thousand'],
];
const FILS_PER_UNIT = 100;

function belowHundred(n: number, hyphen: boolean): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens}${hyphen ? '-' : ' '}${ONES[n % 10]}` : tens;
}

function belowThousand(n: number, style: WordsStyle, hyphen: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return belowHundred(rest, hyphen);
  const head = `${ONES[hundreds]} Hundred`;
  if (!rest) return head;
  return style === 'uk' ? `${head} and ${belowHundred(rest, hyphen)}` : `${head} ${belowHundred(rest, hyphen)}`;
}

/** Writes a whole number in words. `hyphen` joins compound tens: "Twenty-Three" instead of "Twenty Three". */
export function integerToWords(n: number, style: WordsStyle, hyphen = false): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Cannot write ${n} in words`);
  if (n === 0) return ONES[0];

  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${integerToWords(Math.floor(rest / size), style, hyphen)} ${name}`);
      rest %= size;
    }
  }
  if (rest) {
    // UK style joins a trailing value below 100 with "and" (Two Thousand and Five).
    const needsAnd = style === 'uk' && parts.length > 0 && rest < 100;
    parts.push(needsAnd ? `and ${belowThousand(rest, style, hyphen)}` : belowThousand(rest, style, hyphen));
  }
  return parts.join(' ');
}

const AMOUNT_PATTERN = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

/** Parses user input such as "1,250.50" into integer fils, or null when invalid. */
export function parseAmountToFils(input: string): number | null {
  const trimmed = input.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.replace(/,/g, '').split('.');
  const fils = Number(whole) * FILS_PER_UNIT + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(fils) ? fils : null;
}

export function formatAmount(fils: number, opts: { hideZeroFraction?: boolean } = {}): string {
  const whole = Math.floor(fils / FILS_PER_UNIT);
  const fraction = fils % FILS_PER_UNIT;
  const wholeText = whole.toLocaleString('en-US');
  if (opts.hideZeroFraction && fraction === 0) return wholeText;
  return `${wholeText}.${String(fraction).padStart(2, '0')}`;
}

export interface WordsOptions {
  style: WordsStyle;
  prefix: string;
  suffix: string;
  minorUnit: string;
  fractionFormat: FractionFormat;
  capitals?: boolean;
  hyphenate?: boolean;
}

export function amountInWords(fils: number, opts: WordsOptions): string {
  const whole = Math.floor(fils / FILS_PER_UNIT);
  const fraction = fils % FILS_PER_UNIT;
  const parts = [opts.prefix, integerToWords(whole, opts.style, opts.hyphenate)];
  if (fraction) {
    parts.push(
      opts.fractionFormat === 'numeric'
        ? `and ${String(fraction).padStart(2, '0')}/100`
        : `and ${opts.minorUnit} ${integerToWords(fraction, opts.style, opts.hyphenate)}`,
    );
  }
  parts.push(opts.suffix);
  const text = parts.filter(Boolean).join(' ');
  return opts.capitals ? text.toUpperCase() : text;
}
