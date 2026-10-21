import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { APP_LINKS, resolveAppLink, type AppLink } from '../shared/appLinks';
import { buildCalibrationHtml, buildPrintHtml, pageGeometry } from '../shared/print';
import { calibrationPattern } from '../shared/detect/calibrate';
import type { PrintJob } from '../preload/api';
import { createStore, type Store } from './store';

const MICRONS_PER_MM = 1000;
const A4_MM = { width: 210, height: 297 };
const SQLITE_HEADER = 'SQLite format 3\0';
let mainWindow: BrowserWindow | null = null;

async function openStore(dbPath: string): Promise<Store> {
  const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  const db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  // Write to a temp file then rename, so a crash mid-write cannot corrupt the database.
  const persist = () => {
    const tmp = `${dbPath}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, dbPath);
  };
  return createStore(db, persist);
}

async function printJob(job: PrintJob): Promise<{ ok: boolean; error?: string }> {
  const layout = job.layout;
  const geometry = pageGeometry(layout, job.settings, job.placement);
  const html = buildPrintHtml(job.items, geometry, {
    fontFamily: job.settings.fontFamily,
    guides: job.testPrint,
    marks: job.marks === true,
    // The scan-to-calibrate test print: dot rows across the page around where the cheque is expected.
    pageDots: job.calibrate && job.placement && job.placement.rotation !== null && job.placement.x !== null && job.placement.y !== null
      ? calibrationPattern(layout, { rotation: job.placement.rotation, x: job.placement.x, y: job.placement.y })
      : undefined,
  });
  return printHtml(html, geometry.pageWidth, geometry.pageHeight, job.settings.printerName);
}

async function printHtml(html: string, widthMm: number, heightMm: number, printerName: string): Promise<{ ok: boolean; error?: string }> {
  // The print page has no scripts and no access to the app.
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise(resolve => {
      win.webContents.print(
        {
          silent: false,
          printBackground: false,
          deviceName: printerName || undefined,
          margins: { marginType: 'none' },
          pageSize: { width: widthMm * MICRONS_PER_MM, height: heightMm * MICRONS_PER_MM },
        },
        (ok, reason) => resolve(ok ? { ok } : { ok, error: reason || 'Printing was cancelled' }),
      );
    });
  } finally {
    win.destroy();
  }
}

/** Only the app's own window may call into the main process. */
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Request rejected');
    return fn(...args);
  });
}

function isSqliteFile(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    return header.toString('latin1') === SQLITE_HEADER;
  } finally {
    fs.closeSync(fd);
  }
}

function registerIpc(store: Store, dbPath: string) {
  handle('accounts:list', () => store.listAccounts());
  handle('accounts:save', account => store.saveAccount(account));
  handle('accounts:delete', (id: number) => store.deleteAccount(id));
  handle('templates:list', () => store.listTemplates());
  handle('templates:save', template => store.saveTemplate(template));
  handle('templates:delete', (id: number) => store.deleteTemplate(id));
  handle('payees:list', () => store.listPayees());
  handle('payees:add', (name: string) => store.addPayee(String(name)));
  handle('payees:rename', (oldName: string, newName: string) => store.renamePayee(String(oldName), String(newName)));
  handle('payees:delete', (name: string) => store.deletePayee(String(name)));
  handle('cheques:record', cheque => store.recordCheque(cheque));
  handle('cheques:list', filter => store.listCheques(filter ?? {}));
  handle('cheques:status', (id: number, status) => store.setChequeStatus(id, status));
  handle('cheques:delete', (id: number) => store.deleteCheque(Number(id)));
  handle('settings:get', () => store.getSettings());
  handle('settings:save', settings => store.saveSettings(settings));
  handle('printers:list', async () => {
    const printers = (await mainWindow?.webContents.getPrintersAsync()) ?? [];
    return printers.map(p => ({ name: p.name, isDefault: Boolean((p as { isDefault?: boolean }).isDefault) }));
  });
  handle('print', (job: PrintJob) => printJob(job));
  handle('print:calibration', (printerName: string) => printHtml(buildCalibrationHtml(), A4_MM.width, A4_MM.height, String(printerName ?? '')));
  handle('export:csv', async (csv: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `cheques-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.writeFileSync(result.filePath, '﻿' + String(csv), 'utf8');
    return { saved: true, path: result.filePath };
  });
  handle('app:info', () => ({ version: app.getVersion(), dataFolder: path.dirname(dbPath) }));
  // Opens only the fixed contact and project links; nothing the page supplies is ever opened.
  // Copies only the fixed Botim number shown in Help & About.
  handle('copy:botim', async () => {
    if (APP_LINKS.botimNumber) await clipboard.writeText(`+${APP_LINKS.botimNumber}`);
  });
  handle('open:link', async (link: AppLink) => {
    const url = resolveAppLink(link);
    if (url) await shell.openExternal(url);
  });
  handle('data:backup', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `smart-cheque-backup-${new Date().toISOString().slice(0, 10)}.scpbackup`,
      filters: [{ name: 'Smart Cheque Printer backup', extensions: ['scpbackup'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.copyFileSync(dbPath, result.filePath);
    return { saved: true, path: result.filePath };
  });
  handle('data:restore', async () => {
    const pick = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Smart Cheque Printer backup', extensions: ['scpbackup', 'sqlite'] }],
    });
    const file = pick.filePaths[0];
    if (pick.canceled || !file) return { restored: false };
    if (!isSqliteFile(file)) return { restored: false, error: 'This file is not a Smart Cheque Printer backup.' };
    const confirm = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Replace my data', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Replace all current cheque books, history and settings with this backup?',
      detail: 'A copy of the current data is kept next to it. The app restarts afterwards.',
    });
    if (confirm.response !== 0) return { restored: false };
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, `${dbPath}.before-restore`);
    fs.copyFileSync(file, dbPath);
    app.relaunch();
    app.exit(0);
    return { restored: true };
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: 'Smart Cheque Printer',
    icon: path.join(__dirname, '../../renderer/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      // Reading a scanned PDF draws it off-screen; keep that going when the window is behind others.
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  // The app never opens other pages or windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  await mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
}

if (!app.requestSingleInstanceLock()) {
  // Two copies writing the same database would overwrite each other's changes.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    try {
      // Only the installed-font list is allowed (for the font picker); no camera, microphone, location or other access.
      const allowed = (permission: string) => permission === 'local-fonts';
      session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)));
      session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));
      const dbPath = path.join(app.getPath('userData'), 'smart-cheque.sqlite');
      registerIpc(await openStore(dbPath), dbPath);
      await createWindow();
    } catch (err) {
      dialog.showErrorBox('Smart Cheque Printer could not start', String(err instanceof Error ? err.stack : err));
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
}
