// Printer calibration: where a printer really puts its print on the page, measured once per tray by printing a sheet of
// A4, folding it in half each way and reading the scales at the folds. A fold is exactly in the middle of the paper, so
// no ruler is needed. The printer shifts every page the same way whatever is printed, so one calibration per tray puts
// every cheque in place: any bank, any size, horizontal or vertical (turning the cheque turns the shift with it).
import { alignTrayView, footprint, sheetFor, TRAY_KINDS, type Placement, type TrayGeometry, type TrayKind, type TrayView } from './print';
import { guessTray } from './loading';
import type { ChequeLayout, PrintSettings } from './types';

/** How far the printer puts its print from where it should be on the page, in mm: x to the right, y towards the end of the page. */
export interface PageOffset {
  x: number;
  y: number;
}

/** The numbers read where the folds cross the scales: A for the left-to-right fold, B for the top-to-bottom fold. */
export interface FoldReading {
  a: number;
  b: number;
}

const A4 = { width: 210, height: 297 };
/** The scales run this far either side of the middle of the page. */
export const FOLD_SCALE_MM = 20;
/** A reading further out than this is a misread (or a printer scaling the page). */
export const MAX_READING_MM = FOLD_SCALE_MM;

const tenth = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * The page offset from the fold readings. Scale A's 0 is printed in the middle of the page; the printer puts it x mm
 * to the right, so the fold (the real middle) crosses the scale at -x. The same for scale B down the page.
 */
export function offsetFromFold(reading: FoldReading): PageOffset {
  return { x: tenth(-reading.a), y: tenth(-reading.b) };
}

/** The reading that gives this offset (to show a saved calibration as the numbers that were read). */
export function foldFromOffset(offset: PageOffset): FoldReading {
  return { a: tenth(-offset.x), b: tenth(-offset.y) };
}

/** The saved calibration of the chosen printer for a tray, or null when it was never calibrated. */
export function trayOffset(settings: Pick<PrintSettings, 'printerName' | 'printerOffsets'>, tray: TrayKind): PageOffset | null {
  return settings.printerOffsets?.[settings.printerName ?? '']?.[tray] ?? null;
}

/** Settings with one tray's calibration of the chosen printer set (or removed with null). */
export function withTrayOffset<S extends Pick<PrintSettings, 'printerName' | 'printerOffsets'>>(settings: S, tray: TrayKind, offset: PageOffset | null): S {
  const printer = settings.printerName ?? '';
  const trays = { ...(settings.printerOffsets?.[printer] ?? {}) };
  if (offset) trays[tray] = { x: tenth(offset.x), y: tenth(offset.y) };
  else delete trays[tray];
  return { ...settings, printerOffsets: { ...settings.printerOffsets, [printer]: trays } };
}

/** The page placement to print with: moved back by the printer's offset, so the ink lands where it belongs. */
export function calibratedPlacement(placement: Placement, offset: PageOffset | null): Placement {
  if (!offset) return placement;
  return { rotation: placement.rotation, x: tenth(placement.x - offset.x), y: tenth(placement.y - offset.y) };
}

