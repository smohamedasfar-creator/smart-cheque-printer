import { describe, expect, test } from 'vitest';
import { alignmentMarks, buildCalibrationHtml, buildPrintHtml, chequePointOnPage, correctPlacement, defaultTrayView, flipPlacement, pageToTray, trayToPage, chequesToCsv, footprint, LEADING_EDGE, nextChequeNo, pageGeometry, safeFontName } from '../src/shared/print';
import { digitDateLayout } from './fixtures';
import { DEFAULT_SETTINGS, type ChequeRecord, type RenderItem } from '../src/shared/types';

const layout = digitDateLayout();

describe('pageGeometry', () => {
  const box = { rotation: 0, chequeWidth: 204, chequeHeight: 94 };

  test('uses an A4 page by default', () => {
    expect(pageGeometry(layout, DEFAULT_SETTINGS)).toEqual({ ...box, pageWidth: 210, pageHeight: 297, originX: 3, originY: 0 });
  });

  test('can use a cheque-sized page', () => {
    expect(pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'cheque' })).toEqual({ ...box, pageWidth: 204, pageHeight: 94, originX: 0, originY: 0 });
  });

  test('aligns the cheque right or left on A4 landscape', () => {
    expect(pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'a4-landscape', feedAlign: 'right' }).originX).toBe(93);
    expect(pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'a4-landscape', feedAlign: 'left' }).originX).toBe(0);
  });

  test('places each cheque size against the calibrated guide', () => {
    const right = { ...DEFAULT_SETTINGS, feedAlign: 'right' as const, feedEdgeMm: 209.6, offsetY: 1 };
    expect(pageGeometry(layout, right).originX).toBeCloseTo(209.6 - 204);
    const narrow = { ...layout, chequeWidth: 158, chequeHeight: 80 };
    expect(pageGeometry(narrow, right).originX).toBeCloseTo(209.6 - 158);
    // fed vertically, the footprint across the page is the cheque height
    expect(pageGeometry(narrow, { ...right, feedRotation: 270 }).originX).toBeCloseTo(209.6 - 80);
    expect(pageGeometry(layout, { ...right, feedRotation: 270 }).originX).toBeCloseTo(209.6 - 94);
    expect(pageGeometry(narrow, right).originY).toBe(1);
  });

  test('centred and left guides use the centre line and the left edge', () => {
    const narrow = { ...layout, chequeWidth: 158, chequeHeight: 80 };
    expect(pageGeometry(narrow, { ...DEFAULT_SETTINGS, feedAlign: 'center', feedEdgeMm: 105 }).originX).toBe(105 - 79);
    expect(pageGeometry(narrow, { ...DEFAULT_SETTINGS, feedAlign: 'left', feedEdgeMm: 3 }).originX).toBe(3);
  });

  test('a cheque book placed on the page preview prints exactly there', () => {
    const g = pageGeometry(layout, { ...DEFAULT_SETTINGS, feedRotation: 0 }, { rotation: 270, x: 61.5, y: 2 });
    expect(g).toMatchObject({ rotation: 270, originX: 61.5, originY: 2, pageWidth: 210, pageHeight: 297 });
  });

  test('a cheque book with only a feed direction uses the printer calibration for position', () => {
    const settings = { ...DEFAULT_SETTINGS, feedAlign: 'right' as const, feedEdgeMm: 209.6 };
    const g = pageGeometry(layout, settings, { rotation: 90, x: null, y: null });
    expect(g.rotation).toBe(90);
    expect(g.originX).toBeCloseTo(209.6 - 94);
  });

  test('footprint swaps width and height for vertical feeding', () => {
    expect(footprint(layout, 0)).toEqual([204, 94]);
    expect(footprint(layout, 270)).toEqual([94, 204]);
  });

  test('keeps working with an older left-edge calibration', () => {
    const g = pageGeometry(layout, { ...DEFAULT_SETTINGS, feedAlign: 'left', offsetX: 52, offsetY: 1.5 });
    expect([g.originX, g.originY]).toEqual([52, 1.5]);
  });

  test('a cheque fed short edge first covers its height across the page', () => {
    const g = pageGeometry(layout, { ...DEFAULT_SETTINGS, feedAlign: 'center', feedRotation: 90 });
    expect(g.rotation).toBe(90);
    expect(g.originX).toBe((210 - 94) / 2);
    const cheque = pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'cheque', feedRotation: 270 });
    expect([cheque.pageWidth, cheque.pageHeight]).toEqual([94, 204]);
  });
});

