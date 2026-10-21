// The cheque as graph paper: (0, 0) is its bottom-left corner, X runs right and Y runs up, in millimetres.
// A writing space starts at the left end of its line (the bottom of its box). The printed graph tells, by the numbers
// that land on the paper's bottom-left corner, how far the printer put the print off.
import { correctPlacement, type Placement } from './print';
import type { ChequeLayout, FieldBox } from './types';

const tenth = (v: number) => Math.round(v * 10) / 10 || 0;

export interface GraphPoint {
  /** mm from the cheque's left edge */
  x: number;
  /** mm from the cheque's bottom edge */
  y: number;
}

/** Where a writing space starts on the graph and how long its line is. */
export function graphStart(box: FieldBox, chequeHeight: number): GraphPoint & { length: number } {
  return { x: tenth(box.x), y: tenth(chequeHeight - (box.y + box.height)), length: tenth(box.width) };
}

/** The writing space moved to start at a typed X / Y, or with a typed line length. Its height stays. */
export function withGraphStart(box: FieldBox, chequeHeight: number, next: Partial<GraphPoint & { length: number }>): FieldBox {
  const now = graphStart(box, chequeHeight);
  const x = next.x ?? now.x;
  const y = next.y ?? now.y;
  return { ...box, x: tenth(x), y: tenth(chequeHeight - y - box.height), width: tenth(Math.max(1, next.length ?? box.width)) };
}

/**
 * The print position after reading the printed graph: `corner` holds the graph numbers that landed on the paper's
 * bottom-left corner. Graph point (x, y) belongs x mm right of and y mm above that corner, so the whole print landed
 * x mm too far left and y mm too far down (on the cheque as you read it), and is moved back by that.
 */
export function correctionFromCorner(layout: ChequeLayout, placement: Placement, corner: GraphPoint): Placement {
  // Graph point (x, y) should be at cheque (x, H - y) from the top-left; it landed on the corner (0, H).
  return correctPlacement(layout, placement, -corner.x, corner.y);
}

/** Printed size compared with true size (1 = exact), from the graph numbers on the bottom-left and top-right corners. */
export function sizeFromCorners(layout: ChequeLayout, bottomLeft: GraphPoint, topRight: GraphPoint): GraphPoint {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r(layout.chequeWidth / (topRight.x - bottomLeft.x)), y: r(layout.chequeHeight / (topRight.y - bottomLeft.y)) };
}

/** Printed colours of the X and Y numbers on the graph. */
export const X_COLOUR = '#c00000';
export const Y_COLOUR = '#0050c8';

/** How far beyond the cheque the graph is drawn, so a print that landed off still covers the paper's corners. */
export const GRAPH_MARGIN_MM = 30;

/**
 * Graph paper in cheque millimetres (SVG drawn inside the cheque box, y down): thin lines every mm, stronger every
 * 5 mm, dark every 10 mm with their numbers, counted from the bottom-left corner. Labels repeat every 20 mm so some
 * are always near the paper's corner.
 */
export function graphSvg(w: number, h: number): string {
  const m = GRAPH_MARGIN_MM;
  const r = (v: number) => Math.round(v * 100) / 100;
  const [xMin, xMax, yMin, yMax] = [-m, Math.ceil(w) + m, -m, Math.ceil(h) + m]; // graph units (y up)
  const toY = (gy: number) => r(h - gy);
  const parts: string[] = [];
  const style = (v: number) =>
    v % 10 === 0 ? 'stroke="#000" stroke-width="0.25"' : v % 5 === 0 ? 'stroke="#666" stroke-width="0.15"' : 'stroke="#aaa" stroke-width="0.08"';
  for (let gx = xMin; gx <= xMax; gx++) parts.push(`<line x1="${gx}" y1="${toY(yMax)}" x2="${gx}" y2="${toY(yMin)}" ${style(gx)}/>`);
  for (let gy = yMin; gy <= yMax; gy++) parts.push(`<line x1="${xMin}" y1="${toY(gy)}" x2="${xMax}" y2="${toY(gy)}" ${style(gy)}/>`);
  const label = (x: number, y: number, text: string, colour: string) =>
    `<text x="${r(x)}" y="${r(y)}" font-size="2.2" font-family="Arial" font-weight="bold" fill="${colour}" stroke="#fff" stroke-width="0.6" paint-order="stroke">${text}</text>`;
  // X numbers (red) just right of each vertical cm line and just below a horizontal one; Y numbers (blue) mid-cell
  // just above a horizontal cm line. One sits below the line and the other above, so they never overlap.
  for (let gx = Math.ceil(xMin / 10) * 10; gx <= xMax; gx += 10)
    for (let gy = Math.ceil(yMin / 20) * 20; gy <= yMax; gy += 20) parts.push(label(gx + 0.4, toY(gy) + 2.4, `x ${gx}`, X_COLOUR));
  for (let gy = Math.ceil(yMin / 10) * 10; gy <= yMax; gy += 10)
    for (let gx = Math.ceil(xMin / 20) * 20; gx <= xMax; gx += 20) parts.push(label(gx + 5, toY(gy) - 0.6, `y ${gy}`, Y_COLOUR));
  return `<g class="graph">${parts.join('')}</g>`;
}
