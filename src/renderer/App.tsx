import { useCallback, useEffect, useState } from 'react';
import type { Account, ChequeTemplate, PrintSettings } from '../shared/types';
import { ChequeBooks } from './components/ChequeBooks';
import { HelpAbout } from './components/HelpAbout';
import { History } from './components/History';
import { Payees } from './components/Payees';
import { SettingsPanel } from './components/SettingsPanel';
import { WriteCheque } from './components/WriteCheque';

export type Tab = 'write' | 'books' | 'payees' | 'history' | 'settings' | 'help';

const TABS: Array<[Tab, string]> = [
  ['write', 'Write Cheque'],
  ['books', 'Cheque Books'],
  ['payees', 'Payees'],
  ['history', 'History'],
  ['settings', 'Settings'],
  ['help', 'Help & About'],
];

export function App() {
  const [tab, setTab] = useState<Tab>('write');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<ChequeTemplate[]>([]);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const [a, t] = await Promise.all([window.chequeApi.listAccounts(), window.chequeApi.listTemplates()]);
    setAccounts(a);
    setTemplates(t);
  }, []);

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
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'write' && <WriteCheque accounts={accounts} templates={templates} settings={settings} onPrinted={reload} onGoTo={setTab} />}
        {tab === 'books' && <ChequeBooks accounts={accounts} templates={templates} settings={settings} onChanged={reload} />}
        {tab === 'payees' && <Payees />}
        {tab === 'history' && <History accounts={accounts} settings={settings} />}
        {tab === 'settings' && <SettingsPanel settings={settings} onSave={saveSettings} />}
        {tab === 'help' && <HelpAbout />}
      </main>
    </div>
  );
}
