import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, test } from 'vitest';
import { createStore, type Store } from '../src/main/store';
import { DEFAULT_SETTINGS, type NewAccount } from '../src/shared/types';
import { lineDateLayout } from './fixtures';

let store: Store;
let persisted = 0;

beforeEach(async () => {
  const SQL = await initSqlJs();
  persisted = 0;
  store = createStore(new SQL.Database(), () => persisted++);
});

const account = { name: 'FAB Main', accountNo: '1234567890', templateId: null as number | null, currency: 'AED', lastChequeNo: '000100', offsetX: 0, offsetY: 0, feedRotation: null, pageX: null, pageY: null } as NewAccount;

describe('accounts', () => {
  test('creates, lists and updates accounts', () => {
    const created = store.saveAccount(account);
    expect(created.id).toBeGreaterThan(0);
    store.saveAccount({ ...created, offsetX: 1.5 });
    expect(store.listAccounts()).toEqual([{ ...created, offsetX: 1.5 }]);
    expect(persisted).toBe(2);
  });

  test('deletes an account without cheques but refuses one with cheques', () => {
    const a = store.saveAccount(account);
    const b = store.saveAccount({ ...account, name: 'ADCB' });
    store.recordCheque({ accountId: b.id, chequeNo: '1', date: '2026-10-19', payee: 'X', amountFils: 100, crossing: 'none', remark: '' });
    store.deleteAccount(a.id);
    expect(() => store.deleteAccount(b.id)).toThrow(/has cheques/);
    expect(store.listAccounts().map(x => x.name)).toEqual(['ADCB']);
  });

  test('rejects an account without a name', () => {
    expect(() => store.saveAccount({ ...account, name: '  ' })).toThrow(/name/);
  });
});

describe('cheques', () => {
  test('records a cheque, remembers the payee and advances the account cheque number', () => {
    const a = store.saveAccount(account);
    const rec = store.recordCheque({ accountId: a.id, chequeNo: '000101', date: '2026-10-19', payee: 'Acme Gulf LLC', amountFils: 125050, crossing: 'ac-payee-bearer', remark: 'Invoice 7' });
    expect(rec).toMatchObject({ chequeNo: '000101', status: 'printed', amountFils: 125050 });
    expect(store.listPayees()).toEqual(['Acme Gulf LLC']);
    expect(store.listAccounts()[0].lastChequeNo).toBe('000101');
  });

  test('filters cheque history', () => {
    const a = store.saveAccount(account);
    const b = store.saveAccount({ ...account, name: 'ENBD', templateId: null });
    const base = { chequeNo: '1', crossing: 'none' as const, remark: '', amountFils: 100 };
    store.recordCheque({ ...base, accountId: a.id, date: '2026-01-05', payee: 'Alpha' });
    store.recordCheque({ ...base, accountId: a.id, date: '2026-02-05', payee: 'Beta' });
    store.recordCheque({ ...base, accountId: b.id, date: '2026-03-05', payee: 'Alpha Two' });

    expect(store.listCheques({}).map(c => c.payee)).toEqual(['Alpha Two', 'Beta', 'Alpha']);
    expect(store.listCheques({ accountId: a.id }).map(c => c.payee)).toEqual(['Beta', 'Alpha']);
    expect(store.listCheques({ payee: 'alpha' }).map(c => c.payee)).toEqual(['Alpha Two', 'Alpha']);
    expect(store.listCheques({ from: '2026-02-01', to: '2026-02-28' }).map(c => c.payee)).toEqual(['Beta']);
  });

  test('deletes a cheque from history', () => {
    const a = store.saveAccount(account);
    const rec = store.recordCheque({ accountId: a.id, chequeNo: '1', date: '2026-10-19', payee: 'X', amountFils: 100, crossing: 'none', remark: '' });
    store.deleteCheque(rec.id);
    expect(store.listCheques({})).toEqual([]);
    // an account without cheques can be deleted again
    store.deleteAccount(a.id);
  });

  test('finds cheques by cheque number', () => {
    const a = store.saveAccount(account);
    const base = { accountId: a.id, date: '2026-10-19', payee: 'X', amountFils: 100, crossing: 'none' as const, remark: '' };
    store.recordCheque({ ...base, chequeNo: '000136' });
    store.recordCheque({ ...base, chequeNo: '000137' });
    expect(store.listCheques({ chequeNo: '136' }).map(c => c.chequeNo)).toEqual(['000136']);
    expect(store.listCheques({ chequeNo: ' 00013 ' })).toHaveLength(2);
  });

  test('combines customer, date range and cheque number filters', () => {
    const a = store.saveAccount(account);
    const base = { accountId: a.id, amountFils: 100, crossing: 'none' as const, remark: '' };
    store.recordCheque({ ...base, chequeNo: '1', date: '2026-01-10', payee: 'Acme Gulf' });
    store.recordCheque({ ...base, chequeNo: '2', date: '2026-03-10', payee: 'Acme Gulf' });
    store.recordCheque({ ...base, chequeNo: '3', date: '2026-03-12', payee: 'Other' });
    expect(store.listCheques({ payee: 'acme', from: '2026-03-01', to: '2026-03-31' }).map(c => c.chequeNo)).toEqual(['2']);
  });

  test('updates cheque status', () => {
    const a = store.saveAccount(account);
    const rec = store.recordCheque({ accountId: a.id, chequeNo: '1', date: '2026-10-19', payee: 'X', amountFils: 100, crossing: 'none', remark: '' });
    store.setChequeStatus(rec.id, 'void');
    expect(store.listCheques({})[0].status).toBe('void');
  });

  test('rejects invalid cheques', () => {
    const a = store.saveAccount(account);
    const ok = { accountId: a.id, chequeNo: '1', date: '2026-10-19', payee: 'X', amountFils: 100, crossing: 'none' as const, remark: '' };
    expect(() => store.recordCheque({ ...ok, payee: '' })).toThrow(/payee/i);
    expect(() => store.recordCheque({ ...ok, amountFils: 0 })).toThrow(/amount/i);
    expect(() => store.recordCheque({ ...ok, accountId: 999 })).toThrow(/account/i);
  });
});

