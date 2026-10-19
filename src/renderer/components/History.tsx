import { useEffect, useState } from 'react';
import { formatAmount } from '../../shared/amountInWords';
import { chequesToCsv } from '../../shared/print';
import type { Account, ChequeRecord, PrintSettings } from '../../shared/types';

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

  const load = () =>
    window.chequeApi.listCheques({ accountId: accountId || undefined, payee: payee || undefined, chequeNo: chequeNo || undefined, from: from || undefined, to: to || undefined }).then(setRows);

  useEffect(() => {
    load();
  }, [accountId, payee, chequeNo, from, to]);

  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '';
  const active = rows.filter(r => r.status !== 'void');
  const total = active.reduce((sum, r) => sum + r.amountFils, 0);

  const setStatus = async (id: number, status: ChequeRecord['status']) => {
    await window.chequeApi.setChequeStatus(id, status);
    load();
  };

  const remove = async (r: ChequeRecord) => {
    if (!confirm(`Delete cheque ${r.chequeNo || ''} to "${r.payee}" (${formatAmount(r.amountFils)}) from the history? This cannot be undone.`)) return;
    await window.chequeApi.deleteCheque(r.id);
    load();
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
      <table>
        <thead>
          <tr><th>Date</th><th>Cheque No</th><th>Payee</th><th className="num">Amount</th><th>Cheque book</th><th>Remark</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="empty-row">No cheques yet.</td></tr>}
          {rows.map(r => (
            <tr key={r.id} className={r.status === 'void' ? 'void' : ''}>
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
          <tr><td colSpan={3}>{active.length} cheques (excluding void)</td><td className="num">{formatAmount(total)}</td><td colSpan={4} /></tr>
        </tfoot>
      </table>
    </section>
  );
}
