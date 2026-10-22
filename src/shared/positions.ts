// Ready-made print positions: every cheque book can print from the back tray and the front tray, lying (horizontal,
// top edge first) or standing (vertical, date end first), without the user adding positions. Each has its own
// adjustment of the whole print, kept in the cheque layout; the main one is the back tray, horizontal, and the others
// follow it until they are adjusted on their own.
import { editableFields, updateField } from './layoutFields';
import { chequePointOnPage, defaultTrayView, trayToPage, TRAY_KINDS, type Placement, type TrayKind } from './print';
import type { ChequeLayout, FeedRotation, PositionFields, PositionKey, PositionMode, PrintPosition } from './types';

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

/** The main position: in the default setting the others keep a fixed difference from it. */
export const MAIN_POSITION: PositionKey = 'rear-h';

/**
 * Default setting: where vertical positions print compared with horizontal ones, in mm on the cheque (x right, y up).
 * Measured on a printer: vertical printing lands lower and further right, so it is moved up and left by this much.
 */
export const VERTICAL_DIFF = { x: -6, y: 7.5 } as const;

/** The difference in words, for the screens. */
export const VERTICAL_DIFF_TEXT = `${VERTICAL_DIFF.y} mm higher and ${-VERTICAL_DIFF.x} mm further left`;

export interface Shift {
  /** mm to the right on the cheque */
  x: number;
  /** mm up on the cheque */
  y: number;
}

const tenth = (v: number) => Math.round(v * 10) / 10 || 0;
const ZERO: Shift = { x: 0, y: 0 };
const lift = (key: PositionKey): Shift => (key.endsWith('-v') ? VERTICAL_DIFF : ZERO);

/** Default: one X / Y for the main position and fixed differences for the others. Manual: every position on its own. */
export const modeOf = (layout: ChequeLayout): PositionMode => layout.positionMode ?? 'default';

/**
 * A position's move of the whole print (its X / Y). Default: the main one's plus the fixed difference (`auto` for the
 * other three). Manual: its own.
 */
export function shiftFor(layout: ChequeLayout, key: PositionKey): Shift & { auto: boolean } {
  const own = layout.positionShifts ?? {};
  if (modeOf(layout) === 'manual') {
    const s = own[key] ?? ZERO;
    return { x: tenth(s.x), y: tenth(s.y), auto: false };
  }
  const main = own[MAIN_POSITION] ?? ZERO;
  const l = lift(key);
  return { x: tenth(main.x + l.x), y: tenth(main.y + l.y), auto: key !== MAIN_POSITION };
}

/**
 * Sets a position's X / Y. Default: the main one moves so this position gets exactly that, and the others keep their
 * difference. Manual: only this position changes.
 */
export function withShift(layout: ChequeLayout, key: PositionKey, shift: Shift): ChequeLayout {
  if (modeOf(layout) === 'manual') return { ...layout, positionShifts: { ...layout.positionShifts, [key]: { x: tenth(shift.x), y: tenth(shift.y) } } };
  const l = lift(key);
  return { ...layout, positionShifts: { [MAIN_POSITION]: { x: tenth(shift.x - l.x), y: tenth(shift.y - l.y) } } };
}

/** True once printing was set up (a move was set, or the positions were set up one by one). */
export const anyPositionSetUp = (layout: ChequeLayout) => modeOf(layout) === 'manual' || Object.keys(layout.positionShifts ?? {}).length > 0;

/** Which ready position a saved one is (by tray and the way the cheque goes in), or null for an extra one. */
export function positionKeyOf(layout: ChequeLayout, p: Pick<PrintPosition, 'tray' | 'rotation'> | undefined | null): PositionKey | null {
  if (!p) return null;
  return READY_POSITIONS.find(r => (p.tray ?? 'rear') === r.tray && readyPlacement(layout, r.tray, r.leading).rotation === p.rotation)?.key ?? null;
}

