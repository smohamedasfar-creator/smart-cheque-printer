// Smoke test: launches the built app against a throwaway database, uploads a blank cheque scan,
// saves the detected template, links an account, fills in a cheque, and writes screenshots.
// Usage: npx electron scripts/smoke.cjs <outDir> <scan.pdf|jpg|png> [cropped-image]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const outDir = path.resolve(process.argv[2] || 'smoke-output');
const scans = process.argv.slice(3).map(p => path.resolve(p));
fs.mkdirSync(outDir, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'scp-smoke-')));

const errors = [];
const notes = [];
const check = (name, actual, expected) => notes.push(`${actual === expected ? 'PASS' : 'FAIL'} ${name}: got ${actual}, expected ${expected}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level === 'warning') errors.push(`[console ${event.level}] ${event.message}`);
  });
  win.webContents.on('did-finish-load', () => run(win).catch(async err => { errors.push(String(err.stack || err)); await shot(win, 'failure').catch(() => {}); finish(); }));
});

async function shot(win, name) {
  await wait(400);
  fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

const js = (win, code) => win.webContents.executeJavaScript(code);

const setField = (win, selector, value) =>
  js(win, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('missing ${selector}');
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);

const click = (win, text) =>
  js(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!b) throw new Error('no button ${text}');
    b.click();
  })()`);

async function waitFor(win, expr, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await js(win, `Boolean(${expr})`)) return;
    await wait(250);
  }
  throw new Error(`timed out waiting for ${expr}`);
}

/** Drops a file onto the upload area, as if dragged from Explorer. */
async function dropFile(win, file) {
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
  const b64 = fs.readFileSync(file).toString('base64');
  await js(win, `(() => {
    const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], ${JSON.stringify(path.basename(file))}, { type: '${type}' }));
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  })()`);
}

