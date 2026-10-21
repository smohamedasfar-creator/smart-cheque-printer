// Virtual printer for tests: prints the app's real calibration test page to PDF, lays the cheque where it "really"
// sits in the printer, keeps only the ink that lands on it, puts it slightly crooked on a scanner lid and returns
// the scan as a PNG marked 300 DPI. Runs in Electron's main process.
const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'dist', 'main', 'shared');
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Adds a pHYs chunk (resolution) to a PNG so the app reads it as a scan of known DPI. */
function withDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data[8] = 1;
  const type = Buffer.from('pHYs');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0, 0);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(9, 0);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), len, type, data, crc, png.subarray(ihdrEnd)]);
}

/**
 * @param {{ layout: object, image: string, items: object[], settings: object, expected: object, actual: object, dpi?: number }} job
 * @returns {Promise<Buffer>} PNG of the scanned test cheque
 */
async function simulateTestScan({ layout, image, items, settings, expected, actual, dpi = 300 }) {
  const P = require(path.join(shared, 'print.js'));
  const C = require(path.join(shared, 'detect', 'calibrate.js'));
  const K = dpi / 25.4;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-vprint-'));
  const g = P.pageGeometry(layout, settings, expected);
  const testHtml = path.join(dir, 'test.html');
  fs.writeFileSync(testHtml, P.buildPrintHtml(items, g, { fontFamily: settings.fontFamily || 'Arial', pageDots: C.calibrationPattern(layout, expected) }));
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  await pw.loadFile(testHtml);
  const pdf = await pw.webContents.printToPDF({ pageSize: { width: g.pageWidth / 25.4, height: g.pageHeight / 25.4 }, margins: { marginType: 'none' } });
  pw.destroy();

  // cheque mm -> page mm where the cheque really sits
  const o = P.chequePointOnPage(layout, actual.rotation, 0, 0);
  const ex = P.chequePointOnPage(layout, actual.rotation, 1, 0);
  const ey = P.chequePointOnPage(layout, actual.rotation, 0, 1);
  const m = { a: ex.x - o.x, b: ex.y - o.y, c: ey.x - o.x, d: ey.y - o.y, e: actual.x + o.x, f: actual.y + o.y };
  const pdfjsUrl = pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;
  const workerUrl = pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const simHtml = path.join(dir, 'sim.html');
  fs.writeFileSync(simHtml, `<!doctype html><html><body style="margin:0"><canvas id="out"></canvas>
<script>window.addEventListener('error', e => { document.title = 'error: ' + e.message; }); window.addEventListener('unhandledrejection', e => { document.title = 'error: ' + (e.reason && e.reason.message || e.reason); });</script>
<script type="module">
import * as pdfjs from '${pdfjsUrl}';
pdfjs.GlobalWorkerOptions.workerSrc = '${workerUrl}';
const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob('${pdf.toString('base64')}'), ch => ch.charCodeAt(0)) }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: ${K} * 25.4 / 72 });
const pc = document.createElement('canvas'); pc.width = vp.width; pc.height = vp.height;
const pctx = pc.getContext('2d'); pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, pc.width, pc.height);
await page.render({ canvasContext: pctx, canvas: pc, viewport: vp }).promise;
const img = new Image(); img.src = ${JSON.stringify(image)}; await img.decode();
const W = ${layout.chequeWidth}, H = ${layout.chequeHeight}, K = ${K}, M = 12;
const out = document.getElementById('out'); out.width = Math.round((W + 2 * M) * K); out.height = Math.round((H + 2 * M) * K);
const ctx = out.getContext('2d');
ctx.fillStyle = '#f6f6f4'; ctx.fillRect(0, 0, out.width, out.height);
ctx.save();
ctx.translate(M * K, M * K); ctx.rotate(0.5 * Math.PI / 180);
ctx.drawImage(img, 0, 0, W * K, H * K);
ctx.globalCompositeOperation = 'multiply';
ctx.scale(K, K);
ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
const inv = (() => { const { a, b, c, d, e, f } = ${JSON.stringify(m)}; const det = a * d - b * c; return { a: d / det, b: -b / det, c: -c / det, d: a / det, e: -(d * e - c * f) / det, f: -(-b * e + a * f) / det }; })();
ctx.transform(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f);
ctx.drawImage(pc, 0, 0, pc.width / K, pc.height / K);
ctx.restore();
window.__png = out.toDataURL('image/png');
document.title = 'done';
</script></body></html>`);
  const view = new BrowserWindow({ show: false, webPreferences: { offscreen: true, webSecurity: false } });
  await view.loadFile(simHtml);
  for (let t = 0; t < 150 && view.getTitle() !== 'done' && !view.getTitle().startsWith('error'); t++) await wait(200);
  if (view.getTitle() !== 'done') throw new Error(`virtual printer: ${view.getTitle()}`);
  const len = await view.webContents.executeJavaScript('window.__png.length');
  let dataUrl = '';
  for (let p = 0; p < len; p += 1_000_000) dataUrl += await view.webContents.executeJavaScript(`window.__png.slice(${p}, ${p + 1_000_000})`);
  view.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
  return withDpi(Buffer.from(dataUrl.split(',')[1], 'base64'), dpi);
}

module.exports = { simulateTestScan };
