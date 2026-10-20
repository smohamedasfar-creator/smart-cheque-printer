// Runs the print checks on real cheque layouts kept outside the repository.
// LAYOUTS_JSON=path/to/layouts.json npx vitest run tests/local   (a JSON object of name -> ChequeLayout)
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { renderCheque, PT_TO_MM } from '../../src/shared/chequeRender';
import { alignTrayView, defaultTrayView, pageGeometry, printProblems, trayToPage, TRAY_KINDS, type TrayKind } from '../../src/shared/print';
import { DEFAULT_SETTINGS, type ChequeLayout, type FeedRotation } from '../../src/shared/types';

const file = process.env.LAYOUTS_JSON;
const layouts: Record<string, ChequeLayout> = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const measure = (t: string, pt: number) => t.length * 0.55 * pt * PT_TO_MM;

describe.skipIf(!file)('real cheque layouts', () => {
  test.each(Object.keys(layouts))('%s prints inside the page in every tray, direction and guide position', name => {
    const layout = layouts[name];
    const problems: string[] = [];
    for (const tray of Object.keys(TRAY_KINDS) as TrayKind[]) {
      for (const turn of [0, 90, 180, 270] as FeedRotation[]) {
        for (const side of ['left', 'centre', 'right'] as const) {
          const p = trayToPage(layout, tray, alignTrayView(layout, tray, defaultTrayView(layout, tray, turn), side));
          const g = pageGeometry(layout, DEFAULT_SETTINGS, { rotation: p.rotation, x: p.x, y: p.y });
          const { items } = renderCheque(layout, { date: '2026-12-31', payee: 'Sample Payee Trading LLC', amountFils: 12_345_678, crossing: 'ac-payee-bearer' }, DEFAULT_SETTINGS, measure);
          for (const m of printProblems(items, g, measure)) problems.push(`${tray} ${turn} ${side}: ${m}`);
        }
      }
    }
    // Against a guide at the very edge of the page, text near the leaf's edge falls in the printer's margin: report it.
    const edge = problems.filter(m => m.includes('page edge'));
    if (edge.length) console.log(`${name}: ${edge.length} of 36 positions put text in the printer's edge margin, e.g. ${edge[0]}`);
    expect(problems.filter(m => !m.includes('page edge'))).toEqual([]);
  });

  test.each(Object.keys(layouts))('%s fits typical cheques at every text size without warnings', name => {
    for (const textSize of [8, 10, 12, 14, 16, 18, 20]) {
      for (const amountFils of [5_000, 12_345_678, 987_654_321]) {
        const { warnings } = renderCheque(layouts[name], { date: '2026-12-31', payee: 'Sample Payee Trading LLC', amountFils, crossing: 'ac-payee-bearer' }, { ...DEFAULT_SETTINGS, textSize }, measure);
        expect(warnings, `${textSize} pt, ${amountFils}`).toEqual([]);
      }
    }
  });
});
