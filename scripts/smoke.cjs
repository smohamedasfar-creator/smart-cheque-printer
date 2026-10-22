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
    // Electron's security notices come from the virtual printer's own test windows and never show in the installed app.
    if (/Electron Security Warning/.test(event.message)) return;
    if (event.level === 'error' || event.level === 'warning') errors.push(`[console ${event.level}] ${event.message}`);
  });
  win.webContents.on('did-finish-load', () => run(win).catch(async err => { errors.push(String(err.stack || err)); await shot(win, 'failure').catch(() => {}); finish(); }));
});

async function shot(win, name) {
  await wait(400);
  fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

const js = (win, code) => win.webContents.executeJavaScript(code);

/** Replays the loading animation and captures the tray area at each of its five steps (set SMOKE_FRAMES=1). */
async function frames(win, name) {
  await click(win, '▶ Show me how');
  const start = Date.now();
  for (const [i, at] of [600, 1800, 3000, 4300, 6200].entries()) {
    await wait(Math.max(0, at - (Date.now() - start)));
    const r = await js(win, "(() => { const t = document.querySelector('.tray').getBoundingClientRect(); return { x: Math.max(0, Math.floor(t.left)), y: Math.max(0, Math.floor(t.top)), width: Math.ceil(t.width), height: Math.ceil(t.height) }; })()");
    fs.writeFileSync(path.join(outDir, `${name}-${i + 1}.png`), (await win.webContents.capturePage(r)).toPNG());
  }
}

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
    await setField(win, '.width-prompt input', '157.6');
    await click(win, 'Apply');
    notes.push(`${name}: entered width 158 mm`);
  }
  await setField(win, '.editor-toolbar .name', name);
  // select the payee field to show the inspector
  await js(win, "document.querySelector('.field-handle[title=\"Payee\"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
  await shot(win, `${index}-layout-${name.replace(/W+/g, '-').toLowerCase()}`);
  // Four position tabs: the vertical one shows every field 7.5 mm higher (and 6 mm further left) than the main one.
  const ys = () => js(win, "[...document.querySelectorAll('.graph-table tbody tr')].map(r => Number(r.querySelectorAll('input')[1].value))");
  check('layout: four position tabs', await js(win, "document.querySelectorAll('.position-tabs button').length"), 4);
  const mainYs = await ys();
  await js(win, "document.querySelectorAll('.position-tabs button')[1].click()");
  await wait(200);
  const vertYs = await ys();
  check('layout: vertical tab prints every field 7.5 mm higher', vertYs.every((v, i) => Math.abs(v - mainYs[i] - 7.5) < 0.11), true);
  check('layout: default setting edits fields on the main tab only', await js(win, "document.querySelector('.graph-table input').readOnly"), true);
  check('layout: default and manual settings offered', await js(win, "[...document.querySelectorAll('.position-mode button')].map(b => b.textContent).join(',')"), 'Default,Manual');
  await shot(win, `${index}-layout-vertical-tab`);
  await js(win, "document.querySelectorAll('.position-tabs button')[0].click()");
  await wait(150);
  // Layout and cheque book details are on one screen.
  check('layout and details on one screen', await js(win, "[...document.querySelectorAll('h2')].some(h => h.textContent === 'Cheque book details') && Boolean(document.querySelector('.template-editor'))"), true);
  await setField(win, 'input[placeholder^="e.g. 000123"]', '000135');
  // The simple view: three steps up front, the technical settings closed away.
  check('details: test print is the first step', await js(win, "document.querySelector('.setup-steps button')?.textContent"), 'Test print');
  check('details: four ready positions offered', await js(win, "[...document.querySelectorAll('.ready-positions .feed-option')].map(b => b.querySelector('strong').textContent + ' ' + b.querySelector('span').textContent).join(' | ')"), 'Back tray · main Horizontal · top edge first | Back tray Vertical · date end first | Front tray Horizontal · top edge first | Front tray Vertical · date end first');
  check('details: main position (back tray, horizontal) chosen for a new cheque book', await js(win, "document.querySelector('.ready-positions .feed-option.active')?.textContent.startsWith('Back tray · mainHorizontal')"), true);
  check('details: four arrows move the print', await js(win, "document.querySelectorAll('.setup-steps .nudge button').length"), 4);
  check('details: print graph in the main steps', await js(win, "[...document.querySelectorAll('.setup-steps button')].some(b => b.textContent === 'Print graph')"), true);
  check('details: advanced settings closed', await js(win, "document.querySelector('details.advanced').open"), false);
  check('details: not set up yet', await js(win, "document.querySelector('.details-layout .form').textContent.includes('Not set up yet')"), true);
  await wait(6300);
  await shot(win, `${index}b-details`);
  await click(win, 'Save cheque book');
  await waitFor(win, "document.querySelector('.template-grid')");
  await moveByArrows(win, name, index);
  await calibrateByGraph(win, name, index);
  await calibrateByScan(win, name, index);

  // Advanced: every tray, load the cheque date end first against the right guide, and check the picture.
  await openDetails(win, name);
  await js(win, "(() => { const d = document.querySelector('details.advanced'); d.open = true; d.dispatchEvent(new Event('toggle')); })()");
  await waitFor(win, "[...document.querySelectorAll('button')].some(b => b.textContent === 'Right side ⇥')");
  for (const [tray, title] of [['manual', 'Manual feed slot'], ['front', 'Front drawer'], ['rear', 'Back tray']]) {
    await js(win, `[...document.querySelectorAll('details.advanced .feed-option')].find(b => b.textContent.startsWith('${title}')).click()`);
    await js(win, "[...document.querySelectorAll('details.advanced .feed-option')].find(b => b.textContent.includes('Date end first')).click()");
    await click(win, 'Right side ⇥');
    await wait(150);
    check(`${tray}: tray picture shown`, await js(win, `Boolean(document.querySelector('.tray-${tray}'))`), true);
    check(`${tray}: cheque against the right side`, await js(win, "(() => { const s = document.querySelector('.tray-sheet').getBoundingClientRect(); const c = document.querySelector('.tray-cheque').getBoundingClientRect(); return Math.abs(c.right - s.right) < 2; })()"), true);
    check(`${tray}: date end first selected`, await js(win, "document.querySelector('details.advanced .feed-options:not(.three) .feed-option.active')?.textContent.includes('Date end first')"), true);
    // Against the right side, one guide closes from the left; the steps say how to load it.
    check(`${tray}: one guide closes from the left`, await js(win, "document.querySelectorAll('.tray-guide').length"), 1);
    check(`${tray}: loading steps mention the guide`, await js(win, "[...document.querySelectorAll('.tray-steps li')].some(li => /guide/i.test(li.textContent))"), true);
    if (process.env.SMOKE_FRAMES) await frames(win, `${index}e-load-${tray}`);
    await wait(6300);
    await shot(win, `${index}c-tray-${tray}`);
  }
  // Fix by dragging: the test print landed 1 mm to the right, so the saved position moves the cheque back.
  await setField(win, 'input[placeholder^="e.g. Back tray"]', 'Back tray · date end first');
  const before = await js(win, "[...document.querySelectorAll('.tray-cheque')].length");
  check('one cheque on the tray picture', before, 1);
  await js(win, "document.querySelector('[aria-label=\"Move right\"]').click(); document.querySelector('[aria-label=\"Move right\"]').click()");
  await click(win, 'Fix position');
  await wait(150);
  check('fix position confirmed', await js(win, "[...document.querySelectorAll('.success')].some(p => p.textContent.includes('1 mm right'))"), true);
  await shot(win, `${index}d-fixed`);
  await click(win, 'Save cheque book');
  await waitFor(win, "document.querySelector('.template-grid')");
  const saved = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  // Back tray, date end first, against the right guide = the page's left edge. Date end first, the cheque's
  // left-to-right runs up the page, so text that landed 1 mm right means the cheque really sits 1 mm lower.
  // The placement stays where the cheque sits (against the right guide); the 1 mm becomes the position's adjustment.
  const P = require(path.join(__dirname, '..', 'dist', 'main', 'shared', 'positions.js'));
  const dragged = (await js(win, 'window.chequeApi.listTemplates()')).find(t => t.id === saved.templateId).layout;
  check(`${name}: saved position`, JSON.stringify(saved && { rotation: saved.feedRotation, x: saved.pageX, y: saved.pageY }), JSON.stringify({ rotation: 270, x: 0, y: 0 }));
  const d = P.placementToShift(dragged, { rotation: 270, x: 0, y: 0 }, { rotation: 270, x: 0, y: 1 });
  const v = P.shiftFor(dragged, 'rear-v');
  const main = P.shiftFor(dragged, 'rear-h');
  // Default setting: the drag moves all four, the vertical keeps its 5.5 mm (the guide move started it afresh).
  check(`${name}: drag kept as the X / Y, difference kept`, JSON.stringify([v, main]), JSON.stringify([{ x: Math.round((P.VERTICAL_DIFF.x + d.x) * 10) / 10, y: Math.round((P.VERTICAL_DIFF.y + d.y) * 10) / 10, auto: true }, { x: d.x, y: d.y, auto: false }]));
  if (index === 2) await manualSetting(win, name, index);
}

