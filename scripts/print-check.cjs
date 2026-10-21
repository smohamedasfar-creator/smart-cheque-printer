// Virtual printer: prints real PDFs through Chromium's print engine (the same one that drives the printer) and
// measures where every field lands and how big its text is, for every tray, feed direction, cheque size and position.
// Catches anything the print engine does that a screen render does not, such as shrinking a page to fit.
// Usage: npm run build:main && npx electron scripts/print-check.cjs [outDir]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'dist', 'main', 'shared');
const P = require(path.join(shared, 'print.js'));
const { renderCheque, PT_TO_MM } = require(path.join(shared, 'chequeRender.js'));
const { blankLayout } = require(path.join(shared, 'layoutDefaults.js'));
const { DEFAULT_SETTINGS } = require(path.join(shared, 'types.js'));
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : null;

const SIZES = [[152, 70], [157.65, 79.93], [178, 89], [205.74, 87.21], [215.9, 88.9]];
const SIDES = ['left', 'centre', 'right'];
const SAMPLE = { date: '2026-12-31', payee: 'Sample Payee Trading LLC', amountFils: 1_234_567, crossing: 'ac-payee-bearer' };
const measure = (t, pt) => t.length * 0.55 * pt * PT_TO_MM;
const MM_PER_PT = 25.4 / 72;
/** Allowed error in mm: under half a millimetre, well below what an eye notices on a cheque. */
const TOLERANCE_MM = 0.5;

async function pdfText(pdfjs, data) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const [, , wPt, hPt] = page.view;
  const { items } = await page.getTextContent();
  await task.destroy();
  return {
    width: wPt * MM_PER_PT,
    height: hPt * MM_PER_PT,
    items: items.filter(i => i.str.trim()).map(i => ({
      text: i.str,
      x: i.transform[4] * MM_PER_PT,
      y: (hPt - i.transform[5]) * MM_PER_PT,
      size: Math.hypot(i.transform[0], i.transform[1]) * MM_PER_PT,
    })),
  };
}

/** The page rectangle (mm) a text box covers once the cheque is turned and placed. */
function pageRect(layout, g, item) {
  const a = P.chequePointOnPage(layout, g.rotation, item.x, item.y);
  const b = P.chequePointOnPage(layout, g.rotation, item.x + item.width, item.y + item.height);
  return { x1: Math.min(a.x, b.x) + g.originX, x2: Math.max(a.x, b.x) + g.originX, y1: Math.min(a.y, b.y) + g.originY, y2: Math.max(a.y, b.y) + g.originY };
}

app.on('window-all-closed', () => {});
app.whenReady().then(check).catch(err => {
  console.error(err);
  app.exit(2);
});

