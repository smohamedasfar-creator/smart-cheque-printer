import { useEffect, useState } from 'react';
import { formatAmount } from '../../shared/amountInWords';
import { chequesToCsv } from '../../shared/print';
import type { Account, ChequeRecord, PrintSettings } from '../../shared/types';
import { withAdmin } from '../admin';

interface Props {
  accounts: Account[];
  settings: PrintSettings;
}

export function History({ accounts }: Props) {
  const [accountId, setAccountId] = useState(0);
  const [payee, setPayee] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<ChequeRecord[]>([]);
  const [message, setMessage] = useState('');
  /** Ticked cheques (by id). */
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const load = () =>
    window.chequeApi.listCheques({ accountId: accountId || undefined, payee: payee || undefined, chequeNo: chequeNo || undefined, from: from || undefined, to: to || undefined }).then(setRows);

  useEffect(() => {
    load();
  }, [accountId, payee, chequeNo, from, to]);
  // Only cheques still on screen stay ticked.
  useEffect(() => setPicked(p => new Set(rows.filter(r => p.has(r.id)).map(r => r.id))), [rows]);

  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id));
  const toggle = (id: number) => setPicked(p => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.id)));
  const pickedRows = rows.filter(r => picked.has(r.id));
  const pickedTotal = pickedRows.reduce((sum, r) => sum + r.amountFils, 0);

  const removePicked = async () => {
    const n = pickedRows.length;
    if (!n || !confirm(`Delete ${n} cheque${n > 1 ? 's' : ''} (${formatAmount(pickedTotal)}) from the history? This cannot be undone.`)) return;
    const deleted = await withAdmin(() => window.chequeApi.deleteCheques(pickedRows.map(r => r.id)), 'Deleting cheques needs the admin password.');
    if (deleted === undefined) return;
    setPicked(new Set());
    setMessage(`Deleted ${deleted} cheque${deleted === 1 ? '' : 's'}.`);
    load();
  };

  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '';
  const active = rows.filter(r => r.status !== 'void');
  const total = active.reduce((sum, r) => sum + r.amountFils, 0);

  const setStatus = async (id: number, status: ChequeRecord['status']) => {
    await window.chequeApi.setChequeStatus(id, status);
    load();
  };

  const remove = async (r: ChequeRecord) => {
    if (!confirm(`Delete cheque ${r.chequeNo || ''} to "${r.payee}" (${formatAmount(r.amountFils)}) from the history? This cannot be undone.`)) return;
    const done = await withAdmin(() => window.chequeApi.deleteCheque(r.id).then(() => true), 'Deleting cheques needs the admin password.');
    if (done) load();
  };

  const exportCsv = async () => {
    const result = await window.chequeApi.exportCsv(chequesToCsv(rows, accountName));
    setMessage(result.saved ? `Saved to ${result.path}` : '');
  };

  return (
    <section className="history">
      <div className="filters">
        <select value={accountId} onChange={e => setAccountId(Number(e.target.value))}>
          <option value={0}>All cheque books</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input placeholder="Customer / payee name" value={payee} onChange={e => setPayee(e.target.value)} />
        <input placeholder="Cheque no" value={chequeNo} onChange={e => setChequeNo(e.target.value)} className="short" />
        <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        {(accountId || payee || chequeNo || from || to) ? <button onClick={() => { setAccountId(0); setPayee(''); setChequeNo(''); setFrom(''); setTo(''); }}>Clear filters</button> : null}
        <button onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      {message && <p className="success">{message}</p>}
      {picked.size > 0 && (
        <div className="selection-bar">
          <span><b>{picked.size}</b> selected · {formatAmount(pickedTotal)}</span>
          <button className="danger" onClick={removePicked}>Delete selected</button>
          <button onClick={() => setPicked(new Set())}>Clear selection</button>
        </div>
      )}
      <table>
        <thead>
          <tr><th className="pick"><input type="checkbox" aria-label="Select all" title="Select all" checked={allPicked} onChange={toggleAll} disabled={!rows.length} /></th><th>Date</th><th>Cheque No</th><th>Payee</th><th className="num">Amount</th><th>Cheque book</th><th>Remark</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={9} className="empty-row">No cheques yet.</td></tr>}
          {rows.map(r => (
            <tr key={r.id} className={[r.status === 'void' ? 'void' : '', picked.has(r.id) ? 'picked' : ''].join(' ').trim()}>
              <td className="pick"><input type="checkbox" aria-label={`Select cheque ${r.chequeNo}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
              <td>{r.date}</td>
              <td>{r.chequeNo}</td>
              <td>{r.payee}</td>
              <td className="num">{formatAmount(r.amountFils)}</td>
              <td>{accountName(r.accountId)}</td>
              <td>{r.remark}</td>
              <td>
                <select value={r.status} onChange={e => setStatus(r.id, e.target.value as ChequeRecord['status'])}>
                  <option value="printed">Printed</option>
                  <option value="cleared">Cleared</option>
                  <option value="void">Void</option>
                </select>
              </td>
              <td className="row-actions"><button onClick={() => remove(r)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td /><td colSpan={3}>{active.length} cheques (excluding void)</td><td className="num">{formatAmount(total)}</td><td colSpan={4} /></tr>
        </tfoot>
      </table>
    </section>
  );
}
