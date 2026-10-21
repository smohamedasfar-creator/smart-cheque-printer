import { describe, expect, test } from 'vitest';
import { correctionFromCorner, graphStart, graphSvg, sizeFromCorners, withGraphStart } from '../src/shared/graph';
import { blankLayout } from '../src/shared/layoutDefaults';

const H = 87.21;

describe('graph coordinates (0, 0) at the bottom-left corner', () => {
  test('a field starts at the left end of its writing line, measured from the bottom-left corner', () => {
    // a payee box 43 mm from the left, its line (the box bottom) 46.3 mm above the bottom edge
    expect(graphStart({ x: 43, y: 34.9, width: 117, height: 6, fontPt: 12 }, H)).toEqual({ x: 43, y: 46.3, length: 117 });
  });

  test('typing X, Y or length moves the writing space and keeps its height', () => {
    const box = { x: 43, y: 34.9, width: 117, height: 6, fontPt: 12 };
    const moved = withGraphStart(box, H, { x: 40, y: 50 });
    expect(graphStart(moved, H)).toEqual({ x: 40, y: 50, length: 117 });
    expect(moved.height).toBe(6);
    expect(graphStart(withGraphStart(box, H, { length: 94 }), H).length).toBe(94);
  });
});

describe('printer fix from the printed graph', () => {
  const layout = blankLayout(205.74, 87.21);
  const placement = { rotation: 270 as const, x: 61.4, y: 0 };

  test('graph numbers 0, 0 on the paper corner mean nothing to move', () => {
    expect(correctionFromCorner(layout, placement, { x: 0, y: 0 })).toEqual(placement);
  });

  test('a corner reading of X -1.5 and Y 2 moves the print 1.5 mm left and 2 mm up on the cheque', () => {
    const fixed = correctionFromCorner(layout, placement, { x: -1.5, y: 2 });
    // date end first: the cheque's left-to-right runs up the page and its top-to-bottom runs right on the page
    expect(fixed).toEqual({ rotation: 270, x: 59.4, y: 1.5 });
  });

  test('two corners tell whether the printer prints at true size', () => {
    expect(sizeFromCorners(layout, { x: -1.5, y: 2 }, { x: 204.2, y: 89.2 })).toEqual({ x: 1, y: 1 });
    const shrunk = sizeFromCorners(layout, { x: 0, y: 0 }, { x: 261.7, y: 110.9 });
    expect(shrunk.x).toBeCloseTo(0.786, 2);
  });
});

describe('graph drawing', () => {
  test('draws mm lines, 1 cm lines and labels counted from the bottom-left corner, beyond the cheque edges', () => {
    const svg = graphSvg(205.74, 87.21);
    expect(svg).toContain('class="graph"');
    // the 0 lines sit on the left edge and on the bottom edge (y = 87.21 from the top)
    expect(svg).toMatch(/<line x1="0" y1="-?[\d.]+" x2="0"/);
    expect(svg).toMatch(/<line x1="-?[\d.]+" y1="87.21" x2="-?[\d.]+" y2="87.21"/);
    // labels below zero exist, so a print that landed off still shows its numbers on the paper corner
    expect(svg).toContain('>x -20<');
    expect(svg).toContain('>x 200<');
    expect(svg).toContain('>y 80<');
    expect(svg).toContain('>y -20<');
  });
});
