// Ready-made print positions: every cheque book can print from the back tray and the front tray, lying (horizontal,
// top edge first) or standing (vertical, date end first), without the user adding positions. Each has its own
// adjustment of the whole print, kept in the cheque layout; the main one is the back tray, horizontal, and the others
// follow it until they are adjusted on their own.
import { editableFields, updateField } from './layoutFields';
import { chequePointOnPage, defaultTrayView, trayToPage, TRAY_KINDS, type Placement, type TrayKind } from './print';
import type { ChequeLayout, FeedRotation, PositionKey, PrintPosition, PrintSettings } from './types';

export interface ReadyPosition {
  key: PositionKey;
  tray: TrayKind;
  /** The cheque edge that goes into the printer first. */
  leading: FeedRotation;
  name: string;
}

export const READY_POSITIONS: readonly ReadyPosition[] = [
  { key: 'rear-h', tray: 'rear', leading: 0, name: 'Back tray · Horizontal (top edge first)' },
  { key: 'rear-v', tray: 'rear', leading: 270, name: 'Back tray · Vertical (date end first)' },
  { key: 'front-h', tray: 'front', leading: 0, name: 'Front tray · Horizontal (top edge first)' },
  { key: 'front-v', tray: 'front', leading: 270, name: 'Front tray · Vertical (date end first)' },
];

/** A ready position as printed: the cheque centred between the guides and pushed fully in. */
export function readyPlacement(layout: ChequeLayout, tray: TrayKind, leading: FeedRotation): Placement {
  return trayToPage(layout, tray, defaultTrayView(layout, tray, TRAY_KINDS[tray].turnFor(leading)));
}

const sameWay = (p: PrintPosition, tray: TrayKind, rotation: FeedRotation) => (p.tray ?? 'rear') === tray && p.rotation === rotation;

/**
 * The four ready positions first (a saved position loaded the same way takes the place of its ready one, keeping its
 * adjustment), then any other positions the user added.
 */
export function withReadyPositions(layout: ChequeLayout, positions: readonly PrintPosition[]): PrintPosition[] {
  const used = new Set<number>();
  const ready = READY_POSITIONS.map(r => {
    const placement = readyPlacement(layout, r.tray, r.leading);
    const i = positions.findIndex((p, j) => !used.has(j) && sameWay(p, r.tray, placement.rotation));
    if (i < 0) return { name: r.name, tray: r.tray, ...placement, calibrated: false };
    used.add(i);
    return { ...positions[i], name: r.name };
  });
  return [...ready, ...positions.filter((_, j) => !used.has(j))];
}

/**
 * Saves an adjustment of position `index` and carries it to every position not yet set up, in either tray: a printer
 * that prints a few mm off does so on its page, whichever way the cheque goes in. For the other tray it is a first
 * guess (trays may differ a little); a position adjusted on its own keeps its own correction.
 */
