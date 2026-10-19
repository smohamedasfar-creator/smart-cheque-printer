import { describe, expect, test } from 'vitest';
import { buildCalibrationHtml, buildPrintHtml, chequesToCsv, nextChequeNo, pageGeometry, safeFontName } from '../src/shared/print';
import { digitDateLayout } from './fixtures';
import { DEFAULT_SETTINGS, type ChequeRecord, type RenderItem } from '../src/shared/types';

const layout = digitDateLayout();

describe('pageGeometry', () => {
  test('uses an A4 page by default', () => {
    expect(pageGeometry(layout, DEFAULT_SETTINGS)).toEqual({ pageWidth: 210, pageHeight: 297, originX: 3, originY: 0 });
  });

  test('can use a cheque-sized page', () => {
    expect(pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'cheque' })).toEqual({ pageWidth: 204, pageHeight: 94, originX: 0, originY: 0 });
  });

  test('centres the cheque on an A4 portrait page', () => {
    const g = pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'a4-portrait', feedAlign: 'center' });
    expect(g).toEqual({ pageWidth: 210, pageHeight: 297, originX: 3, originY: 0 });
  });

  test('aligns the cheque right or left on A4 landscape', () => {
    expect(pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'a4-landscape', feedAlign: 'right' }).originX).toBe(93);
    expect(pageGeometry(layout, { ...DEFAULT_SETTINGS, paper: 'a4-landscape', feedAlign: 'left' }).originX).toBe(0);
  });
});

describe('buildPrintHtml', () => {
  const items: RenderItem[] = [
    { kind: 'text', role: 'payee', text: 'A & B <Trading>', x: 10, y: 20, width: 50, height: 6, fontPt: 12, align: 'left', rotation: 0 },
    { kind: 'text', role: 'ac-payee', text: 'A/C PAYEE ONLY', x: 3, y: 1, width: 34, height: 26, fontPt: 8, align: 'center', rotation: 35 },
    { kind: 'line', x1: 0, y1: 10, x2: 20, y2: 0 },
  ];
  const geometry = { pageWidth: 210, pageHeight: 297, originX: 3, originY: 0 };

  test('sets the page size in millimetres', () => {
    expect(buildPrintHtml(items, geometry, { fontFamily: 'Arial' })).toContain('size: 210mm 297mm');
  });

  test('escapes text and positions items relative to the cheque origin', () => {
    const html = buildPrintHtml(items, geometry, { fontFamily: 'Arial' });
    expect(html).toContain('A &amp; B &lt;Trading&gt;');
    expect(html).toContain('left:13mm;top:20mm');
    expect(html).toContain('rotate(-35deg)');
    expect(html).toContain('<line x1="3" y1="10" x2="23" y2="0"');
  });

  test('draws the cheque outline and boxes only for test prints', () => {
    expect(buildPrintHtml(items, geometry, { fontFamily: 'Arial' })).not.toContain('class="guide"');
    const test = buildPrintHtml(items, geometry, { fontFamily: 'Arial', guides: { chequeWidth: 204, chequeHeight: 94, offsetX: 52, offsetY: 1.5 } });
    expect(test).toContain('class="guide"');
    expect(test).toContain('left:55mm;top:1.5mm;width:204mm;height:94mm');
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
    const html = buildPrintHtml([], { pageWidth: 210, pageHeight: 297, originX: 0, originY: 0 }, { fontFamily: 'Arial"</style><script>alert(1)</script>' });
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