/** The simple path: the arrows move the whole print on the cheque, kept as the position's own adjustment. */
async function moveByArrows(win, name, index) {
  const P = require(path.join(__dirname, '..', 'dist', 'main', 'shared', 'positions.js'));
  const before = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  await openDetails(win, name);
  await click(win, '↑ Up');
  await wait(100);
  await click(win, '↑ Up');
  await wait(100);
  await click(win, '← Left');
  await wait(200);
  const said = await js(win, "[...document.querySelectorAll('.form .success')].map(p => p.textContent).join(' ')");
  check(`${name}: arrows report the move`, said.includes('Print moved 2 mm up and 1 mm left'), true);
  await js(win, "document.querySelector('.setup-steps').scrollIntoView({ block: 'start' })");
  await shot(win, `${index}c-arrows`);
  await click(win, 'Save cheque book');
  await waitFor(win, "document.querySelector('.template-grid')");
  const after = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  const layout = (await js(win, 'window.chequeApi.listTemplates()')).find(t => t.id === after.templateId).layout;
  check(`${name}: page placement stays plain`, JSON.stringify([after.feedRotation, after.pageX, after.pageY]), JSON.stringify([before.feedRotation, before.pageX, before.pageY]));
  // A new cheque book starts on the main position: 1 mm left and 2 mm up is its own setting, the others follow.
  check(`${name}: main position set by the arrows`, JSON.stringify(P.shiftFor(layout, 'rear-h')), JSON.stringify({ x: -1, y: 2, auto: false }));
  const vd = { x: -1 + P.VERTICAL_DIFF.x, y: 2 + P.VERTICAL_DIFF.y, auto: true };
  check(`${name}: the other three follow it (vertical ${P.VERTICAL_DIFF_TEXT})`, JSON.stringify(['rear-v', 'front-h', 'front-v'].map(k => P.shiftFor(layout, k))), JSON.stringify([vd, { x: -1, y: 2, auto: true }, vd]));
  check(`${name}: four ready positions saved`, after.positions.length >= 4, true);
}