export function adjustPosition(positions: readonly PrintPosition[], index: number, next: Placement): PrintPosition[] {
  const before = positions[index];
  if (!before) return [...positions];
  // Turned half round (printed upside down) is not a shift of the page: the other positions keep theirs.
  const shifted = next.rotation === before.rotation;
  const dx = next.x - before.x;
  const dy = next.y - before.y;
  const tenth = (v: number) => Math.round(v * 10) / 10;
  return positions.map((p, i) => {
    if (i === index) return { ...p, rotation: next.rotation, x: next.x, y: next.y, calibrated: true };
    if (!shifted || p.calibrated) return p;
    return { ...p, x: tenth(p.x + dx), y: tenth(p.y + dy) };
  });
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/**
 * How far the writing spaces moved from `from` to `to`, as one shift on the cheque (mm, right and down positive):
 * the median over the fields, so one field placed differently on purpose does not count.
 */
export function fieldShift(from: ChequeLayout, to: ChequeLayout): { x: number; y: number } {
  const before = new Map(editableFields(from).filter(f => f.key !== 'acPayee').map(f => [f.key, f.box]));
  const pairs = editableFields(to).flatMap(f => (before.has(f.key) && f.key !== 'acPayee' ? [[before.get(f.key)!, f.box] as const] : []));
  const r = (v: number) => Math.round(v * 10) / 10 || 0;
  return { x: r(median(pairs.map(([a, b]) => b.x - a.x))), y: r(median(pairs.map(([a, b]) => b.y + b.height - (a.y + a.height)))) };
}

/** The main position: the others follow its adjustment until they are adjusted on their own. */
export const MAIN_POSITION: PositionKey = 'rear-h';

/** Printing vertically lands about this much lower on the cheque than horizontally, so vertical positions start this much higher. */
export const VERTICAL_LIFT_MM = 3.5;

export interface Shift {
  /** mm to the right on the cheque */
  x: number;
  /** mm up on the cheque */
  y: number;
}

const tenth = (v: number) => Math.round(v * 10) / 10 || 0;
const lift = (key: PositionKey): Shift => ({ x: 0, y: key.endsWith('-v') ? VERTICAL_LIFT_MM : 0 });

/** A position's adjustment: its own, or the main one's (with the vertical lift), `auto` then true. */
export function shiftFor(layout: ChequeLayout, key: PositionKey): Shift & { auto: boolean } {
  const own = layout.positionShifts ?? {};
  const mine = own[key];
  if (mine) return { x: tenth(mine.x), y: tenth(mine.y), auto: false };
  // The main adjustment: set directly, or worked out from whichever position was set up first.
  const first = READY_POSITIONS.find(r => own[r.key]);
  const main = own[MAIN_POSITION] ?? (first ? { x: own[first.key]!.x - lift(first.key).x, y: own[first.key]!.y - lift(first.key).y } : { x: 0, y: 0 });
  const l = lift(key);
  return { x: tenth(main.x + l.x), y: tenth(main.y + l.y), auto: true };
}

/** The layout with one position's own adjustment set (or, with null, back to following the main one). */
export function withPositionShift(layout: ChequeLayout, key: PositionKey, shift: Shift | null): ChequeLayout {
  const rest = { ...(layout.positionShifts ?? {}) };
  delete rest[key];
  return { ...layout, positionShifts: shift ? { ...rest, [key]: { x: tenth(shift.x), y: tenth(shift.y) } } : rest };
}

/** True once any position was set up: one set-up gives all four. */
export const anyPositionSetUp = (layout: ChequeLayout) => Object.keys(layout.positionShifts ?? {}).length > 0;

/** Which ready position a saved one is (by tray and the way the cheque goes in), or null for an extra one. */
export function positionKeyOf(layout: ChequeLayout, p: Pick<PrintPosition, 'tray' | 'rotation'> | undefined | null): PositionKey | null {
  if (!p) return null;
  return READY_POSITIONS.find(r => (p.tray ?? 'rear') === r.tray && readyPlacement(layout, r.tray, r.leading).rotation === p.rotation)?.key ?? null;
}

/** Print settings with a position's adjustment added to the text offsets (which run right and down). */
export function settingsFor<S extends Pick<PrintSettings, 'offsetX' | 'offsetY'>>(settings: S, layout: ChequeLayout, key: PositionKey | null): S {
  if (!key) return settings;
  const s = shiftFor(layout, key);
  return { ...settings, offsetX: settings.offsetX + s.x, offsetY: settings.offsetY - s.y };
}

/** Every field moved by `shift` (mm, right and up): the layout as it prints in a position. */
export function shiftLayout(layout: ChequeLayout, shift: Shift): ChequeLayout {
  if (!shift.x && !shift.y) return layout;
  const moved = editableFields(layout).reduce((L, f) => updateField(L, f.key, { ...f.box, x: f.box.x + shift.x, y: f.box.y - shift.y }), layout);
  return { ...moved, payee2: layout.payee2 && { ...layout.payee2, x: tenth(layout.payee2.x + shift.x), y: tenth(layout.payee2.y - shift.y) } };
}

/**
 * The same move as going from page placement `from` to `to` (same turn), as a shift of the print on the cheque.
 * Lets a dragged, scanned or graph-read correction become the position's adjustment.
 */
export function placementToShift(layout: ChequeLayout, from: Placement, to: Placement): Shift {
  // correctPlacement(from, dx, dy) gives from - A·(dx, dy), A the cheque-to-page turn; it moves the print by (-dx, -dy).
  const o = chequePointOnPage(layout, from.rotation, 0, 0);
  const ex = chequePointOnPage(layout, from.rotation, 1, 0);
  const ey = chequePointOnPage(layout, from.rotation, 0, 1);
  const [a, b, c, d] = [ex.x - o.x, ey.x - o.x, ex.y - o.y, ey.y - o.y];
  const det = a * d - b * c;
  const [px, py] = [from.x - to.x, from.y - to.y];
  const dx = (d * px - b * py) / det;
  const dy = (a * py - c * px) / det;
  return { x: tenth(-dx), y: tenth(dy) };
}

/**
 * Older cheque books kept each position's correction in its page placement. Positions the user set up turn their
 * correction into that position's own adjustment and go back to the plain placement; the ones the app moved by itself
 * just go back (they follow the main one now). Runs once per layout.
 */
export function migratePositions(layout: ChequeLayout, positions: readonly PrintPosition[]): { layout: ChequeLayout; positions: PrintPosition[]; changed: boolean } {
  if (layout.positionsVersion === 2) return { layout, positions: withReadyPositions(layout, positions), changed: false };
  let L: ChequeLayout = { ...layout, positionsVersion: 2 };
  const list = withReadyPositions(layout, positions).map((p, i) => {
    const r = READY_POSITIONS[i];
    if (!r) return p;
    const plain = readyPlacement(layout, r.tray, r.leading);
    if (p.rotation !== plain.rotation || (p.x === plain.x && p.y === plain.y)) return p;
    if (p.calibrated && !layout.positionShifts?.[r.key]) L = withPositionShift(L, r.key, placementToShift(layout, plain, p));
    return { ...p, x: plain.x, y: plain.y };
  });
  return { layout: L, positions: list, changed: true };
}
