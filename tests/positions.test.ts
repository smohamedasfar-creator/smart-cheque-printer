import { describe, expect, test } from 'vitest';
import { adjustPosition, READY_POSITIONS, readyPlacement, withReadyPositions } from '../src/shared/positions';
import { blankLayout } from '../src/shared/layoutDefaults';
import type { PrintPosition } from '../src/shared/types';

const layout = blankLayout(205.74, 87.21);

describe('ready print positions', () => {
  test('every cheque book gets back and front tray, vertical and horizontal', () => {
    const list = withReadyPositions(layout, []);
    expect(list.map(p => p.name)).toEqual(READY_POSITIONS.map(r => r.name));
    expect(list.map(p => p.tray)).toEqual(['rear', 'rear', 'front', 'front']);
    // Vertical and horizontal differ by a quarter turn.
    expect(Math.abs(list[0].rotation - list[1].rotation) % 180).toBe(90);
    expect(list.every(p => !p.calibrated)).toBe(true);
  });

  test('a saved position loaded the same way keeps its adjustment; other saved positions follow the ready ones', () => {
    const v = readyPlacement(layout, 'rear', 270);
    const saved: PrintPosition[] = [
      { name: 'Manual slot', tray: 'manual', rotation: 0, x: 1, y: 2 },
      { name: 'Back tray · Date end', tray: 'rear', ...v, x: v.x + 3, calibrated: true },
    ];
    const list = withReadyPositions(layout, saved);
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ name: READY_POSITIONS[0].name, x: v.x + 3, calibrated: true });
    expect(list[4].name).toBe('Manual slot');
  });

  test('an adjustment carries to the same tray positions not yet adjusted, never to the other tray', () => {
    const list = withReadyPositions(layout, []);
    const after = adjustPosition(list, 0, { ...list[0], x: list[0].x + 2, y: list[0].y - 1.5 });
    expect(after[0]).toMatchObject({ x: list[0].x + 2, y: list[0].y - 1.5, calibrated: true });
    expect(after[1]).toMatchObject({ x: Math.round((list[1].x + 2) * 10) / 10, y: Math.round((list[1].y - 1.5) * 10) / 10, calibrated: false });
    expect(after[2]).toEqual(list[2]);
    // Once adjusted on its own, a position keeps its own adjustment.
    const again = adjustPosition(adjustPosition(after, 1, { ...after[1], x: after[1].x + 1 }), 0, { ...after[0], y: after[0].y + 4 });
    expect(again[1].y).toBe(after[1].y);
  });

  test('turning a position half round does not move the others', () => {
    const list = withReadyPositions(layout, []);
    const after = adjustPosition(list, 0, { rotation: ((list[0].rotation + 180) % 360) as 0, x: list[0].x + 5, y: list[0].y });
    expect(after[1]).toEqual(list[1]);
  });
});
