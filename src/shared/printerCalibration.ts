// Printer calibration: where a printer really puts its print on the page, measured once per tray by printing a sheet of
// A4, folding it in half each way and reading the scales at the folds. A fold is exactly in the middle of the paper, so
// no ruler is needed. The printer shifts every page the same way whatever is printed, so one calibration per tray puts
// every cheque in place: any bank, any size, horizontal or vertical (turning the cheque turns the shift with it).
import type { Placement, TrayGeometry, TrayKind } from './print';
import type { PrintSettings } from './types';

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