/** The graph path: type the corner reading of a printed graph, Apply, Save: it becomes the position's adjustment. */
async function calibrateByGraph(win, name, index) {
  const P = require(path.join(__dirname, '..', 'dist', 'main', 'shared', 'positions.js'));
  const before = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  await openDetails(win, name);
  await setField(win, '.corner-reading input', '-1.5');
  await js(win, "(() => { const el = document.querySelectorAll('.corner-reading input')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await click(win, 'Apply');
  await wait(200);
  const said = await js(win, "[...document.querySelectorAll('.form .success')].map(p => p.textContent).join(' ')");
  check(`${name}: graph reading applied`, said.includes('1.5 mm left and 2 mm up'), true);
  await js(win, "document.querySelector('.corner-reading').scrollIntoView({ block: 'center' })");
  await shot(win, `${index}h-graph-applied`);
  await click(win, 'Save cheque book');
  await waitFor(win, "document.querySelector('.template-grid')");
  const after = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  const layout = (await js(win, 'window.chequeApi.listTemplates()')).find(t => t.id === after.templateId).layout;
  check(`${name}: graph reading is the position's setting`, JSON.stringify(P.shiftFor(layout, 'rear-h')), JSON.stringify({ x: -1.5, y: 2, auto: false }));
  check(`${name}: page placement stays plain after the graph`, JSON.stringify([after.feedRotation, after.pageX, after.pageY]), JSON.stringify([before.feedRotation, before.pageX, before.pageY]));
}

/** Manual setting: the vertical position gets its own X / Y and its own field, and the horizontal one does not change. */
async function manualSetting(win, name, index) {
  const P = require(path.join(__dirname, '..', 'dist', 'main', 'shared', 'positions.js'));
  const account = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  const before = (await js(win, 'window.chequeApi.listTemplates()')).find(t => t.id === account.templateId).layout;
  await openDetails(win, name);
  await click(win, 'Manual');
  await wait(150);
  await js(win, "document.querySelectorAll('.position-tabs button')[1].click()");
  await wait(150);
  check('manual: the vertical tab can be changed', await js(win, "document.querySelector('.graph-table input').readOnly"), false);
  await setField(win, '.position-shift input', '1');
  await js(win, "(() => { const el = document.querySelectorAll('.position-shift input')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '9'); el.dispatchEvent(new Event('input', { bubbles: true })); })()");
  // The payee of the vertical position starts 5 mm further right.
  const payeeX = await js(win, "Number(document.querySelectorAll('.graph-table tbody tr')[1].querySelector('input').value)");
  await js(win, `(() => { const el = document.querySelectorAll('.graph-table tbody tr')[1].querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${payeeX + 5}'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(150);
  await shot(win, `${index}i-manual-vertical`);
  await click(win, 'Save cheque book');
  await waitFor(win, "document.querySelector('.template-grid')");
  const after = (await js(win, 'window.chequeApi.listTemplates()')).find(t => t.id === account.templateId).layout;
  check('manual: saved as manual', after.positionMode, 'manual');
  check('manual: vertical has its own X / Y', JSON.stringify(P.shiftFor(after, 'rear-v')), JSON.stringify({ x: 1, y: 9, auto: false }));
  const h = (L) => JSON.stringify(['payee', 'amount', 'words1', 'words2', 'date'].map(k => L[k]));
  check('manual: horizontal prints exactly as before', h(P.layoutForPosition(after, 'rear-h')), h(P.layoutForPosition(before, 'rear-h')));
  const vx = P.layoutForPosition(after, 'rear-v').payee.x - P.layoutForPosition(before, 'rear-v').payee.x;
  check('manual: vertical payee moved 5 mm plus its X', Math.round(vx * 10) / 10, 6);
}

async function openDetails(win, name) {
  await js(win, `[...document.querySelectorAll('.template-card')].find(c => c.textContent.includes(${JSON.stringify(name)})).querySelector('button').click()`);
  await waitFor(win, "[...document.querySelectorAll('h2')].some(h => h.textContent === 'Cheque book details')");
}

/**
 * Step 3 of setting up printing, end to end in the real window: a virtual printer prints the test page with the
 * cheque sitting 17.5 mm away from where the app expects it; its scan goes into "choose the scan"; the app must
 * find the cheque's real position.
 */
async function calibrateByScan(win, name, index) {
  const { simulateTestScan } = require('./virtual-printer.cjs');
  const account = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  const template = (await js(win, 'window.chequeApi.listTemplates()')).find(t => t.id === account.templateId);
  const settings = await js(win, 'window.chequeApi.getSettings()');
  // The scan method on the back tray, vertical: printed horizontally, its dot rows cross the cheque's printed design.
  const P = require(path.join(__dirname, '..', 'dist', 'main', 'shared', 'positions.js'));
  const expected = P.readyPlacement(template.layout, 'rear', 270);
  const actual = { rotation: expected.rotation, x: Math.round((expected.x - 17.5) * 10) / 10, y: Math.round((expected.y + 1.2) * 10) / 10 };
  const png = await simulateTestScan({ layout: template.layout, image: template.image, items: [], settings, expected, actual });
  fs.writeFileSync(path.join(outDir, `${index}f-test-scan.png`), png);
  await openDetails(win, name);
  await js(win, "document.querySelectorAll('.ready-positions .feed-option')[1].click()");
  await wait(150);
  await js(win, `(() => {
    const bytes = Uint8Array.from(atob('${png.toString('base64')}'), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'test-scan.png', { type: 'image/png' }));
    const input = document.querySelector('details.advanced input[type=file]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(win, "[...document.querySelectorAll('.form .success, .form .error')].some(p => /Calibrated|Could not|does not/.test(p.textContent))", 60000);
  const said = await js(win, "[...document.querySelectorAll('.form .success, .form .error')].map(p => p.textContent).join(' ')");
  notes.push(`${name} calibration: ${said}`);
  check(`${name}: calibrated from the scan`, said.includes('✓ Calibrated'), true);
  await shot(win, `${index}g-calibrated`);
  await click(win, 'Save cheque book');
  await waitFor(win, "document.querySelector('.template-grid')");
  const saved = (await js(win, 'window.chequeApi.listAccounts()')).find(a => a.name === name);
  const layout = (await js(win, 'window.chequeApi.listTemplates()')).find(t => t.id === saved.templateId).layout;
  const want = P.placementToShift(layout, expected, actual);
  const got = P.shiftFor(layout, 'rear-v');
  check(`${name}: the scan sets the position's X / Y to where the cheque really sat (within 0.5 mm)`, Math.hypot(got.x - want.x, got.y - want.y) <= 0.5, true);
  check(`${name}: page placement stays plain after the scan`, JSON.stringify([saved.feedRotation, saved.pageX, saved.pageY]), JSON.stringify([expected.rotation, expected.x, expected.y]));
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
  // The four ready positions are always offered when printing.
  check('write: ready positions offered', await js(win, "[...document.querySelectorAll('label')].find(l => l.textContent.startsWith('Print position'))?.querySelectorAll('option').length >= 4"), true);
  check('write: no page-edge warnings for the saved position', await js(win, "[...document.querySelectorAll('.warning')].map(w => w.textContent).filter(t => /page/.test(t)).join(' | ')"), '');
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

setTimeout(() => { errors.push("timeout"); finish(); }, 420000);
require(path.join(__dirname, '..', 'dist', 'main', 'main', 'main.js'));
