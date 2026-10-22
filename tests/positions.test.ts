import { describe, expect, test } from 'vitest';
import {
  adjustPosition,
  anyPositionSetUp,
  migratePositions,
  positionKeyOf,
  READY_POSITIONS,
  readyPlacement,
  settingsFor,
  shiftFor,
  shiftLayout,
  VERTICAL_LIFT_MM,
  withPositionShift,
  withReadyPositions,
} from '../src/shared/positions';
import { blankLayout } from '../src/shared/layoutDefaults';
import { correctPlacement } from '../src/shared/print';
import { DEFAULT_SETTINGS, type PrintPosition } from '../src/shared/types';

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

describe('each position has its own adjustment, following the main one (back tray, horizontal)', () => {
  test('nothing set up: horizontal prints as laid out, vertical starts higher', () => {
    expect(shiftFor(layout, 'rear-h')).toEqual({ x: 0, y: 0, auto: true });
    expect(shiftFor(layout, 'rear-v')).toEqual({ x: 0, y: VERTICAL_LIFT_MM, auto: true });
    expect(shiftFor(layout, 'front-h')).toEqual({ x: 0, y: 0, auto: true });
    expect(shiftFor(layout, 'front-v')).toEqual({ x: 0, y: VERTICAL_LIFT_MM, auto: true });
    expect(anyPositionSetUp(layout)).toBe(false);
  });

  test('setting up the main position sets up all four', () => {
    const L = withPositionShift(layout, 'rear-h', { x: 1, y: -2 });
    expect(shiftFor(L, 'rear-h')).toEqual({ x: 1, y: -2, auto: false });
    expect(shiftFor(L, 'rear-v')).toEqual({ x: 1, y: -2 + VERTICAL_LIFT_MM, auto: true });
    expect(shiftFor(L, 'front-h')).toEqual({ x: 1, y: -2, auto: true });
    expect(shiftFor(L, 'front-v')).toEqual({ x: 1, y: -2 + VERTICAL_LIFT_MM, auto: true });
    expect(anyPositionSetUp(L)).toBe(true);
  });

  test('setting up a vertical position first works out the main one from it', () => {
    const L = withPositionShift(layout, 'rear-v', { x: 0.5, y: 5 });
    expect(shiftFor(L, 'rear-h')).toEqual({ x: 0.5, y: 5 - VERTICAL_LIFT_MM, auto: true });
    expect(shiftFor(L, 'front-v')).toEqual({ x: 0.5, y: 5, auto: true });
  });

  test('a position adjusted on its own keeps it; going back to automatic follows the main one again', () => {
    let L = withPositionShift(layout, 'rear-h', { x: 0, y: 1 });
    L = withPositionShift(L, 'rear-v', { x: -1, y: 6 });
    L = withPositionShift(L, 'rear-h', { x: 0, y: 2 });
    expect(shiftFor(L, 'rear-v')).toEqual({ x: -1, y: 6, auto: false });
    expect(shiftFor(withPositionShift(L, 'rear-v', null), 'rear-v')).toEqual({ x: 0, y: 2 + VERTICAL_LIFT_MM, auto: true });
  });

  test('the adjustment moves the printed text right and up', () => {
    const L = withPositionShift(layout, 'rear-h', { x: 2, y: 3 });
    expect(settingsFor({ ...DEFAULT_SETTINGS, offsetX: 0.5, offsetY: 0 }, L, 'rear-h')).toMatchObject({ offsetX: 2.5, offsetY: -3 });
    expect(settingsFor(DEFAULT_SETTINGS, L, null)).toBe(DEFAULT_SETTINGS);
    const moved = shiftLayout(layout, { x: 2, y: 3 });
    expect([moved.payee.x - layout.payee.x, moved.payee.y - layout.payee.y].map(v => Math.round(v * 10) / 10)).toEqual([2, -3]);
  });

  test('old print positions: what the user set up becomes that position\'s adjustment, what the app moved goes back', () => {
    const list = withReadyPositions(layout, []);
    // Set up by the user to print 4 mm higher on the cheque (it landed 4 mm low).
    const userSet = { ...list[1], ...correctPlacement(layout, list[1], 0, 4), calibrated: true };
    const appMoved = { ...list[2], x: list[2].x + 2, calibrated: false };
    const { layout: L, positions, changed } = migratePositions(layout, [list[0], userSet, appMoved, list[3]]);
    expect(changed).toBe(true);
    expect(shiftFor(L, 'rear-v')).toEqual({ x: 0, y: 4, auto: false });
    expect(L.positionShifts?.['front-h']).toBeUndefined();
    expect(positions.slice(0, 4).map(p => [p.x, p.y])).toEqual(list.map(p => [p.x, p.y]));
    // Only once.
    expect(migratePositions(L, positions).changed).toBe(false);
  });
});
