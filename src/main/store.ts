import type { Database, SqlValue } from 'sql.js';
import {
  DEFAULT_SETTINGS,
  type Account,
  type ChequeRecord,
  type ChequeTemplate,
  type NewTemplate,
  type NewAccount,
  type NewCheque,
  type PrintPosition,
  type PrintSettings,
} from '../shared/types';

const ACCOUNTS_TABLE = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_no TEXT NOT NULL DEFAULT '',
  template_id INTEGER REFERENCES templates(id),
  currency TEXT NOT NULL DEFAULT 'AED',
  last_cheque_no TEXT NOT NULL DEFAULT '',
  offset_x REAL NOT NULL DEFAULT 0,
  offset_y REAL NOT NULL DEFAULT 0,
  feed_rotation INTEGER,
  page_x REAL,
  page_y REAL,
  positions TEXT
);`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  layout TEXT NOT NULL,
  image TEXT,
  created_at TEXT NOT NULL
);
${ACCOUNTS_TABLE}
CREATE TABLE IF NOT EXISTS payees (name TEXT PRIMARY KEY COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS cheques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  cheque_no TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount_fils INTEGER NOT NULL,
  crossing TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'printed',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cheques_date ON cheques(date);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export interface ChequeFilter {
  /** Part of a cheque number, e.g. "136" matches 000136. */
  chequeNo?: string;
  accountId?: number;
  payee?: string;
  from?: string;
  to?: string;
}

type Row = Record<string, SqlValue>;

const SCHEMA_VERSION = 4;

/**
 * Version 1 stored a built-in bank layout id per account; version 2 links accounts to uploaded templates;
 * version 3 adds each cheque book's feed direction and page position; version 4 adds saved print positions.
 */
/** Returns true when an existing database was upgraded (it should be saved straight away). */
function migrate(db: Database): boolean {
  const version = Number(db.exec('PRAGMA user_version')[0].values[0][0]);
  if (version >= SCHEMA_VERSION) return false;
  const columns = db.exec("PRAGMA table_info('accounts')")[0]?.values.map(v => String(v[1])) ?? [];
  if (columns.includes('layout_id')) {
    db.exec(`BEGIN;
      ALTER TABLE accounts RENAME TO accounts_v1;
      ${ACCOUNTS_TABLE}
      INSERT INTO accounts (id, name, account_no, template_id, currency, last_cheque_no, offset_x, offset_y)
        SELECT id, name, account_no, NULL, currency, last_cheque_no, offset_x, offset_y FROM accounts_v1;
      DROP TABLE accounts_v1;
      COMMIT;`);
  }
  const now = db.exec("PRAGMA table_info('accounts')")[0]?.values.map(v => String(v[1])) ?? [];
  if (now.length) {
    for (const [name, type] of [['feed_rotation', 'INTEGER'], ['page_x', 'REAL'], ['page_y', 'REAL'], ['positions', 'TEXT']]) {
      if (!now.includes(name)) db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return version > 0 || columns.length > 0;
}

const ROTATIONS = [0, 90, 180, 270];
const TRAYS = ['rear', 'front', 'manual'];

function parsePositions(raw: SqlValue | undefined): PrintPosition[] {
  if (raw === null || raw === undefined || raw === '') return [];
  try {
    const list = JSON.parse(String(raw));
    return Array.isArray(list) ? list.filter(isPosition) : [];
  } catch {
    return [];
  }
}

function isPosition(p: unknown): p is PrintPosition {
  const v = p as PrintPosition;
  return (
    Boolean(v) && typeof v.name === 'string' && ROTATIONS.includes(v.rotation) && Number.isFinite(v.x) && Number.isFinite(v.y) &&
    (v.tray === undefined || TRAYS.includes(v.tray)) &&
    (v.calibrated === undefined || typeof v.calibrated === 'boolean') &&
    (v.active === undefined || typeof v.active === 'boolean')
  );
}

function toAccount(r: Row): Account {
  return {
    id: Number(r.id),
    name: String(r.name),
    accountNo: String(r.account_no),
    templateId: r.template_id === null ? null : Number(r.template_id),
    currency: String(r.currency),
    lastChequeNo: String(r.last_cheque_no),
    offsetX: Number(r.offset_x),
    offsetY: Number(r.offset_y),
    feedRotation: r.feed_rotation === null || r.feed_rotation === undefined ? null : (Number(r.feed_rotation) as Account['feedRotation']),
    pageX: r.page_x === null || r.page_x === undefined ? null : Number(r.page_x),
    pageY: r.page_y === null || r.page_y === undefined ? null : Number(r.page_y),
    positions: parsePositions(r.positions),
  };
}

function toTemplate(r: Row): ChequeTemplate {
  return {
    id: Number(r.id),
    name: String(r.name),
    layout: JSON.parse(String(r.layout)),
    image: r.image === null ? null : String(r.image),
    createdAt: String(r.created_at),
  };
}

function toCheque(r: Row): ChequeRecord {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    chequeNo: String(r.cheque_no),
    date: String(r.date),
    payee: String(r.payee),
    amountFils: Number(r.amount_fils),
    crossing: String(r.crossing) as ChequeRecord['crossing'],
    remark: String(r.remark),
    status: String(r.status) as ChequeRecord['status'],
    createdAt: String(r.created_at),
  };
}

/** Data access over a sql.js database. `persist` is called after every committed write. */
export function createStore(db: Database, persist: () => void) {
  const upgraded = migrate(db);
  db.exec(SCHEMA);
  if (upgraded) persist();

  const all = (sql: string, params: SqlValue[] = []): Row[] => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  };

  const write = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      persist();
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const lastId = () => Number(all('SELECT last_insert_rowid() AS id')[0].id);

  const getAccount = (id: number) => {
    const row = all('SELECT * FROM accounts WHERE id = ?', [id])[0];
    return row ? toAccount(row) : null;
  };

  return {
    listAccounts(): Account[] {
      return all('SELECT * FROM accounts ORDER BY name COLLATE NOCASE').map(toAccount);
    },

    saveAccount(input: NewAccount & { id?: number }): Account {
      if (!input.name.trim()) throw new Error('Account name is required');
      if (input.feedRotation !== null && !ROTATIONS.includes(input.feedRotation)) throw new Error('Unknown feed direction');
      const positions = input.positions ?? [];
      if (!positions.every(isPosition)) throw new Error('A saved print position is not valid');
      if ([input.pageX, input.pageY].some(v => v != null && !Number.isFinite(v))) throw new Error('The print position is not valid');
      const values = [input.name.trim(), input.accountNo.trim(), input.templateId, input.currency, input.lastChequeNo, input.offsetX, input.offsetY, input.feedRotation ?? null, input.pageX ?? null, input.pageY ?? null, JSON.stringify(positions)];
      return write(() => {
        if (input.id) {
          db.run(
            'UPDATE accounts SET name=?, account_no=?, template_id=?, currency=?, last_cheque_no=?, offset_x=?, offset_y=?, feed_rotation=?, page_x=?, page_y=?, positions=? WHERE id=?',
            [...values, input.id],
          );
          return getAccount(input.id)!;
        }
        db.run(
          'INSERT INTO accounts (name, account_no, template_id, currency, last_cheque_no, offset_x, offset_y, feed_rotation, page_x, page_y, positions) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          values,
        );
        return getAccount(lastId())!;
      });
    },

    deleteAccount(id: number): void {
      const used = Number(all('SELECT COUNT(*) AS n FROM cheques WHERE account_id = ?', [id])[0].n);
      if (used) throw new Error('This account has cheques in its history and cannot be deleted');
      write(() => db.run('DELETE FROM accounts WHERE id = ?', [id]));
    },

    listTemplates(): ChequeTemplate[] {
      return all('SELECT * FROM templates ORDER BY name COLLATE NOCASE').map(toTemplate);
    },

    saveTemplate(input: NewTemplate & { id?: number }): ChequeTemplate {
      if (!input.name.trim()) throw new Error('Template name is required');
      if (input.image !== null && !/^data:image\/(jpeg|png);base64,/.test(input.image)) throw new Error('Template image must be an embedded picture');
      const values: SqlValue[] = [input.name.trim(), JSON.stringify(input.layout), input.image];
      return write(() => {
        if (input.id) {
          db.run('UPDATE templates SET name=?, layout=?, image=? WHERE id=?', [...values, input.id]);
          return toTemplate(all('SELECT * FROM templates WHERE id = ?', [input.id])[0]);
        }
        db.run('INSERT INTO templates (name, layout, image, created_at) VALUES (?,?,?,?)', [...values, new Date().toISOString()]);
        return toTemplate(all('SELECT * FROM templates WHERE id = ?', [lastId()])[0]);
      });
    },

    deleteTemplate(id: number): void {
      const users = all('SELECT name FROM accounts WHERE template_id = ?', [id]).map(r => String(r.name));
      if (users.length) throw new Error(`This template is used by: ${users.join(', ')}`);
      write(() => db.run('DELETE FROM templates WHERE id = ?', [id]));
    },

    listPayees(): string[] {
      return all('SELECT name FROM payees ORDER BY name COLLATE NOCASE').map(r => String(r.name));
    },

    addPayee(name: string): void {
      const clean = name.trim();
      if (!clean) throw new Error('Payee name is required');
      if (all('SELECT 1 FROM payees WHERE name = ?', [clean]).length) throw new Error(`"${clean}" is already in the list`);
      write(() => db.run('INSERT INTO payees (name) VALUES (?)', [clean]));
    },

    /** Renames a saved payee. Cheques already printed keep the name they were printed with. */
    renamePayee(oldName: string, newName: string): void {
      const clean = newName.trim();
      if (!clean) throw new Error('Payee name is required');
      if (clean.toLowerCase() !== oldName.toLowerCase() && all('SELECT 1 FROM payees WHERE name = ?', [clean]).length) {
        throw new Error(`"${clean}" is already in the list`);
      }
      write(() => db.run('UPDATE payees SET name = ? WHERE name = ?', [clean, oldName]));
    },

    deletePayee(name: string): void {
      write(() => db.run('DELETE FROM payees WHERE name = ?', [name]));
    },

    recordCheque(input: NewCheque): ChequeRecord {
      const payee = input.payee.trim();
      if (!payee) throw new Error('Payee is required');
      if (!Number.isSafeInteger(input.amountFils) || input.amountFils <= 0) throw new Error('Amount must be greater than zero');
      if (!getAccount(input.accountId)) throw new Error('Unknown account');

      return write(() => {
        db.run(
          'INSERT INTO cheques (account_id, cheque_no, date, payee, amount_fils, crossing, remark, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [input.accountId, input.chequeNo, input.date, payee, input.amountFils, input.crossing, input.remark, 'printed', new Date().toISOString()],
        );
        const id = lastId();
        db.run('INSERT OR IGNORE INTO payees (name) VALUES (?)', [payee]);
        if (input.chequeNo) db.run('UPDATE accounts SET last_cheque_no = ? WHERE id = ?', [input.chequeNo, input.accountId]);
        return toCheque(all('SELECT * FROM cheques WHERE id = ?', [id])[0]);
      });
    },

    listCheques(filter: ChequeFilter): ChequeRecord[] {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.accountId) { where.push('account_id = ?'); params.push(filter.accountId); }
      if (filter.payee) { where.push('payee LIKE ?'); params.push(`%${filter.payee}%`); }
      if (filter.chequeNo) { where.push('cheque_no LIKE ?'); params.push(`%${filter.chequeNo.trim()}%`); }
      if (filter.from) { where.push('date >= ?'); params.push(filter.from); }
      if (filter.to) { where.push('date <= ?'); params.push(filter.to); }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return all(`SELECT * FROM cheques ${clause} ORDER BY date DESC, id DESC`, params).map(toCheque);
    },

    deleteCheque(id: number): void {
      write(() => db.run('DELETE FROM cheques WHERE id = ?', [id]));
    },

    setChequeStatus(id: number, status: ChequeRecord['status']): void {
      write(() => db.run('UPDATE cheques SET status = ? WHERE id = ?', [status, id]));
    },

    getSettings(): PrintSettings {
      const row = all("SELECT value FROM settings WHERE key = 'print'")[0];
      return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(String(row.value)) : {}) };
    },

    saveSettings(settings: PrintSettings): void {
      write(() => db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('print', ?)", [JSON.stringify(settings)]));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
