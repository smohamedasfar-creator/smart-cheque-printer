// Ready-made print positions: every cheque book can print from the back tray and the front tray, standing
// (vertical, date end first) or lying (horizontal, top edge first), without the user adding positions.
import { defaultTrayView, trayToPage, TRAY_KINDS, type Placement, type TrayKind } from './print';
import type { ChequeLayout, FeedRotation, PrintPosition } from './types';

export interface ReadyPosition {
  tray: TrayKind;
  /** The cheque edge that goes into the printer first. */
  leading: FeedRotation;
  name: string;
}

export const READY_POSITIONS: readonly ReadyPosition[] = [
  { tray: 'rear', leading: 270, name: 'Back tray · Vertical (date end first)' },
  { tray: 'rear', leading: 0, name: 'Back tray · Horizontal (top edge first)' },
  { tray: 'front', leading: 270, name: 'Front tray · Vertical (date end first)' },
  { tray: 'front', leading: 0, name: 'Front tray · Horizontal (top edge first)' },
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
 * Saves an adjustment of position `index` and carries it to the positions of the same tray that were never adjusted:
 * a printer that prints a few mm off does so on its page, whichever way the cheque goes in.
 */
export function adjustPosition(positions: readonly PrintPosition[], index: number, next: Placement): PrintPosition[] {
  const before = positions[index];
  if (!before) return [...positions];
  // Turned half round (printed upside down) is not a shift of the page: the other positions keep theirs.
  const shifted = next.rotation === before.rotation;
  const dx = next.x - before.x;
  const dy = next.y - before.y;
  const tray = before.tray ?? 'rear';
  const tenth = (v: number) => Math.round(v * 10) / 10;
  return positions.map((p, i) => {
    if (i === index) return { ...p, rotation: next.rotation, x: next.x, y: next.y, calibrated: true };
    if (!shifted || (p.tray ?? 'rear') !== tray || p.calibrated) return p;
    return { ...p, x: tenth(p.x + dx), y: tenth(p.y + dy) };
  });
}
