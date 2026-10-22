import { describe, expect, test } from 'vitest';
import {
  adjustPosition,
  anyPositionSetUp,
  layoutForPosition,
  mapAllPositions,
  migratePositions,
  modeOf,
  positionKeyOf,
  READY_POSITIONS,
  readyPlacement,
  shiftFor,
  shiftLayout,
  toDefault,
  toManual,
  hasOwnAdjustments,
  LEGACY_VERTICAL_DIFF,
  verticalDiff,
  withoutOwnAdjustments,
  withPositionLayout,
  withReadyPositions,
  withShift,
} from '../src/shared/positions';
import { blankLayout } from '../src/shared/layoutDefaults';
import { correctPlacement } from '../src/shared/print';
import type { PrintPosition } from '../src/shared/types';

const layout = blankLayout(205.74, 87.21);

describe('ready print positions', () => {
  test('every cheque book gets back and front tray, horizontal (main) and vertical', () => {
    const list = withReadyPositions(layout, []);
    expect(list.map(p => p.name)).toEqual(READY_POSITIONS.map(r => r.name));
    expect(READY_POSITIONS.map(r => r.key)).toEqual(['rear-h', 'rear-v', 'front-h', 'front-v']);
    expect(list.map(p => p.tray)).toEqual(['rear', 'rear', 'front', 'front']);
    // Horizontal and vertical differ by a quarter turn.
    expect(Math.abs(list[0].rotation - list[1].rotation) % 180).toBe(90);
    expect(list.map(p => positionKeyOf(layout, p))).toEqual(['rear-h', 'rear-v', 'front-h', 'front-v']);
  });

  test('a saved position loaded the same way keeps its place; other saved positions follow the ready ones', () => {
    const v = readyPlacement(layout, 'rear', 270);
    const saved: PrintPosition[] = [
      { name: 'Manual slot', tray: 'manual', rotation: 0, x: 1, y: 2 },
      { name: 'Back tray · Date end', tray: 'rear', ...v, x: v.x + 3, calibrated: true },
    ];
    const list = withReadyPositions(layout, saved);
    expect(list).toHaveLength(5);
    expect(list[1]).toMatchObject({ name: READY_POSITIONS[1].name, x: v.x + 3, calibrated: true });
    expect(list[4].name).toBe('Manual slot');
    expect(positionKeyOf(layout, list[4])).toBeNull();
  });

  test('turning a position half round does not move the others', () => {
    const list = withReadyPositions(layout, []);
    const after = adjustPosition(list, 0, { rotation: ((list[0].rotation + 180) % 360) as 0, x: list[0].x + 5, y: list[0].y });
    expect(after[1]).toEqual(list[1]);
  });
});