describe('cheque book placement', () => {
  test('saves feed direction and page position per cheque book', () => {
    const a = store.saveAccount({ ...account, feedRotation: 270, pageX: 61.5, pageY: 2 });
    expect(store.listAccounts()[0]).toMatchObject({ feedRotation: 270, pageX: 61.5, pageY: 2 });
    store.saveAccount({ ...a, feedRotation: null, pageX: null, pageY: null });
    expect(store.listAccounts()[0]).toMatchObject({ feedRotation: null, pageX: null, pageY: null });
  });

  test('rejects an unknown feed direction', () => {
    expect(() => store.saveAccount({ ...account, feedRotation: 45 as never })).toThrow(/feed direction/);
  });

  test('adds the placement columns to a version 2 database', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, account_no TEXT NOT NULL DEFAULT '',
      template_id INTEGER, currency TEXT NOT NULL DEFAULT 'AED', last_cheque_no TEXT NOT NULL DEFAULT '',
      offset_x REAL NOT NULL DEFAULT 0, offset_y REAL NOT NULL DEFAULT 0);
      INSERT INTO accounts (name) VALUES ('RAK');
      PRAGMA user_version = 2;`);
    let saved = 0;
    const upgraded = createStore(db, () => saved++);
    // the upgrade is written to disk at once, so a copy of the file is never half old, half new
    expect(saved).toBe(1);
    expect(Number(db.exec('PRAGMA user_version')[0].values[0][0])).toBe(4);
    expect(upgraded.listAccounts()[0]).toMatchObject({ name: 'RAK', feedRotation: null, pageX: null, pageY: null });
    upgraded.saveAccount({ ...upgraded.listAccounts()[0], feedRotation: 90, pageX: 10, pageY: 0 });
    expect(upgraded.listAccounts()[0].feedRotation).toBe(90);
  });
});

describe('payees', () => {
  test('adds, renames and deletes payees', () => {
    store.addPayee('  Beta Trading ');
    store.addPayee('Alpha LLC');
    expect(store.listPayees()).toEqual(['Alpha LLC', 'Beta Trading']);
    store.renamePayee('Beta Trading', 'Beta Trading LLC');
    expect(store.listPayees()).toEqual(['Alpha LLC', 'Beta Trading LLC']);
    store.deletePayee('Alpha LLC');
    expect(store.listPayees()).toEqual(['Beta Trading LLC']);
  });

  test('rejects empty and duplicate names', () => {
    store.addPayee('Alpha');
    store.addPayee('Beta');
    expect(() => store.addPayee(' ')).toThrow(/required/);
    expect(() => store.addPayee('alpha')).toThrow(/already/);
    expect(() => store.renamePayee('Beta', 'ALPHA')).toThrow(/already/);
    store.renamePayee('Alpha', 'ALPHA');
    expect(store.listPayees()).toEqual(['ALPHA', 'Beta']);
  });

  test('renaming a payee keeps printed cheque history unchanged', () => {
    const a = store.saveAccount(account);
    store.recordCheque({ accountId: a.id, chequeNo: '1', date: '2026-10-19', payee: 'Old Name', amountFils: 100, crossing: 'none', remark: '' });
    store.renamePayee('Old Name', 'New Name');
    expect(store.listCheques({})[0].payee).toBe('Old Name');
  });
});

describe('templates', () => {
  test('saves, lists, updates and deletes templates', () => {
    const tpl = store.saveTemplate({ name: 'FAB current', layout: lineDateLayout(), image: 'data:image/jpeg;base64,AAA' });
    expect(tpl.id).toBeGreaterThan(0);
    expect(store.listTemplates()).toEqual([tpl]);
    const renamed = store.saveTemplate({ ...tpl, name: 'FAB business' });
    expect(renamed.name).toBe('FAB business');
    expect(renamed.layout).toEqual(lineDateLayout());
    store.deleteTemplate(tpl.id);
    expect(store.listTemplates()).toEqual([]);
  });

  test('refuses to delete a template used by an account', () => {
    const tpl = store.saveTemplate({ name: 'ADCB', layout: lineDateLayout(), image: null });
    store.saveAccount({ ...account, templateId: tpl.id });
    expect(() => store.deleteTemplate(tpl.id)).toThrow(/used by/);
  });

  test('rejects an image that is not an embedded picture', () => {
    expect(() => store.saveTemplate({ name: 'X', layout: lineDateLayout(), image: 'file:///C:/secret.jpg' })).toThrow(/embedded/);
  });

  test('rejects a template without a name', () => {
    expect(() => store.saveTemplate({ name: ' ', layout: lineDateLayout(), image: null })).toThrow(/name/);
  });
});

describe('print positions', () => {
  test('saves every kind of tray and rejects unknown trays or directions', () => {
    const pos = { name: 'Manual slot', tray: 'manual' as const, rotation: 0 as const, x: 2, y: 0, calibrated: true };
    const saved = store.saveAccount({ ...account, positions: [pos], feedRotation: 0, pageX: 2, pageY: 0 });
    expect(store.listAccounts().find(a => a.id === saved.id)?.positions).toEqual([pos]);
    expect(() => store.saveAccount({ ...account, positions: [{ ...pos, tray: 'roof' as never }] })).toThrow(/not valid/);
    expect(() => store.saveAccount({ ...account, positions: [{ ...pos, calibrated: 'yes' as never }] })).toThrow(/not valid/);
    expect(() => store.saveAccount({ ...account, positions: [], feedRotation: 45 as never })).toThrow(/feed direction/);
    expect(() => store.saveAccount({ ...account, positions: [], pageX: Number.NaN, pageY: 0 })).toThrow(/not valid/);
  });
});

describe('migration', () => {
  test('upgrades a version 1 database and keeps its data', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, account_no TEXT NOT NULL DEFAULT '',
      layout_id TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'AED', last_cheque_no TEXT NOT NULL DEFAULT '',
      offset_x REAL NOT NULL DEFAULT 0, offset_y REAL NOT NULL DEFAULT 0);
      INSERT INTO accounts (name, layout_id, last_cheque_no, offset_x) VALUES ('Old FAB', 'fab', '000555', 1.5);`);
    let saved = 0;
    const migrated = createStore(db, () => saved++);
    expect(saved).toBe(1);
    expect(migrated.listAccounts()).toEqual([
      { id: 1, name: 'Old FAB', accountNo: '', templateId: null, currency: 'AED', lastChequeNo: '000555', offsetX: 1.5, offsetY: 0, feedRotation: null, pageX: null, pageY: null, positions: [] },
    ]);
    const tpl = migrated.saveTemplate({ name: 'FAB', layout: lineDateLayout(), image: null });
    migrated.saveAccount({ ...migrated.listAccounts()[0], templateId: tpl.id });
    expect(migrated.listAccounts()[0].templateId).toBe(tpl.id);
  });
});

describe('settings', () => {
  test('returns defaults and merges saved values', () => {
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    store.saveSettings({ ...DEFAULT_SETTINGS, capitals: true });
    expect(store.getSettings().capitals).toBe(true);
  });
});

describe('print positions', () => {
  test('saves several positions per cheque book and keeps the active one', () => {
    const positions = [
      { name: 'Rear tray', rotation: 270 as const, x: 81.4, y: 0 },
      { name: 'Rear tray sideways', rotation: 0 as const, x: 2.1, y: 0 },
    ];
    const a = store.saveAccount({ ...account, positions, feedRotation: 270, pageX: 81.4, pageY: 0 });
    expect(store.listAccounts()[0].positions).toEqual(positions);
    expect(a.feedRotation).toBe(270);
  });

  test('rejects a broken position', () => {
    expect(() => store.saveAccount({ ...account, positions: [{ name: 'x', rotation: 45 as never, x: 0, y: 0 }] })).toThrow(/position/);
  });

  test('older cheque books without positions load with an empty list', () => {
    store.saveAccount(account);
    expect(store.listAccounts()[0].positions).toEqual([]);
  });
});
