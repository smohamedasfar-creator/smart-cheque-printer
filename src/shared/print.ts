import type { ChequeLayout, ChequeRecord, FeedRotation, MeasureText, PagePlacement, PrintSettings, RenderItem, TextItem } from './types';

const A4 = { width: 210, height: 297 };

export interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
  /** Top-left corner of the paper's footprint on the page (where the calibration ruler readings point). */
  originX: number;
  originY: number;
  /** Turn applied to the cheque so it matches how it is fed into the printer. */
  rotation: FeedRotation;
  chequeWidth: number;
  chequeHeight: number;
}

/** Width and height a leaf covers on the page when fed with the given turn. */
export function footprint(layout: Pick<ChequeLayout, 'chequeWidth' | 'chequeHeight'>, rotation: FeedRotation): [number, number] {
  return rotation === 90 || rotation === 270 ? [layout.chequeHeight, layout.chequeWidth] : [layout.chequeWidth, layout.chequeHeight];
}

export const A4_PAGE = A4;

export function pageGeometry(layout: ChequeLayout, settings: PrintSettings, placement?: PagePlacement): PageGeometry {
  const { chequeWidth, chequeHeight } = layout;
  const rotation = placement?.rotation ?? settings.feedRotation ?? 0;
  // A cheque book's own print position prints exactly there, on A4 (or the sheet a wider cheque needs).
  if (placement && placement.x !== null && placement.y !== null) {
    const sheet = sheetFor(layout, rotation);
    return { rotation, chequeWidth, chequeHeight, pageWidth: sheet.width, pageHeight: sheet.height, originX: placement.x, originY: placement.y };
  }
  // Fed short edge first, the cheque covers its height across the page and its width down the page.
  const [footW, footH] = rotation === 90 || rotation === 270 ? [chequeHeight, chequeWidth] : [chequeWidth, chequeHeight];
  const base = { rotation, chequeWidth, chequeHeight };
  if (settings.paper === 'cheque') {
    return { ...base, pageWidth: footW, pageHeight: footH, originX: settings.offsetX, originY: settings.offsetY };
  }
  const [pageWidth, pageHeight] = settings.paper === 'a4-portrait' ? [A4.width, A4.height] : [A4.height, A4.width];
  // Each cheque is placed against the guide it is pushed to, so cheques of any size land correctly.
  const guide = settings.feedAlign;
  const edge = settings.feedEdgeMm ?? (guide === 'left' ? 0 : guide === 'right' ? pageWidth : pageWidth / 2);
  const left = guide === 'left' ? edge : guide === 'right' ? edge - footW : edge - footW / 2;
  return { ...base, pageWidth, pageHeight, originX: left + settings.offsetX, originY: settings.offsetY };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const round = (n: number) => Math.round(n * 100) / 100;

export interface PrintHtmlOptions {
  fontFamily: string;
  /** Test prints draw the cheque outline and each field box. */
  guides?: boolean;
  /** Alignment test: crosshairs at the corners and centre with their distances, to tell an offset from a scaling error. */
  marks?: boolean;
  /** Calibration dots in page millimetres (not turned with the cheque), for the scan-to-calibrate test print. */
  pageDots?: Array<{ x: number; y: number; size: number }>;
}

/** How far in from the cheque edges the corner marks sit: inside the area every printer can reach. */
export const MARK_INSET_MM = 8;

/** Crosshairs at the four corners and the centre of the cheque, in cheque millimetres, with the distances between them. */
export function alignmentMarks(w: number, h: number): { points: Array<{ x: number; y: number; label: string }>; across: number; down: number; svg: string } {
  const t = (v: number) => Math.round(v * 10) / 10;
  const i = MARK_INSET_MM;
  const [right, bottom, cx, cy] = [t(w - i), t(h - i), t(w / 2), t(h / 2)];
  const points = [
    { x: i, y: i, label: `${i}, ${i}` },
    { x: right, y: i, label: `${right}, ${i}` },
    { x: i, y: bottom, label: `${i}, ${bottom}` },
    { x: right, y: bottom, label: `${right}, ${bottom}` },
    { x: cx, y: cy, label: `centre ${cx}, ${cy}` },
  ];
  const across = t(right - i);
  const down = t(bottom - i);
  const stroke = 'stroke="#000" stroke-width="0.25"';
  const label = (x: number, y: number, text: string, anchor = 'start', extra = '') =>
    `<text x="${x}" y="${y}" font-size="2.4" text-anchor="${anchor}" ${extra}>${text}</text>`;
  const marks = points.map(p => {
    const right = p.x > w / 2 + 1;
    return `<g class="mark"><line x1="${p.x - 4}" y1="${p.y}" x2="${p.x + 4}" y2="${p.y}" ${stroke}/><line x1="${p.x}" y1="${p.y - 4}" x2="${p.x}" y2="${p.y + 4}" ${stroke}/><circle cx="${p.x}" cy="${p.y}" r="1.2" fill="none" ${stroke}/>${label(right ? p.x - 1.8 : p.x + 1.8, p.y - 1.8, p.label, right ? 'end' : 'start')}</g>`;
  });
  const dash = `${stroke} stroke-dasharray="1 1"`;
  const dims = [
    `<line x1="${i + 5}" y1="${i}" x2="${right - 5}" y2="${i}" ${dash}/>`,
    label(cx, i + 4, `${across} mm between these marks`, 'middle'),
    `<line x1="${i}" y1="${i + 5}" x2="${i}" y2="${bottom - 5}" ${dash}/>`,
    label(i + 4, cy + 12, `${down} mm`, 'start'),
    label(cx, bottom - 2.5, `Alignment test · cheque ${t(w)} × ${t(h)} mm · measure the gaps with a ruler`, 'middle'),
  ];
  return { points, across, down, svg: [...marks, ...dims].join('') };
}

/** Font names are user settings; keep only characters that are safe inside CSS. */
export const safeFontName = (name: string) => name.replace(/[^\w\s-]/g, '').trim() || 'Arial';

/** Print page: items are in cheque millimetres inside a box placed (and turned) where the paper sits on the page. */
export function buildPrintHtml(items: RenderItem[], g: PageGeometry, opts: PrintHtmlOptions): string {
  const w = round(g.chequeWidth);
  const h = round(g.chequeHeight);
  const body: string[] = [];
  const lines: string[] = [];

  for (const item of items) {
    if (item.kind === 'line') {
      lines.push(
        `<line x1="${round(item.x1)}" y1="${round(item.y1)}" x2="${round(item.x2)}" y2="${round(item.y2)}" stroke="#000" stroke-width="0.3"/>`,
      );
      continue;
    }
    const style = [
      `left:${round(item.x)}mm;top:${round(item.y)}mm`,
      `width:${round(item.width)}mm;height:${round(item.height)}mm`,
      `font-size:${round(item.fontPt)}pt;text-align:${item.align}`,
      item.rotation ? `transform:rotate(-${item.rotation}deg)` : '',
    ].filter(Boolean);
    const guide = opts.guides ? ' guide-box' : '';
    body.push(`<div class="f${guide}" style="${style.join(';')}">${escapeHtml(item.text)}</div>`);
  }

  if (opts.guides) body.unshift(`<div class="guide" style="left:0;top:0;width:${w}mm;height:${h}mm"></div>`);

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${round(g.pageWidth)}mm ${round(g.pageHeight)}mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { position: relative; width: ${round(g.pageWidth)}mm; height: ${round(g.pageHeight)}mm; overflow: hidden;
  font-family: "${safeFontName(opts.fontFamily)}", Arial, sans-serif; color: #000; }
.f { position: absolute; white-space: pre; line-height: 1.15; display: flex; align-items: center; }
.f[style*="text-align:center"] { justify-content: center; }
.f[style*="text-align:right"] { justify-content: flex-end; }
.f[style*="rotate"] { transform-origin: center; flex-direction: column; justify-content: center; }
.guide { position: absolute; border: 0.2mm dashed #999; box-sizing: border-box; }
.guide-box { outline: 0.1mm dotted #bbb; }
svg { position: absolute; left: 0; top: 0; overflow: visible; }
.cheque { position: absolute; transform-origin: 0 0; }
/* A turned cheque still takes its unturned width in layout. If that ran past the page edge, Chromium would shrink
   the whole page to fit (a 205 mm cheque fed date end first printed at 79%), so the page box clips everything. */
.page { position: absolute; left: 0; top: 0; width: ${round(g.pageWidth)}mm; height: ${round(g.pageHeight)}mm; overflow: hidden; }
</style></head><body>
<div class="page">
<div class="cheque" style="left:${round(g.originX)}mm;top:${round(g.originY)}mm;width:${w}mm;height:${h}mm;transform:${leafTransform(g.rotation, g.chequeWidth, g.chequeHeight, 'mm')}">
${body.join('\n')}
<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${lines.join('')}${opts.marks ? alignmentMarks(g.chequeWidth, g.chequeHeight).svg : ''}</svg>
</div>
${opts.pageDots?.length ? `<svg class="page-dots" width="${round(g.pageWidth)}mm" height="${round(g.pageHeight)}mm" viewBox="0 0 ${round(g.pageWidth)} ${round(g.pageHeight)}">${opts.pageDots.map(d => `<circle cx="${round(d.x)}" cy="${round(d.y)}" r="${round(d.size / 2)}" fill="#000"/>`).join('')}</svg>` : ''}
</div>
</body></html>`;
}

/** Where the rulers sit on the calibration page, in millimetres. */
export const CALIBRATION = {
  horizontalRulersY: [25, 45, 65],
  verticalRulersX: [35, 85, 135, 185],
  verticalRulerLength: 100,
};

function ruler(direction: 'h' | 'v', at: number, length: number): string {
  const parts: string[] = [];
  for (let mm = 0; mm <= length; mm++) {
    const tick = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.2;
    const [x1, y1, x2, y2] = direction === 'h' ? [mm, at, mm, at + tick] : [at, mm, at + tick, mm];
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${mm % 10 === 0 ? 0.3 : 0.15}"/>`);
    // Vertical labels are skipped where they would collide with a horizontal ruler's labels.
    const collides = direction === 'v' && CALIBRATION.horizontalRulersY.some(y => mm >= y - 2 && mm <= y + 9);
    if (mm % 10 === 0 && !collides) {
      const [tx, ty] = direction === 'h' ? [mm + 0.4, at + 7] : [at + 4.6, mm + 1.2];
      parts.push(`<text x="${tx}" y="${ty}" font-size="3">${mm}</text>`);
    }
  }
  const [x2, y2] = direction === 'h' ? [length, at] : [at, length];
  parts.push(`<line x1="${direction === 'h' ? 0 : at}" y1="${direction === 'h' ? at : 0}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="0.2"/>`);
  return parts.join('');
}

/**
 * An A4 page of millimetre rulers. Feed a cheque-sized paper exactly like a real cheque: the ruler numbers
 * at its left and top edges tell where this printer puts the cheque on the page.
 */
export function buildCalibrationHtml(): string {
  const { horizontalRulersY, verticalRulersX, verticalRulerLength } = CALIBRATION;
  const svg = [
    ...horizontalRulersY.map(y => ruler('h', y, A4.width)),
    ...verticalRulersX.map(x => ruler('v', x, verticalRulerLength)),
  ].join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${A4.width}mm ${A4.height}mm; margin: 0; }
html, body { margin: 0; padding: 0; }
body { position: relative; width: ${A4.width}mm; height: ${A4.height}mm; overflow: hidden; font-family: Arial, sans-serif; }
svg { position: absolute; left: 0; top: 0; }
.note { position: absolute; left: 15mm; top: 120mm; width: 180mm; font-size: 11pt; line-height: 1.5; }
</style></head><body>
<svg width="${A4.width}mm" height="${A4.height}mm" viewBox="0 0 ${A4.width} ${A4.height}">${svg}</svg>
<div class="note"><b>Smart Cheque Printer – printer calibration page.</b><br>
If you can read this, an A4 sheet was used. Print this page again with a cheque-sized paper fed exactly like a real cheque,
then read the ruler numbers at the cheque's left edge and top edge.</div>
</body></html>`;
}

/** Increments the trailing number of a cheque number, keeping its zero padding. */
export function nextChequeNo(current: string): string {
  const match = /^(.*?)(\d+)$/.exec(current);
  if (!match) return current;
  const [, prefix, digits] = match;
  return prefix + String(Number(digits) + 1).padStart(digits.length, '0');
}

// A leading = + - @ would make spreadsheet programs run the cell as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;
const csvCell = (v: string) => `"${(FORMULA_START.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

export function chequesToCsv(rows: ChequeRecord[], accountName: (id: number) => string): string {
  const header = 'Cheque No,Date,Payee,Amount,Account,Status,Remark\r\n';
  return (
    header +
    rows
      .map(r =>
        [r.chequeNo, r.date, r.payee, (r.amountFils / 100).toFixed(2), accountName(r.accountId), r.status, r.remark]
          .map(csvCell)
          .join(',') + '\r\n',
      )
      .join('')
  );
}
// ---------------------------------------------------------------------------------------------
// Print positions without numbers.
// 1. The user shows how the cheque sits in the tray on a picture of the tray (drag + turn).
// 2. After one test print, the user drags the preview text to where it actually printed.
// Both steps are converted here to the page placement the print engine uses.
// ---------------------------------------------------------------------------------------------

/** rear: paper stands at the back, printed side facing you, bottom edge goes in first.
 *  front: paper lies in a drawer/cassette, printed side down, far edge goes in first.
 *  manual: paper lies on a manual feed slot or bypass tray, printed side up, far edge goes in first. */
export type TrayKind = 'rear' | 'front' | 'manual';

interface TrayModel {
  /** The page's left-right and top-bottom are reversed compared with the tray picture. */
  flipX: boolean;
  flipY: boolean;
  /** The picture shows the printed side through the paper (it faces away from you). */
  mirrored: boolean;
  /** Picture turn of the cheque that prints with the given page rotation. */
  turnFor: (rotation: FeedRotation) => FeedRotation;
}

const turnBy = (r: number, by: number) => ((((r + by) % 360) + 360) % 360) as FeedRotation;

export const TRAY_KINDS: Record<TrayKind, TrayModel> = {
  rear: { flipX: true, flipY: true, mirrored: false, turnFor: r => turnBy(r, 180) },
  front: { flipX: true, flipY: false, mirrored: true, turnFor: r => r },
  manual: { flipX: false, flipY: false, mirrored: false, turnFor: r => r },
};

/** How the cheque looks in the tray picture: its turn and where its footprint's top-left sits (mm on the sheet picture). */
export interface TrayView {
  turn: FeedRotation;
  u: number;
  v: number;
}

export interface Placement {
  rotation: FeedRotation;
  x: number;
  y: number;
}

export interface Sheet {
  name: 'A4' | 'Letter' | 'Legal' | 'Custom';
  width: number;
  height: number;
}

const SHEETS: Sheet[] = [
  { name: 'A4', width: 210, height: 297 },
  { name: 'Letter', width: 215.9, height: 279.4 },
  { name: 'Legal', width: 215.9, height: 355.6 },
];

/** The page printed for a cheque fed this way: A4 when it fits (every driver has it), else Letter or Legal, else its own size. */
export function sheetFor(layout: Pick<ChequeLayout, 'chequeWidth' | 'chequeHeight'>, rotation: FeedRotation): Sheet {
  const [footW, footH] = footprint(layout, rotation);
  const fits = SHEETS.find(s => footW <= s.width + 1e-9 && footH <= s.height + 1e-9);
  if (fits) return fits;
  const up = (v: number) => Math.ceil(v * 10) / 10;
  return { name: 'Custom', width: up(footW), height: Math.max(up(footH), A4.height) };
}

/** CSS transform that turns a cheque-shaped box (w × h) so it fills its footprint from the top-left corner. */
export function leafTransform(rotation: FeedRotation, w: number, h: number, unit: 'mm' | 'px' | ''): string {
  const n = (v: number) => `${round(v)}${unit}`;
  switch (rotation) {
    case 90: return `translate(${n(h)}, 0) rotate(90deg)`;
    case 180: return `translate(${n(w)}, ${n(h)}) rotate(180deg)`;
    case 270: return `translate(0, ${n(w)}) rotate(-90deg)`;
    default: return 'none';
  }
}

/** Page position (mm) of a point on the cheque, for a leaf turned by `rotation` with its footprint at the origin. */
export function chequePointOnPage(layout: Pick<ChequeLayout, 'chequeWidth' | 'chequeHeight'>, rotation: FeedRotation, cx: number, cy: number): { x: number; y: number } {
  const w = layout.chequeWidth;
  const h = layout.chequeHeight;
  switch (rotation) {
    case 90: return { x: h - cy, y: cx };
    case 180: return { x: w - cx, y: h - cy };
    case 270: return { x: cy, y: w - cx };
    default: return { x: cx, y: cy };
  }
}

const tenth = (v: number) => Math.round(v * 10) / 10 || 0;

/** Converts what the user showed on the tray picture into the page placement. */
export function trayToPage(layout: ChequeLayout, tray: TrayKind, view: TrayView): Placement {
  const m = TRAY_KINDS[tray];
  const sheet = sheetFor(layout, view.turn);
  const [footW, footH] = footprint(layout, view.turn);
  return {
    rotation: m.flipY ? turnBy(view.turn, 180) : view.turn,
    x: tenth(m.flipX ? sheet.width - view.u - footW : view.u),
    y: tenth(m.flipY ? sheet.height - view.v - footH : view.v),
  };
}

/** The tray picture for a saved placement (inverse of trayToPage). */
export function pageToTray(layout: ChequeLayout, tray: TrayKind, p: Placement): TrayView {
  const m = TRAY_KINDS[tray];
  const turn = m.flipY ? turnBy(p.rotation, 180) : p.rotation;
  const sheet = sheetFor(layout, turn);
  const [footW, footH] = footprint(layout, turn);
  return {
    turn,
    u: tenth(m.flipX ? sheet.width - p.x - footW : p.x),
    v: tenth(m.flipY ? sheet.height - p.y - footH : p.y),
  };
}

/** Starting picture: cheque pushed fully into the tray and centred. */
export function defaultTrayView(layout: ChequeLayout, tray: TrayKind, turn: FeedRotation): TrayView {
  const sheet = sheetFor(layout, turn);
  const [footW, footH] = footprint(layout, turn);
  return { turn, u: (sheet.width - footW) / 2, v: TRAY_KINDS[tray].flipY ? sheet.height - footH : 0 };
}

/** Lines the cheque up with the tray's left guide, its centre or its right guide, as seen on the tray picture. */
export function alignTrayView(layout: ChequeLayout, tray: TrayKind, view: TrayView, side: 'left' | 'centre' | 'right'): TrayView {
  const sheet = sheetFor(layout, view.turn);
  const [footW] = footprint(layout, view.turn);
  const room = sheet.width - footW;
  return { ...view, u: side === 'left' ? 0 : side === 'right' ? room : room / 2 };
}

/**
 * The test print landed (dx, dy) mm away from where it should be, measured on the cheque as you read it
 * (positive = right / down). Returns the placement that prints in the right place next time.
 */
export function correctPlacement(layout: ChequeLayout, p: Placement, dx: number, dy: number): Placement {
  const o = chequePointOnPage(layout, p.rotation, 0, 0);
  const d = chequePointOnPage(layout, p.rotation, dx, dy);
  return { rotation: p.rotation, x: tenth(p.x - (d.x - o.x)), y: tenth(p.y - (d.y - o.y)) };
}

/** The test print came out upside down on the cheque: turn it half round in the same spot. */
export function flipPlacement(p: Placement): Placement {
  return { ...p, rotation: turnBy(p.rotation, 180) };
}

/** Which end of the cheque goes into the printer first, in plain words. */
export const LEADING_EDGE: Record<FeedRotation, string> = {
  0: 'Top edge goes in first',
  90: 'Logo end goes in first',
  180: 'Bottom edge goes in first',
  270: 'Date end goes in first',
};

/** Most printers cannot print this close to the page edge (borderless printing is off for cheques). */
export const UNPRINTABLE_EDGE_MM = 3;

const CHECKED_ROLES: Partial<Record<TextItem['role'], string>> = { date: 'Date', payee: 'Payee', words: 'Amount in words', amount: 'Amount' };

/** The part of a text box the text really covers, when it can be measured (left, centred or right in its box). */
function inkSpan(item: TextItem, measure?: MeasureText): [number, number] {
  if (!measure) return [item.x, item.x + item.width];
  // Text wider than its box still prints in full (it is never wrapped), so use its real width.
  const w = measure(item.text, item.fontPt);
  const start = item.align === 'right' ? item.x + item.width - w : item.align === 'center' ? item.x + (item.width - w) / 2 : item.x;
  return [start, start + w];
}

/** Problems with where the cheque's text lands on the printed page: off the page, or in the edge the printer cannot reach. */
export function printProblems(items: RenderItem[], g: PageGeometry, measure?: MeasureText): string[] {
  const off = new Set<string>();
  const edge = new Set<string>();
  const leaf = new Set<string>();
  for (const item of items) {
    const label = item.kind === 'text' ? CHECKED_ROLES[item.role] : undefined;
    if (item.kind !== 'text' || !label || !item.text.trim()) continue;
    const [left, right] = inkSpan(item, measure);
    if (left < -0.05 || right > g.chequeWidth + 0.05) leaf.add(label);
    const [a, b] = [[left, item.y], [right, item.y + item.height]].map(([cx, cy]) => chequePointOnPage(g, g.rotation, cx, cy));
    const x1 = Math.min(a.x, b.x) + g.originX;
    const x2 = Math.max(a.x, b.x) + g.originX;
    const y1 = Math.min(a.y, b.y) + g.originY;
    const y2 = Math.max(a.y, b.y) + g.originY;
    const slack = 0.05;
    if (x1 < -slack || y1 < -slack || x2 > g.pageWidth + slack || y2 > g.pageHeight + slack) off.add(label);
    else if (x1 < UNPRINTABLE_EDGE_MM || y1 < UNPRINTABLE_EDGE_MM || x2 > g.pageWidth - UNPRINTABLE_EDGE_MM || y2 > g.pageHeight - UNPRINTABLE_EDGE_MM) edge.add(label);
  }
  const list = (s: Set<string>) => [...s].join(', ');
  return [
    leaf.size ? `${list(leaf)} would print past the edge of the cheque. Shorten the text or move it back in the cheque layout.` : '',
    off.size ? `${list(off)} would print off the page. Check the print position (tray and which end goes in first).` : '',
    edge.size ? `${list(edge)} is within ${UNPRINTABLE_EDGE_MM} mm of the page edge, where most printers cannot print, and may be cut off.` : '',
  ].filter(Boolean);
}