/** The A4 calibration sheet: two scales through the middle of the page and how to read them. */
export function buildFoldSheetHtml(trayTitle: string): string {
  const cx = A4.width / 2;
  const cy = A4.height / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  const parts: string[] = [];
  const text = (x: number, y: number, s: string, size: number, opts = '') =>
    `<text x="${r(x)}" y="${r(y)}" font-size="${size}" font-family="Arial" ${opts}>${s}</text>`;
  const tickLen = (v: number) => (v % 5 === 0 ? 7 : v % 1 === 0 ? 4.5 : 2.5);
  // Numbers every 5 mm (+ to the right and down); the 1 mm and half-millimetre marks between them are counted.
  const label = (v: number) => (v > 0 ? `+${v}` : String(v));
  // Scale A: across the page (read on the left-to-right fold), twice so one is always clear of the hand.
  for (const y of [95, 205]) {
    parts.push(`<line x1="${cx - FOLD_SCALE_MM}" y1="${y}" x2="${cx + FOLD_SCALE_MM}" y2="${y}" stroke="#000" stroke-width="0.2"/>`);
    for (let v = -FOLD_SCALE_MM; v <= FOLD_SCALE_MM; v += 0.5) {
      parts.push(`<line x1="${r(cx + v)}" y1="${y}" x2="${r(cx + v)}" y2="${r(y - tickLen(v))}" stroke="#000" stroke-width="${v === 0 ? 0.35 : 0.12}"/>`);
      if (v % 5 === 0) parts.push(text(cx + v, y + 4.5, label(v), 2.5, `text-anchor="middle"${v === 0 ? ' font-weight="bold"' : ''}`));
    }
    parts.push(text(cx - FOLD_SCALE_MM - 9, y - 1, 'A', 6, 'font-weight="bold" fill="#c00000"'));
  }
  // Scale B: down the page (read on the top-to-bottom fold).
  for (const x of [55, 155]) {
    parts.push(`<line x1="${x}" y1="${cy - FOLD_SCALE_MM}" x2="${x}" y2="${cy + FOLD_SCALE_MM}" stroke="#000" stroke-width="0.2"/>`);
    for (let v = -FOLD_SCALE_MM; v <= FOLD_SCALE_MM; v += 0.5) {
      parts.push(`<line x1="${x}" y1="${r(cy + v)}" x2="${r(x + tickLen(v))}" y2="${r(cy + v)}" stroke="#000" stroke-width="${v === 0 ? 0.35 : 0.12}"/>`);
      if (v % 5 === 0) parts.push(text(x - 2, cy + v + 1, label(v), 2.5, `text-anchor="end"${v === 0 ? ' font-weight="bold"' : ''}`));
    }
    parts.push(text(x - 3, cy - FOLD_SCALE_MM - 4, 'B', 6, 'font-weight="bold" fill="#0050c8"'));
  }
  const lines = [
    `Printer calibration · ${trayTitle}`,
    '1. Fold this sheet in half from left to right: put the left edge exactly on the right edge and press the fold flat.',
    '   Where the fold crosses scale A, read the number: count the 1 mm and half-millimetre marks from the nearest number.',
    '2. Unfold. Fold the top edge exactly onto the bottom edge. Read scale B where the fold crosses it.',
    '3. Type both numbers in Settings, Printer calibration, for this tray. Do this once for each tray you use.',
  ];
  lines.forEach((l, i) => parts.push(text(18, 22 + i * 6, l, i === 0 ? 5 : 3.2, i === 0 ? 'font-weight="bold"' : '')));
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:210mm 297mm;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">${parts.join('')}</svg></body></html>`;
}

/** True when the chosen printer's front tray prints on the side facing up (set in Settings; most print facing down). */
export const frontFacesUp = (settings: Pick<PrintSettings, 'printerName' | 'frontTrayFaceUp'>) => settings.frontTrayFaceUp?.[settings.printerName ?? ''] === true;

/** Settings with the chosen printer's front tray printing on the side facing up (true) or down (false). */
export function withFrontFaceUp<S extends Pick<PrintSettings, 'printerName' | 'frontTrayFaceUp'>>(settings: S, up: boolean): S {
  return { ...settings, frontTrayFaceUp: { ...settings.frontTrayFaceUp, [settings.printerName ?? '']: up } };
}

/** How the chosen printer handles paper in a tray (the front drawer may print on the side facing up). */
export function trayGeometry(tray: TrayKind, settings: Pick<PrintSettings, 'printerName' | 'frontTrayFaceUp'>): TrayGeometry {
  return tray === 'front' && frontFacesUp(settings) ? 'front-up' : tray;
}

// ---------------------------------------------------------------------------------------------------------------------
// Where a cheque sits in the tray. A4 fills the tray, so the fold sheet cannot tell; a cheque is narrower and rests
// where the tray puts small paper: in the middle (guides close from both sides, e.g. Epson), or against one side
// (one fixed side and a sliding guide, e.g. HP ink tanks: right side). Set once per printer and tray.
// ---------------------------------------------------------------------------------------------------------------------

/** Where small paper sits in a tray, as seen standing in front of the printer. */
export type PaperSide = 'left' | 'centre' | 'right';

/** A position this close to the middle counts as centred (positions are stored centred). */
const CENTRED_MM = 0.6;

export const PAPER_SIDE_LABEL: Record<PaperSide, string> = { left: 'Left side', centre: 'Centre', right: 'Right side' };

interface SideRule {
  pattern: RegExp;
  trays: TrayKind[];
  side: PaperSide;
  reason: string;
}

// First match wins. These are starting guesses; the user confirms by looking at the tray.
const SIDE_RULES: SideRule[] = [
  { pattern: /smart ?tank|deskjet|envy|officejet|ink ?advantage|\bhp ink/i, trays: ['rear', 'front', 'manual'], side: 'right', reason: 'HP ink printers hold paper against the right side; the guide slides in from the left' },
  { pattern: /pixma|\bmg\d{4}|\bip\d{4}|\bts\d{4}/i, trays: ['rear'], side: 'right', reason: 'Canon PIXMA back trays usually hold paper against the right side' },
  { pattern: /epson|ecotank|\bet-\d|\bl\d{3,4}\b/i, trays: ['rear', 'front', 'manual'], side: 'centre', reason: 'Epson trays centre the paper between both guides' },
  { pattern: /canon g\d|\bg\d{4}\b/i, trays: ['rear'], side: 'centre', reason: 'Canon G-series guides close from both sides together' },
  { pattern: /laserjet|laser|brother|\bhl-|\b(dcp|mfc)-|kyocera|ricoh|xerox|lexmark|pantum|samsung/i, trays: ['rear', 'front', 'manual'], side: 'centre', reason: 'laser printer trays and slots centre the paper' },
];