/** Every field moved by `shift` (mm, right and up). */
export function shiftLayout(layout: ChequeLayout, shift: Shift): ChequeLayout {
  if (!shift.x && !shift.y) return layout;
  const moved = editableFields(layout).reduce((L, f) => updateField(L, f.key, { ...f.box, x: f.box.x + shift.x, y: f.box.y - shift.y }), layout);
  return { ...moved, payee2: layout.payee2 && { ...layout.payee2, x: tenth(layout.payee2.x + shift.x), y: tenth(layout.payee2.y - shift.y) } };
}

const FIELD_KEYS = ['payee', 'payee2', 'amount', 'words1', 'words2', 'date', 'acPayee', 'bearerStrike', 'crossingLines'] as const;
const fieldsOf = (L: ChequeLayout): PositionFields => Object.fromEntries(FIELD_KEYS.map(k => [k, L[k]])) as unknown as PositionFields;

/** The layout as it prints in a position: what is shown on that position's tab and what goes to the printer. */
export function layoutForPosition(layout: ChequeLayout, key: PositionKey | null): ChequeLayout {
  if (!key) return layout;
  if (modeOf(layout) === 'manual') {
    const own = layout.positionLayouts?.[key];
    return shiftLayout(own ? { ...layout, ...own } : layout, shiftFor(layout, key));
  }
  return shiftLayout(layout, shiftFor(layout, key));
}

/**
 * The fields edited on a position's tab (given as they print there). Manual: only that position changes. Default: the
 * fields of every position change (they are edited on the main tab).
 */
export function withPositionLayout(layout: ChequeLayout, key: PositionKey, printed: ChequeLayout): ChequeLayout {
  const s = shiftFor(layout, key);
  const fields = fieldsOf(shiftLayout(printed, { x: -s.x, y: -s.y }));
  if (modeOf(layout) === 'manual') return { ...layout, positionLayouts: { ...layout.positionLayouts, [key]: fields } };
  return { ...layout, ...fields };
}

/** Applies the same change to the fields of every position (e.g. the date written on a line or in boxes). */
export function mapAllPositions(layout: ChequeLayout, change: (L: ChequeLayout) => ChequeLayout): ChequeLayout {
  const base = change(layout);
  if (!layout.positionLayouts) return base;
  const positionLayouts: ChequeLayout['positionLayouts'] = {};
  for (const r of READY_POSITIONS) {
    const own = layout.positionLayouts[r.key];
    if (own) positionLayouts[r.key] = fieldsOf(change({ ...layout, ...own }));
  }
  return { ...base, positionLayouts };
}

/** Manual: each position starts with its fields where they print now and can then be changed on its own. */
export function toManual(layout: ChequeLayout): ChequeLayout {
  if (modeOf(layout) === 'manual') return layout;
  const positionLayouts: ChequeLayout['positionLayouts'] = {};
  for (const r of READY_POSITIONS) positionLayouts[r.key] = fieldsOf(layoutForPosition(layout, r.key));
  return { ...layout, positionMode: 'manual', positionLayouts, positionShifts: {} };
}

/** Default: the main position's fields and X / Y are kept; the others go back to the fixed difference. */
export function toDefault(layout: ChequeLayout): ChequeLayout {
  if (modeOf(layout) === 'default') return layout;
  const main = layout.positionLayouts?.[MAIN_POSITION];
  const s = layout.positionShifts?.[MAIN_POSITION];
  const { positionLayouts: _dropped, ...rest } = layout;
  return { ...rest, ...(main ?? {}), positionMode: 'default', positionShifts: s ? { [MAIN_POSITION]: s } : {} };
}

/**
 * The same move as going from page placement `from` to `to` (same turn), as a shift of the print on the cheque.
 * Lets a dragged, scanned or graph-read correction become the position's X / Y.
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

/** 1.7.0 printed automatic vertical positions this much higher; 1.8.0 this much. */
const LIFT_1_7_MM = 3.5;
const LIFT_1_8: Shift = { x: 0, y: 5.5 };
/** 1.8.1: in the default setting horizontal printing moved by this much (measured) while vertical stayed where it was. */
const HORIZONTAL_FIX_1_8_1: Shift = { x: 6, y: -2 };
/** Version of the print position data written by this app; a cheque book saved with it needs no update. */
export const POSITIONS_VERSION = 4;