describe('default setting: one X / Y, fixed differences between positions', () => {
  test('a new cheque book: all four print as laid out (the printer calibration does the rest)', () => {
    for (const k of ['rear-h', 'rear-v', 'front-h', 'front-v'] as const) expect(shiftFor(layout, k)).toMatchObject({ x: 0, y: 0 });
    expect(verticalDiff(layout)).toEqual({ x: 0, y: 0 });
    expect(anyPositionSetUp(layout)).toBe(false);
    expect(hasOwnAdjustments(layout)).toBe(false);
  });

  test('a cheque book that kept the 1.8 vertical difference: vertical 7.5 mm higher and 6 mm further left', () => {
    const legacy = { ...layout, verticalDiff: { ...LEGACY_VERTICAL_DIFF } };
    expect(shiftFor(legacy, 'rear-v')).toEqual({ x: -6, y: 7.5, auto: true });
    expect(shiftFor(legacy, 'front-h')).toEqual({ x: 0, y: 0, auto: true });
    expect(hasOwnAdjustments(legacy)).toBe(true);
    // Only the printer calibration: the difference and every X / Y go.
    const plain = withoutOwnAdjustments(withShift(legacy, 'rear-h', { x: 2, y: 1 }));
    expect(hasOwnAdjustments(plain)).toBe(false);
    expect(shiftFor(plain, 'rear-v')).toMatchObject({ x: 0, y: 0 });
  });

  test('one X / Y moves all four and keeps the difference, whichever position it is typed for', () => {
    const legacy = { ...layout, verticalDiff: { ...LEGACY_VERTICAL_DIFF } };
    const L = withShift(legacy, 'rear-h', { x: 1, y: -2 });
    expect(['rear-h', 'rear-v', 'front-h', 'front-v'].map(k => shiftFor(L, k as never))).toEqual([
      { x: 1, y: -2, auto: false }, { x: -5, y: 5.5, auto: true }, { x: 1, y: -2, auto: true }, { x: -5, y: 5.5, auto: true },
    ]);
    // Set from the vertical test print: the vertical gets exactly that, the horizontal keeps the difference.
    const V = withShift(legacy, 'rear-v', { x: 0.5, y: 7 });
    expect(shiftFor(V, 'rear-v')).toMatchObject({ x: 0.5, y: 7 });
    expect(shiftFor(V, 'rear-h')).toMatchObject({ x: 6.5, y: -0.5 });
    expect(anyPositionSetUp(V)).toBe(true);
  });

  test('a field moved on the main tab moves in every position', () => {
    const L = withShift(layout, 'rear-h', { x: 0, y: 2 });
    const printed = layoutForPosition(L, 'rear-h');
    const edited = withPositionLayout(L, 'rear-h', { ...printed, payee: { ...printed.payee, x: printed.payee.x + 4 } });
    for (const k of ['rear-h', 'rear-v', 'front-v'] as const) expect(layoutForPosition(edited, k).payee.x - layoutForPosition(L, k).payee.x).toBeCloseTo(4, 5);
  });

  test('the X / Y moves the printed fields right and up', () => {
    const moved = layoutForPosition(withShift(layout, 'rear-h', { x: 2, y: 3 }), 'rear-h');
    expect([moved.payee.x - layout.payee.x, moved.payee.y - layout.payee.y].map(v => Math.round(v * 10) / 10)).toEqual([2, -3]);
    expect(layoutForPosition(layout, null)).toBe(layout);
    const shifted = shiftLayout(layout, { x: 2, y: 3 });
    expect(shifted.words1.y).toBeCloseTo(layout.words1.y - 3, 1);
  });
});

describe('manual setting: every position on its own', () => {
  const base = withShift(layout, 'rear-h', { x: 1, y: 2 });

  test('switching to manual keeps every position printing where it did', () => {
    const M = toManual(base);
    expect(modeOf(M)).toBe('manual');
    for (const r of READY_POSITIONS) expect(layoutForPosition(M, r.key).payee).toEqual(layoutForPosition(base, r.key).payee);
    for (const r of READY_POSITIONS) expect(shiftFor(M, r.key)).toEqual({ x: 0, y: 0, auto: false });
  });

  test('changing the vertical position does not change the horizontal one', () => {
    let M = toManual(base);
    const h = layoutForPosition(M, 'rear-h');
    M = withShift(M, 'rear-v', { x: -1, y: 3 });
    const v = layoutForPosition(M, 'rear-v');
    M = withPositionLayout(M, 'rear-v', { ...v, amount: { ...v.amount, x: v.amount.x + 6 } });
    const fields = (L: typeof h) => [L.payee, L.amount, L.words1, L.words2, L.date, L.bearerStrike];
    expect(fields(layoutForPosition(M, 'rear-h'))).toEqual(fields(h));
    expect(layoutForPosition(M, 'rear-v').amount.x).toBeCloseTo(v.amount.x + 6, 5);
    expect(shiftFor(M, 'rear-v')).toEqual({ x: -1, y: 3, auto: false });
  });

  test('a change for all positions (date on a line or in boxes) reaches each one', () => {
    const M = mapAllPositions(toManual(base), L => ({ ...L, date: { ...L.date } , words2: { ...L.words2, width: 50 } }));
    for (const r of READY_POSITIONS) expect(layoutForPosition(M, r.key).words2.width).toBe(50);
  });

  test('back to default keeps the main position and its X / Y; the others follow it again', () => {
    let M = toManual(base);
    M = withShift(M, 'rear-h', { x: 0, y: 1 });
    M = withShift(M, 'rear-v', { x: 9, y: 9 });
    const D = toDefault(M);
    expect(modeOf(D)).toBe('default');
    expect(layoutForPosition(D, 'rear-h').payee).toEqual(layoutForPosition(M, 'rear-h').payee);
    expect(shiftFor(D, 'rear-v')).toEqual({ x: 0, y: 1, auto: true });
  });
});

