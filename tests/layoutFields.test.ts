import { describe, expect, test } from 'vitest';
import { editableFields, moveDate, toggleDateMode, updateField } from '../src/shared/layoutFields';
import { digitDateLayout, lineDateLayout } from './fixtures';

describe('editableFields', () => {
  test('lists the date line or each digit box', () => {
    expect(editableFields(lineDateLayout()).map(f => f.key)).toEqual(['date', 'payee', 'words1', 'words2', 'amount', 'bearer', 'acPayee']);
    const digits = editableFields(digitDateLayout()).map(f => f.key);
    expect(digits.slice(0, 8)).toEqual(['digit0', 'digit1', 'digit2', 'digit3', 'digit4', 'digit5', 'digit6', 'digit7']);
    expect(digits).not.toContain('payee2');
  });
});

describe('updateField', () => {
  test('replaces one field, rounds to 0.1 mm and leaves the rest alone', () => {
    const before = lineDateLayout();
    const after = updateField(before, 'payee', { ...before.payee, x: 30.04, width: 99.96 });
    expect(after.payee.x).toBe(30);
    expect(after.payee.width).toBe(100);
    expect(after.words1).toBe(before.words1);
    expect(before.payee.x).toBe(25.32);
  });

  test('keeps sizes positive', () => {
    const after = updateField(lineDateLayout(), 'amount', { ...lineDateLayout().amount, width: -5 });
    expect(after.amount.width).toBe(1);
  });

  test('moves crossing lines with the A/C payee text', () => {
    const before = lineDateLayout();
    const after = updateField(before, 'acPayee', { ...before.acPayee, x: before.acPayee.x + 2, y: before.acPayee.y + 1 });
    expect(after.crossingLines[0].x1).toBeCloseTo(before.crossingLines[0].x1 + 2);
    expect(after.crossingLines[1].y2).toBeCloseTo(before.crossingLines[1].y2 + 1);
  });

  test('updates one date digit box', () => {
    const before = digitDateLayout();
    const after = updateField(before, 'digit3', { x: 150, y: 20, width: 4, height: 6, fontPt: 12 });
    expect(after.date.mode === 'digits' && after.date.boxes[3].x).toBe(150);
    expect(after.date.mode === 'digits' && after.date.boxes[2]).toEqual(before.date.mode === 'digits' && before.date.boxes[2]);
  });

  test('keeps the bearer strike text', () => {
    const before = lineDateLayout();
    expect(updateField(before, 'bearer', { ...before.bearerStrike, x: 1 }).bearerStrike.text).toBe('XXXXX');
  });

  test('ignores keys that do not apply', () => {
    const line = lineDateLayout();
    expect(updateField(line, 'digit2', line.payee)).toBe(line);
    const digits = digitDateLayout();
    expect(updateField(digits, 'date', digits.payee)).toBe(digits);
  });
});

describe('toggleDateMode', () => {
  test('splits a date line into eight boxes and back', () => {
    const digits = toggleDateMode(lineDateLayout());
    expect(digits.date.mode).toBe('digits');
    if (digits.date.mode === 'digits') {
      expect(digits.date.boxes).toHaveLength(8);
      expect(digits.date.boxes[0].x).toBe(122);
    }
    const line = toggleDateMode(digits);
    expect(line.date.mode === 'line' && line.date.box.x).toBe(122);
    expect(line.date.mode === 'line' && line.date.box.width).toBeCloseTo(23, 0);
  });
});

describe('moveDate', () => {
  test('moves the whole date', () => {
    const moved = moveDate(digitDateLayout(), 1, -1);
    expect(moved.date.mode === 'digits' && moved.date.boxes[7].x).toBeCloseTo(166.5);
    const line = moveDate(lineDateLayout(), 2, 0);
    expect(line.date.mode === 'line' && line.date.box.x).toBe(124);
  });
});