async function check() {
  const pdfjs = await import(pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  const failures = [];
  let pages = 0;
  let fields = 0;
  let worst = 0;
  for (const tray of Object.keys(P.TRAY_KINDS)) {
    for (const rotation of [0, 90, 180, 270]) {
      for (const [w, h] of SIZES) {
        for (const side of SIDES) {
          const layout = blankLayout(w, h);
          const view = P.alignTrayView(layout, tray, P.defaultTrayView(layout, tray, P.TRAY_KINDS[tray].turnFor(rotation)), side);
          const pl = P.trayToPage(layout, tray, view);
          const g = P.pageGeometry(layout, DEFAULT_SETTINGS, { rotation: pl.rotation, x: pl.x, y: pl.y });
          const { items } = renderCheque(layout, SAMPLE, DEFAULT_SETTINGS, measure);
          const html = P.buildPrintHtml(items, g, { fontFamily: 'Arial', marks: true });
          await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          const pdf = await win.webContents.printToPDF({ pageSize: { width: g.pageWidth / 25.4, height: g.pageHeight / 25.4 }, margins: { marginType: 'none' } });
          const got = await pdfText(pdfjs, pdf);
          pages++;
          const name = `${tray} rotation ${pl.rotation} ${w}x${h} ${side}`;
          if (Math.abs(got.width - g.pageWidth) > 0.5 || Math.abs(got.height - g.pageHeight) > 0.5) failures.push(`${name}: page is ${got.width.toFixed(1)} x ${got.height.toFixed(1)} mm, expected ${g.pageWidth} x ${g.pageHeight}`);
          for (const item of items.filter(i => i.kind === 'text' && ['payee', 'amount', 'date', 'words'].includes(i.role) && i.text.trim())) {
            const found = got.items.find(t => t.text === item.text);
            if (!found) { failures.push(`${name}: "${item.text}" not found in the PDF`); continue; }
            fields++;
            const r = pageRect(layout, g, item);
            // The text starts on the box's left edge (as read on the cheque) and its baseline lies inside the box.
            const dx = Math.max(r.x1 - found.x, found.x - r.x2, 0);
            const dy = Math.max(r.y1 - found.y, found.y - r.y2, 0);
            const start = P.chequePointOnPage(layout, g.rotation, item.x, item.y + item.height / 2);
            const along = g.rotation === 90 || g.rotation === 270 ? Math.abs(found.y - (start.y + g.originY)) : Math.abs(found.x - (start.x + g.originX));
            const sizeErr = Math.abs(found.size - item.fontPt * PT_TO_MM);
            const err = Math.max(dx, dy, along);
            worst = Math.max(worst, err);
            if (err > TOLERANCE_MM || sizeErr > 0.1) failures.push(`${name}: ${item.role} "${item.text.slice(0, 14)}" ${err.toFixed(1)} mm off, text ${found.size.toFixed(2)} mm tall instead of ${(item.fontPt * PT_TO_MM).toFixed(2)}`);
          }
          // The alignment marks: each corner and centre label starts 1.8 mm right of and above its crosshair.
          for (const m of P.alignmentMarks(w, h).points.filter(p => p.x < w / 2 + 1)) {
            const found = got.items.find(t => t.text === m.label);
            const want = P.chequePointOnPage(layout, g.rotation, m.x + 1.8, m.y - 1.8);
            const err = found ? Math.hypot(found.x - (want.x + g.originX), found.y - (want.y + g.originY)) : Infinity;
            worst = Math.max(worst, err);
            if (err > TOLERANCE_MM) failures.push(`${name}: mark "${m.label}" ${found ? err.toFixed(1) + ' mm off' : 'missing'}`);
          }
          // Fix position: the test print landed 3 mm right and 5 mm up on the cheque. After the fix, with the cheque in the
          // same place, the payee must print 3 mm left and 5 mm down of where it was, in this feed direction.
          const payee = items.find(i => i.kind === 'text' && i.role === 'payee');
          const fixed = P.correctPlacement(layout, pl, 3, -5);
          const g2 = P.pageGeometry(layout, DEFAULT_SETTINGS, { rotation: fixed.rotation, x: fixed.x, y: fixed.y });
          await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(P.buildPrintHtml(items, g2, { fontFamily: 'Arial' }))}`);
          const after = (await pdfText(pdfjs, await win.webContents.printToPDF({ pageSize: { width: g2.pageWidth / 25.4, height: g2.pageHeight / 25.4 }, margins: { marginType: 'none' } }))).items.find(t => t.text === payee.text);
          const before = got.items.find(t => t.text === payee.text);
          const move = P.chequePointOnPage(layout, pl.rotation, -3, 5);
          const zero = P.chequePointOnPage(layout, pl.rotation, 0, 0);
          const fixErr = after && before ? Math.hypot(after.x - before.x - (move.x - zero.x), after.y - before.y - (move.y - zero.y)) : Infinity;
          worst = Math.max(worst, fixErr);
          if (fixErr > TOLERANCE_MM) failures.push(`${name}: Fix position moved the text ${fixErr.toFixed(1)} mm away from where it should`);
          if (outDir && side === 'centre' && w === 205.74) {
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, `${tray}-${pl.rotation}.pdf`), pdf);
          }
        }
      }
    }
  }
  console.log(`virtual printer: ${pages} pages, ${fields} fields measured, worst ${worst.toFixed(2)} mm, ${failures.length} problems`);
  for (const f of failures.slice(0, 12)) console.log('  ' + f);
  app.exit(failures.length ? 1 : 0);
}