describe('older cheque books are brought up to date once', () => {
  test('a correction set up by the user in the page placement becomes the X / Y; what the app moved goes back', () => {
    const list = withReadyPositions(layout, []);
    // Main position set up by the user to print 4 mm higher on the cheque (it landed 4 mm low).
    const userSet = { ...list[0], ...correctPlacement(layout, list[0], 0, 4), calibrated: true };
    const appMoved = { ...list[2], x: list[2].x + 2, calibrated: false };
    const { layout: L, positions, changed } = migratePositions(layout, [userSet, list[1], appMoved, list[3]]);
    expect(changed).toBe(true);
    expect(modeOf(L)).toBe('default');
    // 4 mm higher, plus the 1.8.1 horizontal move (6 mm right, 2 mm down).
    expect(shiftFor(L, 'rear-h')).toEqual({ x: 6, y: 2, auto: false });
    expect(positions.slice(0, 4).map(p => [p.x, p.y])).toEqual(list.map(p => [p.x, p.y]));
    expect(migratePositions(L, positions).changed).toBe(false);
  });

  test('1.7.0 settings of their own for other positions: manual, each printing where it did', () => {
    const old = { ...layout, positionsVersion: 2, positionShifts: { 'rear-h': { x: 0, y: 2 }, 'rear-v': { x: -1, y: 8 } } };
    const { layout: L } = migratePositions(old, []);
    expect(modeOf(L)).toBe('manual');
    expect(layoutForPosition(L, 'rear-v').payee).toEqual(shiftLayout(layout, { x: -1, y: 8 }).payee);
    expect(layoutForPosition(L, 'rear-h').payee).toEqual(shiftLayout(layout, { x: 0, y: 2 }).payee);
    // A position that followed the main one prints where 1.8.0 printed it (5.5 mm higher).
    expect(layoutForPosition(L, 'front-v').payee).toEqual(shiftLayout(layout, { x: 0, y: 2 + 5.5 }).payee);
  });

  test('1.8.0 default setting: vertical keeps printing where it did, horizontal moves 6 mm right and 2 mm down', () => {
    const old = { ...layout, positionsVersion: 3, positionMode: 'default' as const, positionShifts: { 'rear-h': { x: 1, y: 3 } } };
    const { layout: L, changed } = migratePositions(old, []);
    expect(changed).toBe(true);
    // 1.8.0 printed horizontal at (1, 3) and vertical at (1, 8.5).
    expect(shiftFor(L, 'rear-h')).toMatchObject({ x: 7, y: 1 });
    expect(shiftFor(L, 'rear-v')).toMatchObject({ x: 1, y: 8.5 });
    expect(shiftFor(L, 'front-v')).toMatchObject({ x: 1, y: 8.5 });
    // A 1.8.0 cheque book that was never set up moves the same way.
    expect(shiftFor(migratePositions({ ...layout, positionsVersion: 3 }, []).layout, 'rear-v')).toMatchObject({ x: 0, y: 5.5 });
    // Manual cheque books keep every position as it was.
    const manual = { ...old, positionMode: 'manual' as const, positionShifts: { 'rear-v': { x: 2, y: 2 } } };
    expect(migratePositions(manual, []).layout.positionShifts).toEqual(manual.positionShifts);
  });
});