describe('buildPrintHtml', () => {
  const items: RenderItem[] = [
    { kind: 'text', role: 'payee', text: 'A & B <Trading>', x: 10, y: 20, width: 50, height: 6, fontPt: 12, align: 'left', rotation: 0 },
    { kind: 'text', role: 'ac-payee', text: 'A/C PAYEE ONLY', x: 3, y: 1, width: 34, height: 26, fontPt: 8, align: 'center', rotation: 35 },
    { kind: 'line', x1: 0, y1: 10, x2: 20, y2: 0 },
  ];
  const geometry = { pageWidth: 210, pageHeight: 297, originX: 3, originY: 0, rotation: 0 as const, chequeWidth: 204, chequeHeight: 94 };

  test('sets the page size in millimetres', () => {
    expect(buildPrintHtml(items, geometry, { fontFamily: 'Arial' })).toContain('size: 210mm 297mm');
  });

  test('places the cheque box at the origin and items inside it in cheque millimetres', () => {
    const html = buildPrintHtml(items, geometry, { fontFamily: 'Arial' });
    expect(html).toContain('class="cheque" style="left:3mm;top:0mm;width:204mm;height:94mm;transform:none"');
    expect(html).toContain('A &amp; B &lt;Trading&gt;');
    expect(html).toContain('left:10mm;top:20mm');
    expect(html).toContain('rotate(-35deg)');
    expect(html).toContain('<line x1="0" y1="10" x2="20" y2="0"');
  });

  test('turns the cheque for each feed direction so it stays in its footprint', () => {
    const turned = (rotation: 0 | 90 | 180 | 270) => buildPrintHtml(items, { ...geometry, rotation }, { fontFamily: 'Arial' });
    expect(turned(90)).toContain('transform:translate(94mm, 0) rotate(90deg)');
    expect(turned(180)).toContain('transform:translate(204mm, 94mm) rotate(180deg)');
    expect(turned(270)).toContain('transform:translate(0, 204mm) rotate(-90deg)');
  });

  test('draws the cheque outline and boxes only for test prints', () => {
    expect(buildPrintHtml(items, geometry, { fontFamily: 'Arial' })).not.toContain('class="guide"');
    const test = buildPrintHtml(items, geometry, { fontFamily: 'Arial', guides: true });
    expect(test).toContain('class="guide" style="left:0;top:0;width:204mm;height:94mm"');
  });
});

describe('buildCalibrationHtml', () => {
  test('prints millimetre rulers on an A4 page', () => {
    const html = buildCalibrationHtml();
    expect(html).toContain('size: 210mm 297mm');
    // horizontal rulers are labelled every 10 mm across the full width
    for (const n of [0, 50, 100, 150, 200]) expect(html).toContain(`>${n}</text>`);
    // vertical rulers skip labels that would sit on a horizontal ruler (30, 50, 70)
    expect(html.match(/<text/g)?.length).toBe(3 * 22 + 4 * 8);
  });
});

describe('nextChequeNo', () => {
  test('increments and keeps zero padding', () => {
    expect(nextChequeNo('000123')).toBe('000124');
    expect(nextChequeNo('999')).toBe('1000');
    expect(nextChequeNo('')).toBe('');
    expect(nextChequeNo('AB12')).toBe('AB13');
    expect(nextChequeNo('ABC')).toBe('ABC');
  });
});

