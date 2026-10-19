import type { ChequeLayout, ChequeRecord, PrintSettings, RenderItem } from './types';

const A4 = { width: 210, height: 297 };

export interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
  /** Position of the cheque's top-left corner on the page. */
  originX: number;
  originY: number;
}

export function pageGeometry(layout: ChequeLayout, settings: PrintSettings): PageGeometry {
  const { chequeWidth, chequeHeight } = layout;
  if (settings.paper === 'cheque') return { pageWidth: chequeWidth, pageHeight: chequeHeight, originX: 0, originY: 0 };

  const [pageWidth, pageHeight] = settings.paper === 'a4-portrait' ? [A4.width, A4.height] : [A4.height, A4.width];
  const spare = pageWidth - chequeWidth;
  const originX = settings.feedAlign === 'left' ? 0 : settings.feedAlign === 'right' ? spare : spare / 2;
  return { pageWidth, pageHeight, originX, originY: 0 };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const round = (n: number) => Math.round(n * 100) / 100;

export interface PrintHtmlOptions {
  fontFamily: string;
  /** Test prints draw the cheque outline (at the same shift as the text) and each field box. */
  guides?: { chequeWidth: number; chequeHeight: number; offsetX: number; offsetY: number };
}

/** Font names are user settings; keep only characters that are safe inside CSS. */
export const safeFontName = (name: string) => name.replace(/[^\w\s-]/g, '').trim() || 'Arial';

export function buildPrintHtml(items: RenderItem[], g: PageGeometry, opts: PrintHtmlOptions): string {
  const ox = g.originX;
  const oy = g.originY;
  const body: string[] = [];
  const lines: string[] = [];

  for (const item of items) {
    if (item.kind === 'line') {
      lines.push(
        `<line x1="${round(item.x1 + ox)}" y1="${round(item.y1 + oy)}" x2="${round(item.x2 + ox)}" y2="${round(item.y2 + oy)}" stroke="#000" stroke-width="0.3"/>`,
      );
      continue;
    }
    const style = [
      `left:${round(item.x + ox)}mm;top:${round(item.y + oy)}mm`,
      `width:${round(item.width)}mm;height:${round(item.height)}mm`,
      `font-size:${round(item.fontPt)}pt;text-align:${item.align}`,
      item.rotation ? `transform:rotate(-${item.rotation}deg)` : '',
    ].filter(Boolean);
    const guide = opts.guides ? ' guide-box' : '';
    body.push(`<div class="f${guide}" style="${style.join(';')}">${escapeHtml(item.text)}</div>`);
  }

  if (opts.guides) {
    body.unshift(
      `<div class="guide" style="left:${round(ox + opts.guides.offsetX)}mm;top:${round(oy + opts.guides.offsetY)}mm;width:${opts.guides.chequeWidth}mm;height:${opts.guides.chequeHeight}mm"></div>`,
    );
  }

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
</style></head><body>
${body.join('\n')}
<svg width="${round(g.pageWidth)}mm" height="${round(g.pageHeight)}mm" viewBox="0 0 ${round(g.pageWidth)} ${round(g.pageHeight)}">${lines.join('')}</svg>
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
