import { useState } from 'react';
import { formatAmount } from '../../shared/amountInWords';
import { addMonths, DEFAULT_REMINDER_DAYS, dueReminders, monthName, monthReport, todayIso, whenText } from '../../shared/payments';
import { chequesToCsv } from '../../shared/print';
import type { Account, ChequeRecord, PrintSettings } from '../../shared/types';

interface Props {
  accounts: Account[];
  cheques: ChequeRecord[];
  settings: PrintSettings;
  onChanged: () => Promise<void>;
}

/** Cheques to pay: reminders before their date and how much is paid in a month. */
export function Payments({ accounts, cheques, settings, onChanged }: Props) {
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [message, setMessage] = useState('');
  const days = settings.reminderDays ?? [...DEFAULT_REMINDER_DAYS];
  const reminders = dueReminders(cheques, today, days);
  const report = monthReport(cheques, month);
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? '';
  const upcoming = [1, 2, 3].map(n => monthReport(cheques, addMonths(today.slice(0, 7), n)));

  const setStatus = async (id: number, status: ChequeRecord['status']) => {
    await window.chequeApi.setChequeStatus(id, status);
    await onChanged();
  };

  const exportMonth = async () => {
    const result = await window.chequeApi.exportCsv(chequesToCsv(report.cheques, accountName));
    setMessage(result.saved ? `Saved to ${result.path}` : '');
  };

  return (
    <section className="payments">
      <div className="form">
        <h2>Reminders</h2>
        <p className="hint">
          Cheques not yet cleared, {days.slice().sort((a, b) => b - a).join(' and ')} days before their date, on the day, and after it until you mark them cleared.
          Change the days in Settings.
        </p>
        {reminders.length === 0 ? (
          <p className="success">Nothing due in the next {Math.max(...days, 0)} days.</p>
        ) : (
          <table className="reminders">
            <thead>
              <tr><th>When</th><th>Date</th><th>Cheque No</th><th>Payee</th><th className="num">Amount</th><th>Cheque book</th><th /></tr>
            </thead>
            <tbody>
              {reminders.map(r => (
                <tr key={r.cheque.id} className={`due-${typeof r.level === 'number' ? (r.level <= 7 ? 'week' : 'soon') : r.level}`}>
                  <td><span className="due-badge">{whenText(r.daysLeft)}</span></td>
                  <td>{r.cheque.date}</td>
                  <td>{r.cheque.chequeNo}</td>
                  <td>{r.cheque.payee}</td>
                  <td className="num">{formatAmount(r.cheque.amountFils)}</td>
                  <td>{accountName(r.cheque.accountId)}</td>
                  <td className="row-actions"><button onClick={() => setStatus(r.cheque.id, 'cleared')}>Mark cleared</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>{reminders.length} cheque{reminders.length === 1 ? '' : 's'}</td><td className="num">{formatAmount(reminders.reduce((s, r) => s + r.cheque.amountFils, 0))}</td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="form">
        <div className="month-head">
          <button onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Previous month">◀</button>
          <h2>{monthName(month)}</h2>
          <button onClick={() => setMonth(m => addMonths(m, 1))} aria-label="Next month">▶</button>
          {month !== today.slice(0, 7) && <button className="link" onClick={() => setMonth(today.slice(0, 7))}>This month</button>}
          <button onClick={exportMonth} disabled={!report.cheques.length}>Export CSV</button>
        </div>
        <div className="pay-cards">
          <div className="pay-card to-pay"><span>To pay</span><strong>{formatAmount(report.toPayFils)}</strong><span className="hint">printed, not yet cleared</span></div>
          <div className="pay-card"><span>Already cleared</span><strong>{formatAmount(report.clearedFils)}</strong></div>
          <div className="pay-card"><span>Total this month</span><strong>{formatAmount(report.totalFils)}</strong><span className="hint">{report.cheques.length} cheque{report.cheques.length === 1 ? '' : 's'} (void not counted)</span></div>
        </div>
        {message && <p className="success">{message}</p>}
        {report.byAccount.length > 1 && (
          <table className="by-account">
            <thead><tr><th>Cheque book</th><th className="num">Cheques</th><th className="num">To pay</th><th className="num">Total</th></tr></thead>
            <tbody>
              {report.byAccount.map(a => (
                <tr key={a.accountId}><td>{accountName(a.accountId)}</td><td className="num">{a.count}</td><td className="num">{formatAmount(a.toPayFils)}</td><td className="num">{formatAmount(a.totalFils)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <table>
          <thead>
            <tr><th>Date</th><th>Cheque No</th><th>Payee</th><th className="num">Amount</th><th>Cheque book</th><th>Status</th></tr>
          </thead>
          <tbody>
            {report.cheques.length === 0 && <tr><td colSpan={6} className="empty-row">No cheques dated in {monthName(month)}.</td></tr>}
            {report.cheques.map(c => (
              <tr key={c.id}>
                <td>{c.date}</td>
                <td>{c.chequeNo}</td>
                <td>{c.payee}</td>
                <td className="num">{formatAmount(c.amountFils)}</td>
                <td>{accountName(c.accountId)}</td>
                <td>
                  <select value={c.status} onChange={e => setStatus(c.id, e.target.value as ChequeRecord['status'])}>
                    <option value="printed">To pay</option>
                    <option value="cleared">Cleared</option>
                    <option value="void">Void</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Coming months</h3>
        <div className="pay-cards">
          {upcoming.map(u => (
            <button key={u.month} className="pay-card" onClick={() => setMonth(u.month)}>
              <span>{monthName(u.month)}</span>
              <strong>{formatAmount(u.toPayFils)}</strong>
              <span className="hint">{u.cheques.length} cheque{u.cheques.length === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