/** The usual side for this printer and tray, with why; centre when the name says nothing useful. */
export function guessPaperSide(printerName: string, tray: TrayKind): { side: PaperSide; reason: string | null } {
  const rule = SIDE_RULES.find(r => r.trays.includes(tray) && r.pattern.test(printerName));
  return rule ? { side: rule.side, reason: rule.reason } : { side: 'centre', reason: null };
}

/** Where small paper sits in this tray of the chosen printer: the user's choice, else the guess. */
export function paperSide(settings: Pick<PrintSettings, 'printerName' | 'paperSide'>, tray: TrayKind): PaperSide {
  return settings.paperSide?.[settings.printerName ?? '']?.[tray] ?? guessPaperSide(settings.printerName ?? '', tray).side;
}

/** True when the user has chosen the side (not just the guess). */
export const paperSideChosen = (settings: Pick<PrintSettings, 'printerName' | 'paperSide'>, tray: TrayKind) =>
  Boolean(settings.paperSide?.[settings.printerName ?? '']?.[tray]);

export function withPaperSide<S extends Pick<PrintSettings, 'printerName' | 'paperSide'>>(settings: S, tray: TrayKind, side: PaperSide): S {
  const printer = settings.printerName ?? '';
  return { ...settings, paperSide: { ...settings.paperSide, [printer]: { ...(settings.paperSide?.[printer] ?? {}), [tray]: side } } };
}

/**
 * How far (mm across the page) a centred cheque moves when it rests against `side` instead. The cheque book's
 * positions are kept centred; this is added when printing and when drawing the tray, for any cheque size and turn.
 */
export function sideShiftX(layout: Pick<ChequeLayout, 'chequeWidth' | 'chequeHeight'>, tray: TrayGeometry, placement: Pick<Placement, 'rotation' | 'x'>, side: PaperSide): number {
  if (side === 'centre') return 0;
  const room = sheetFor(layout, placement.rotation).width - footprint(layout, placement.rotation)[0];
  // Only a centred position moves: one the user placed against a side on purpose stays where it is.
  if (room <= 0 || Math.abs(placement.x - room / 2) > CENTRED_MM) return 0;
  // Seen from the front, the right side is the page's left when the tray turns the page round (back tray, face-down drawer).
  const towardsPageRight = (side === 'right') !== TRAY_KINDS[tray].flipX;
  return tenth(towardsPageRight ? room / 2 : -room / 2);
}

/** The tray picture with the cheque resting where this tray puts small paper (positions are stored centred). */
export function viewOnSide(layout: ChequeLayout, tray: TrayGeometry, view: TrayView, side: PaperSide): TrayView {
  if (side === 'centre') return view;
  const room = sheetFor(layout, view.turn).width - footprint(layout, view.turn)[0];
  return Math.abs(view.u - room / 2) > CENTRED_MM ? view : alignTrayView(layout, tray, view, side);
}

/** Everything the printer needs on top of the cheque book's own position: where the tray puts the cheque, then the calibration. */
export function placementForPrinter(
  layout: Pick<ChequeLayout, 'chequeWidth' | 'chequeHeight'>,
  placement: Placement,
  tray: TrayKind,
  settings: Pick<PrintSettings, 'printerName' | 'printerOffsets' | 'paperSide' | 'frontTrayFaceUp'>,
): Placement {
  const dx = sideShiftX(layout, trayGeometry(tray, settings), placement, paperSide(settings, tray));
  return calibratedPlacement({ ...placement, x: tenth(placement.x + dx) }, trayOffset(settings, tray));
}

/** The tray this printer's cheques go in: the user's choice, else the usual one for the printer model, else the back tray. */
export function chequeTray(settings: Pick<PrintSettings, 'printerName' | 'chequeTray'>): TrayKind {
  return settings.chequeTray?.[settings.printerName ?? ''] ?? guessTray(settings.printerName ?? '')?.tray ?? 'rear';
}

export function withChequeTray<S extends Pick<PrintSettings, 'printerName' | 'chequeTray'>>(settings: S, tray: TrayKind): S {
  return { ...settings, chequeTray: { ...settings.chequeTray, [settings.printerName ?? '']: tray } };
}

export const TRAY_TITLE: Record<TrayKind, string> = { rear: 'Back tray', front: 'Front drawer', manual: 'Manual feed slot' };