async function addChequeBook(win, file, name, index) {
  await click(win, 'Cheque Books');
  await waitFor(win, "[...document.querySelectorAll('button')].some(b => b.textContent === '+ Add cheque book')");
  await click(win, '+ Add cheque book');
  await waitFor(win, "document.querySelector('.dropzone')");
  await dropFile(win, file);
  await waitFor(win, "document.querySelector('.detect-summary') || document.querySelector('.error')");
  const chips = await js(win, "[...document.querySelectorAll('.chip')].map(c => c.textContent)");
  notes.push(`${name}: ${chips.join(' | ')}`);
  if (await js(win, "Boolean(document.querySelector('.width-prompt'))")) {
    await setField(win, '.width-prompt input', '158');
    await click(win, 'Apply');
    notes.push(`${name}: entered width 158 mm`);
  }
  await setField(win, '.editor-toolbar .name', name);
  // select the payee field to show the inspector
  await js(win, "document.querySelector('.field-handle[title=\"Payee\"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
  await shot(win, `${index}-layout-${name.replace(/W+/g, '-').toLowerCase()}`);
  await click(win, 'Next: cheque book details →');
  await waitFor(win, "[...document.querySelectorAll('h2')].some(h => h.textContent === 'Cheque book details')");
  await setField(win, 'input[placeholder^="e.g. 000123"]', '000135');
  await shot(win, `${index}b-details`);
  await click(win, 'Save cheque book');
  await waitFor(win, "document.querySelector('.template-grid')");
}

let started = false;
async function run(win) {
  if (started) return;
  started = true;
  await wait(800);
  await shot(win, '1-start');

  for (const [i, file] of scans.entries()) await addChequeBook(win, file, i === 0 ? 'Main current account' : 'Cropped upload account', 2 + i);
  await shot(win, '4-cheque-books');

  const templates = await js(win, 'window.chequeApi.listTemplates()');
  notes.push(...templates.map(t => `${t.name}: ${t.layout.chequeWidth.toFixed(1)} x ${t.layout.chequeHeight.toFixed(1)} mm, date ${t.layout.date.mode}`));

  await click(win, 'Write Cheque');
  await waitFor(win, "document.querySelector('input[list=\"payees\"]')");
  await setField(win, 'input[list="payees"]', 'Acme Gulf Contracting LLC');
  await setField(win, 'input[inputmode="decimal"]', '23456.78');
  await shot(win, '5-write-cheque');
  // choose the word that starts line 2 of the amount in words
  await js(win, "[...document.querySelectorAll('.word-break .word')][4]?.click()");
  await shot(win, '5b-write-cheque-break');

  // history and payees with sample data
  const accounts = await js(win, 'window.chequeApi.listAccounts()');
  await js(win, `window.chequeApi.recordCheque({ accountId: ${accounts[0].id}, chequeNo: '000136', date: '2026-10-19', payee: 'Acme Gulf Contracting LLC', amountFils: 2345678, crossing: 'ac-payee-bearer', remark: 'Sample' })`);
  await js(win, "window.chequeApi.addPayee('Sample Supplier LLC')");
  await click(win, 'Payees');
  await wait(300);
  await shot(win, '6-payees');
  await click(win, 'History');
  await wait(300);
  await shot(win, '7-history');

  // History filters: cheque number, customer name, date range
  await js(win, `window.chequeApi.recordCheque({ accountId: ${accounts[0].id}, chequeNo: '000137', date: '2026-09-05', payee: 'Sample Supplier LLC', amountFils: 50000, crossing: 'none', remark: '' })`);
  await click(win, 'Payees');
  await click(win, 'History');
  await wait(400);
  const rows = () => js(win, "document.querySelectorAll('.history tbody tr:not(:has(.empty-row))').length");
  check('history shows all cheques', await rows(), 2);
  await setField(win, 'input[placeholder="Cheque no"]', '137');
  await wait(400);
  check('filter by cheque number', await rows(), 1);
  await setField(win, 'input[placeholder="Cheque no"]', '');
  await setField(win, 'input[placeholder="Customer / payee name"]', 'acme');
  await wait(400);
  check('filter by customer name', await rows(), 1);
  await setField(win, 'input[placeholder="Customer / payee name"]', '');
  await js(win, "(() => { const d = document.querySelectorAll('.history input[type=date]'); const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(d[0], '2026-09-01'); set(d[1], '2026-09-30'); })()");
  await wait(400);
  check('filter by date range', await rows(), 1);
  await shot(win, '7b-history-filtered');
  await click(win, 'Clear filters');
  await wait(400);
  check('clear filters', await rows(), 2);

  // Payee management: add, rename, delete
  await click(win, 'Payees');
  await wait(300);
  await setField(win, 'input[placeholder="New payee name"]', 'Test Payee One');
  await click(win, 'Add payee');
  await wait(300);
  await js(win, "window.chequeApi.renamePayee('Test Payee One', 'Test Payee Renamed')");
  await js(win, "window.chequeApi.deletePayee('Sample Supplier LLC')");
  const payees = await js(win, 'window.chequeApi.listPayees()');
  check('payee add/rename/delete', JSON.stringify(payees), JSON.stringify(['Acme Gulf Contracting LLC', 'Test Payee Renamed']));
  await click(win, 'Settings');
  await js(win, "[...document.querySelectorAll('h2')].find(h => h.textContent === 'Amount and text').scrollIntoView()");
  await shot(win, '8a-settings-text');
  check('font list has installed fonts', await js(win, "document.querySelectorAll('select option').length > 30"), true);
  await js(win, "document.querySelector('.calibration').scrollIntoView()");
  await shot(win, '8-settings');
  await click(win, 'Help & About');
  await wait(300);
  await shot(win, '9-help-about');
  check('support button shown', await js(win, "[...document.querySelectorAll('button')].some(b => b.textContent.includes('Support the developer'))"), true);
  await click(win, 'Copy number');
  await wait(300);
  check('botim number copied', await require('electron').clipboard.readText(), '+971563686538');

  if (templates.length) await printPdf(win, templates[0]);
  finish();
}

// Renders the exact print page (test-print variant) for the first template to PNG.
async function printPdf(win, template) {
  const shared = path.join(__dirname, '..', 'dist', 'main', 'shared');
  const { renderCheque } = require(path.join(shared, 'chequeRender.js'));
  const { buildPrintHtml, pageGeometry } = require(path.join(shared, 'print.js'));
  const { DEFAULT_SETTINGS } = require(path.join(shared, 'types.js'));
  const measure = (text, pt) => text.length * 2.1 * (pt / 12);
  const layout = template.layout;
  const settings = { ...DEFAULT_SETTINGS };
  const { items } = renderCheque(layout, { date: '2026-10-19', payee: 'Acme Gulf Contracting LLC', amountFils: 12505075, crossing: 'ac-payee-bearer' }, settings, measure);
  const g = pageGeometry(layout, settings);
  const html = buildPrintHtml(items, g, { fontFamily: 'Arial', guides: { chequeWidth: layout.chequeWidth, chequeHeight: layout.chequeHeight } });
  const view = new BrowserWindow({ show: false, width: Math.round((g.pageWidth / 25.4) * 96), height: Math.round((g.pageHeight / 25.4) * 96), webPreferences: { offscreen: true, javascript: false } });
  await view.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await wait(500);
  fs.writeFileSync(path.join(outDir, '10-print-page.png'), (await view.webContents.capturePage()).toPNG());
  view.destroy();
}

function finish() {
  fs.writeFileSync(path.join(outDir, 'errors.txt'), errors.join('\n') || 'none');
  fs.writeFileSync(path.join(outDir, 'notes.txt'), notes.join('\n'));
  app.exit(0);
}

setTimeout(() => { errors.push('timeout'); finish(); }, 120000);
require(path.join(__dirname, '..', 'dist', 'main', 'main', 'main.js'));