/**
 * Brings an older cheque book up to date, once. Corrections kept in the page placement become the position's X / Y
 * (1.7.0). Then, if positions other than the main one were set up on their own, the cheque book switches to the
 * manual setting with each position printing where it did; otherwise it keeps the default setting. In the default
 * setting (1.8.1) the vertical positions keep printing where they did and the horizontal ones move by the measured fix.
 */
export function migratePositions(layout: ChequeLayout, positions: readonly PrintPosition[]): { layout: ChequeLayout; positions: PrintPosition[]; changed: boolean } {
  const version = layout.positionsVersion ?? 0;
  if (version >= POSITIONS_VERSION) return { layout, positions: withReadyPositions(layout, positions), changed: false };
  const up = version < 3 ? toVersion3(layout, positions) : { layout, positions: withReadyPositions(layout, positions) };
  let L: ChequeLayout = { ...up.layout, positionsVersion: POSITIONS_VERSION };
  if (modeOf(L) === 'default') {
    const main = L.positionShifts?.[MAIN_POSITION] ?? ZERO;
    L = { ...L, positionShifts: { [MAIN_POSITION]: { x: tenth(main.x + HORIZONTAL_FIX_1_8_1.x), y: tenth(main.y + HORIZONTAL_FIX_1_8_1.y) } } };
  }
  return { layout: L, positions: up.positions, changed: true };
}

/** Up to the 1.8.0 data: placement corrections become X / Y, positions set up on their own make the manual setting. */
function toVersion3(layout: ChequeLayout, positions: readonly PrintPosition[]): { layout: ChequeLayout; positions: PrintPosition[] } {
  let own: Partial<Record<PositionKey, Shift>> = { ...(layout.positionShifts ?? {}) };
  let list = withReadyPositions(layout, positions);
  if ((layout.positionsVersion ?? 0) < 2) {
    list = list.map((p, i) => {
      const r = READY_POSITIONS[i];
      if (!r) return p;
      const plain = readyPlacement(layout, r.tray, r.leading);
      if (p.rotation !== plain.rotation || (p.x === plain.x && p.y === plain.y)) return p;
      if (p.calibrated && !own[r.key]) own = { ...own, [r.key]: placementToShift(layout, plain, p) };
      return { ...p, x: plain.x, y: plain.y };
    });
  }
  const others = READY_POSITIONS.filter(r => r.key !== MAIN_POSITION && own[r.key]);
  let L: ChequeLayout = { ...layout, positionsVersion: 3 };
  if (!others.length) {
    L = { ...L, positionMode: 'default', positionShifts: own[MAIN_POSITION] ? { [MAIN_POSITION]: own[MAIN_POSITION]! } : {} };
  } else {
    // Each position keeps printing where it did: its own move, or the main one's (worked out as 1.7.0 did) plus the new difference.
    const first = READY_POSITIONS.find(r => own[r.key])!;
    const oldLift = (k: PositionKey) => (k.endsWith('-v') ? LIFT_1_7_MM : 0);
    const main = own[MAIN_POSITION] ?? { x: own[first.key]!.x, y: own[first.key]!.y - oldLift(first.key) };
    const positionLayouts: ChequeLayout['positionLayouts'] = {};
    const lift18 = (k: PositionKey) => (k.endsWith('-v') ? LIFT_1_8 : ZERO);
    for (const r of READY_POSITIONS) positionLayouts[r.key] = fieldsOf(shiftLayout(layout, own[r.key] ?? { x: main.x + lift18(r.key).x, y: main.y + lift18(r.key).y }));
    L = { ...L, positionMode: 'manual', positionLayouts, positionShifts: {} };
  }
  return { layout: L, positions: list };
}

/** A position back to its starting X / Y (default: everything follows the plain layout again; manual: this position only). */
export function resetShift(layout: ChequeLayout, key: PositionKey): ChequeLayout {
  return modeOf(layout) === 'manual' ? withShift(layout, key, ZERO) : { ...layout, positionShifts: {} };
}