describe('safety', () => {
  test('font names cannot break out of the print page style', () => {
    const html = buildPrintHtml([], { pageWidth: 210, pageHeight: 297, originX: 0, originY: 0, rotation: 0, chequeWidth: 204, chequeHeight: 94 }, { fontFamily: 'Arial"</style><script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('font-family: "Arialstylescriptalert1script"');
    expect(safeFontName('  ')).toBe('Arial');
  });

  test('CSV cells cannot start a spreadsheet formula', () => {
    const row = { id: 1, accountId: 1, chequeNo: '1', date: '2026-10-19', payee: '=HYPERLINK("x")', amountFils: 100, crossing: 'none' as const, remark: '+1', status: 'printed' as const, createdAt: '' };
    const csv = chequesToCsv([row], () => '@acct');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"'@acct"`);
    expect(csv).toContain(`"'+1"`);
  });
});

describe('chequesToCsv', () => {
  test('writes a header and quoted rows', () => {
    const rows: ChequeRecord[] = [
      {
        id: 1, accountId: 1, chequeNo: '000124', date: '2026-10-19', payee: 'Acme "Gulf", LLC',
        amountFils: 125050, crossing: 'ac-payee', remark: '', status: 'printed', createdAt: '2026-10-19T10:00:00Z',
      },
    ];
    expect(chequesToCsv(rows, id => (id === 1 ? 'FAB Main' : ''))).toBe(
      'Cheque No,Date,Payee,Amount,Account,Status,Remark\r\n' +
        '"000124","2026-10-19","Acme ""Gulf"", LLC","1250.50","FAB Main","printed",""\r\n',
    );
  });
});

describe('print positions without numbers', () => {
  const leaf = { ...layout, chequeWidth: 205.74, chequeHeight: 87.21 };
  const rotations = [0, 90, 180, 270] as const;

  test('back tray, cheque standing centred with the date end down, prints date end first at the page top', () => {
    // As seen from the front: logo end up, top edge on the right = picture turned 90°.
    const p = trayToPage(leaf, 'rear', defaultTrayView(leaf, 'rear', 90));
    expect(p).toEqual({ rotation: 270, x: 61.4, y: 0 });
  });

  test('front drawer, cheque centred and pushed in, prints with the top edge first', () => {
    const p = trayToPage(leaf, 'front', defaultTrayView(leaf, 'front', 0));
    expect(p.rotation).toBe(0);
    expect(p.x).toBeCloseTo(2.1, 0);
    expect(p.y).toBe(0);
  });

  test.each(rotations)('tray picture and page placement convert both ways (turn %i)', turn => {
    for (const tray of ['rear', 'front'] as const) {
      const view = { turn, u: 20, v: 15 };
      expect(pageToTray(leaf, tray, trayToPage(leaf, tray, view))).toEqual(view);
    }
  });

  test.each(rotations)('a drag correction moves the next print back by exactly that much on the cheque (turn %i)', rotation => {
    const p = { rotation, x: 61.4, y: 0 };
    const fixed = correctPlacement(leaf, p, 3, -20);
    // A cheque point printed with the fixed placement lands (−3, +20) mm from where the old one put it.
    const before = chequePointOnPage(leaf, rotation, 50, 40);
    const after = chequePointOnPage(leaf, rotation, 50 - 3, 40 + 20);
    expect(fixed.x + before.x).toBeCloseTo(p.x + after.x, 5);
    expect(fixed.y + before.y).toBeCloseTo(p.y + after.y, 5);
  });

  test('the RAK test print that landed 20 mm too high moves 20 mm across the page', () => {
    expect(correctPlacement(leaf, { rotation: 270, x: 61.4, y: 0 }, 0, -20)).toEqual({ rotation: 270, x: 81.4, y: 0 });
  });

  test('upside-down fix turns the cheque round in the same spot', () => {
    expect(flipPlacement({ rotation: 90, x: 61.4, y: 0 })).toEqual({ rotation: 270, x: 61.4, y: 0 });
  });

  test('every direction has a plain-words name', () => {
    for (const r of rotations) expect(LEADING_EDGE[r]).toMatch(/first/);
  });
});

describe('alignment marks', () => {
  const geometry = { pageWidth: 210, pageHeight: 297, originX: 61.4, originY: 0, rotation: 270 as const, chequeWidth: 205.74, chequeHeight: 87.21 };

  test('crosshairs at the four corners (8 mm in) and the centre, labelled in cheque millimetres', () => {
    const marks = alignmentMarks(205.74, 87.21);
    expect(marks.points).toEqual([
      { x: 8, y: 8, label: '8, 8' },
      { x: 197.7, y: 8, label: '197.7, 8' },
      { x: 8, y: 79.2, label: '8, 79.2' },
      { x: 197.7, y: 79.2, label: '197.7, 79.2' },
      { x: 102.9, y: 43.6, label: 'centre 102.9, 43.6' },
    ]);
    expect(marks.across).toBe(189.7);
    expect(marks.down).toBe(71.2);
    expect(marks.svg).toContain('189.7 mm');
    expect(marks.svg).toContain('71.2 mm');
    expect(marks.svg.match(/class="mark"/g)?.length).toBe(5);
  });

  test('are printed only when asked for, inside the turned cheque', () => {
    expect(buildPrintHtml([], geometry, { fontFamily: 'Arial' })).not.toContain('class="mark"');
    const html = buildPrintHtml([], geometry, { fontFamily: 'Arial', marks: true });
    expect(html).toContain('class="mark"');
    expect(html.indexOf('class="mark"')).toBeGreaterThan(html.indexOf('class="cheque"'));
  });

  test('the page box clips, so a turned cheque never makes the browser shrink the page', () => {
    const html = buildPrintHtml([], geometry, { fontFamily: 'Arial' });
    expect(html).toMatch(/\.page \{[^}]*overflow: hidden/);
    expect(html.indexOf('class="page"')).toBeLessThan(html.indexOf('class="cheque"'));
  });
});
