import { describe, expect, test } from 'vitest';
import { amountInWords, formatAmount, integerToWords, parseAmountToFils } from '../src/shared/amountInWords';

describe('integerToWords', () => {
  test('returns Zero for 0', () => {
    expect(integerToWords(0, 'uk')).toBe('Zero');
  });

  test('joins hundreds and tens with "and" in UK style', () => {
    expect(integerToWords(120, 'uk')).toBe('One Hundred and Twenty');
  });

  test('omits "and" in US style', () => {
    expect(integerToWords(120, 'us')).toBe('One Hundred Twenty');
  });

  test('writes compound tens without a hyphen unless asked', () => {
    expect(integerToWords(45, 'uk')).toBe('Forty Five');
    expect(integerToWords(45, 'uk', true)).toBe('Forty-Five');
    expect(integerToWords(23_456, 'uk')).toBe('Twenty Three Thousand Four Hundred and Fifty Six');
  });

  test('handles thousands, millions and billions', () => {
    expect(integerToWords(1_250_000, 'uk')).toBe('One Million Two Hundred and Fifty Thousand');
    expect(integerToWords(1_000_000_000, 'uk')).toBe('One Billion');
    expect(integerToWords(2_005, 'uk')).toBe('Two Thousand and Five');
    expect(integerToWords(2_005, 'us')).toBe('Two Thousand Five');
  });

  test('handles teens', () => {
    expect(integerToWords(13, 'uk')).toBe('Thirteen');
    expect(integerToWords(11_019, 'uk')).toBe('Eleven Thousand and Nineteen');
  });

  test('rejects negative or fractional numbers', () => {
    expect(() => integerToWords(-1, 'uk')).toThrow();
    expect(() => integerToWords(1.5, 'uk')).toThrow();
  });
});

describe('parseAmountToFils', () => {
  test('parses plain and comma separated values to integer fils', () => {
    expect(parseAmountToFils('1250.5')).toBe(125050);
    expect(parseAmountToFils('1,250.50')).toBe(125050);
    expect(parseAmountToFils('0.07')).toBe(7);
    expect(parseAmountToFils('  300 ')).toBe(30000);
  });

  test('avoids floating point drift', () => {
    expect(parseAmountToFils('19.99')).toBe(1999);
    expect(parseAmountToFils('1.005')).toBeNull();
  });

  test('returns null for invalid input', () => {
    expect(parseAmountToFils('')).toBeNull();
    expect(parseAmountToFils('abc')).toBeNull();
    expect(parseAmountToFils('-5')).toBeNull();
    expect(parseAmountToFils('1.2.3')).toBeNull();
  });
});

describe('formatAmount', () => {
  test('formats fils with thousands separators and two decimals', () => {
    expect(formatAmount(125050)).toBe('1,250.50');
    expect(formatAmount(100000000000)).toBe('1,000,000,000.00');
    expect(formatAmount(7)).toBe('0.07');
  });

  test('can hide a zero fraction', () => {
    expect(formatAmount(30000, { hideZeroFraction: true })).toBe('300');
    expect(formatAmount(30050, { hideZeroFraction: true })).toBe('300.50');
  });
});

describe('amountInWords', () => {
  const base = { style: 'uk' as const, prefix: 'Dirhams', suffix: 'Only', minorUnit: 'Fils', fractionFormat: 'words' as const };

  test('writes whole amounts with prefix and suffix', () => {
    expect(amountInWords(30000, base)).toBe('Dirhams Three Hundred Only');
  });

  test('writes the fraction in words', () => {
    expect(amountInWords(125050, base)).toBe('Dirhams One Thousand Two Hundred and Fifty and Fils Fifty Only');
  });

  test('writes the fraction numerically', () => {
    expect(amountInWords(125050, { ...base, fractionFormat: 'numeric' })).toBe(
      'Dirhams One Thousand Two Hundred and Fifty and 50/100 Only',
    );
  });

  test('supports capitals and empty prefix/suffix', () => {
    expect(amountInWords(120, { ...base, prefix: '', suffix: '', capitals: true })).toBe('ONE AND FILS TWENTY');
  });

  test('handles fils-only amounts', () => {
    expect(amountInWords(7, base)).toBe('Dirhams Zero and Fils Seven Only');
  });
});
