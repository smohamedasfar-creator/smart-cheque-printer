import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_REMINDER_DAYS, dueReminders, newReminders, reminderKey, todayIso, type Reminder } from '../shared/payments';
import { formatAmount } from '../shared/amountInWords';
import type { Account, ChequeRecord, ChequeTemplate, PrintSettings } from '../shared/types';
import { ChequeBooks } from './components/ChequeBooks';
import { HelpAbout } from './components/HelpAbout';
import { History } from './components/History';
import { Payments } from './components/Payments';
import { Payees } from './components/Payees';
import { SettingsPanel } from './components/SettingsPanel';
import { WriteCheque } from './components/WriteCheque';

export type Tab = 'write' | 'books' | 'payees' | 'history' | 'payments' | 'settings' | 'help';

const TABS: Array<[Tab, string]> = [
  ['write', 'Write Cheque'],
  ['books', 'Cheque Books'],
  ['payees', 'Payees'],
  ['history', 'History'],
  ['payments', 'Payments'],
  ['settings', 'Settings'],
  ['help', 'Help & About'],
];

export function App() {
  const [tab, setTab] = useState<Tab>('write');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<ChequeTemplate[]>([]);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [cheques, setCheques] = useState<ChequeRecord[]>([]);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const [a, t, c] = await Promise.all([window.chequeApi.listAccounts(), window.chequeApi.listTemplates(), window.chequeApi.listCheques({})]);
    setAccounts(a);
    setTemplates(t);
    setCheques(c);
  }, []);

  useEffect(() => {
    window.chequeApi.listCheques({}).then(setCheques).catch(() => undefined);
  }, [tab]);

  const reminders = settings ? dueReminders(cheques, todayIso(), settings.reminderDays ?? [...DEFAULT_REMINDER_DAYS]) : [];
  // A Windows notification when a cheque reaches a reminder: on opening the app and every hour while it is open.
  useEffect(() => {
    if (!settings || settings.reminderNotifications === false) return;
    const check = () => notifyReminders(dueReminders(cheques, todayIso(), settings.reminderDays ?? [...DEFAULT_REMINDER_DAYS]), () => setTab('payments'));
    check();
    const timer = setInterval(check, HOUR_MS);
    return () => clearInterval(timer);
  }, [cheques, settings]);

  useEffect(() => {
    Promise.all([reload(), window.chequeApi.getSettings().then(setSettings)]).catch(e => setError(String(e)));
  }, [reload]);

  const saveSettings = async (next: PrintSettings) => {
    await window.chequeApi.saveSettings(next);
    setSettings(next);
  };

  if (error) return <div className="fatal">Could not load data: {error}</div>;
  if (!settings) return <div className="loading">Loading…</div>;

  return (
    <div className="app">
      <header>
        <h1>Smart Cheque Printer</h1>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
              {id === 'payments' && reminders.length > 0 && <span className="tab-badge" title={`${reminders.length} cheque reminders`}>{reminders.length}</span>}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'write' && <WriteCheque accounts={accounts} templates={templates} settings={settings} onPrinted={reload} onGoTo={setTab} />}
        {tab === 'books' && <ChequeBooks accounts={accounts} templates={templates} settings={settings} onChanged={reload} />}
        {tab === 'payees' && <Payees />}
        {tab === 'history' && <History accounts={accounts} settings={settings} />}
        {tab === 'payments' && <Payments accounts={accounts} cheques={cheques} settings={settings} onChanged={reload} />}
        {tab === 'settings' && <SettingsPanel settings={settings} onSave={saveSettings} />}
        {tab === 'help' && <HelpAbout />}
      </main>
    </div>
  );
}

const HOUR_MS = 60 * 60 * 1000;
const SHOWN_KEY = 'scp-reminders-shown';

/** One notification for the reminders not shown before; each cheque comes back at its next reminder (15, 7 days, the day). */
function notifyReminders(reminders: Reminder[], onOpen: () => void) {
  let shown: Set<string>;
  try {
    shown = new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]') as string[]);
  } catch {
    shown = new Set();
  }
  const fresh = newReminders(reminders, shown);
  if (!fresh.length || typeof Notification === 'undefined') return;
  const total = fresh.reduce((s, r) => s + r.cheque.amountFils, 0);
  const soonest = fresh[0];
  const body =
    fresh.length === 1
      ? `${soonest.cheque.payee}: ${formatAmount(soonest.cheque.amountFils)}, cheque ${soonest.cheque.chequeNo} dated ${soonest.cheque.date}.`
      : `${fresh.length} cheques, ${formatAmount(total)} in all. The first is dated ${soonest.cheque.date}.`;
  const n = new Notification(fresh.length === 1 ? 'Cheque due soon' : 'Cheques due soon', { body });
  n.onclick = () => {
    window.focus();
    onOpen();
  };
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown, ...fresh.map(reminderKey)].slice(-2000)));
  } catch {
    // no storage: the reminder may show again next time
  }
}
