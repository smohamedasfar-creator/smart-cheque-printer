import { useEffect, useMemo, useState } from 'react';
import { formatAmount, parseAmountToFils } from '../../shared/amountInWords';
import { renderCheque, splitIntoWords } from '../../shared/chequeRender';
import { nextChequeNo } from '../../shared/print';
import { CROSSING_LABELS, type Account, type ChequeTemplate, type CrossingOption, type PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { ChequeCanvas } from './ChequeCanvas';
import { WordBreakPicker } from './WordBreakPicker';
import type { Tab } from '../App';

interface Props {
  accounts: Account[];
  templates: ChequeTemplate[];
  settings: PrintSettings;
  onPrinted: () => void;
  onGoTo: (tab: Tab) => void;
}

const today = () => new Date().toLocaleDateString('en-CA');

export function WriteCheque({ accounts, templates, settings, onPrinted, onGoTo }: Props) {
  const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 0);
  const [chequeNo, setChequeNo] = useState('');
  const [date, setDate] = useState(today());
  const [payee, setPayee] = useState('');
  const [amountText, setAmountText] = useState('');
  const [crossing, setCrossing] = useState<CrossingOption>('ac-payee-bearer');
  const [remark, setRemark] = useState('');
  const [payees, setPayees] = useState<string[]>([]);
  const [showLeaf, setShowLeaf] = useState(true);
  const [wordsBreakAt, setWordsBreakAt] = useState<number | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const account = accounts.find(a => a.id === accountId) ?? accounts[0];
  const template = templates.find(t => t.id === account?.templateId);

  useEffect(() => {
    window.chequeApi.listPayees().then(setPayees);
  }, []);

  useEffect(() => {
    if (account) setChequeNo(nextChequeNo(account.lastChequeNo));
  }, [account?.id, account?.lastChequeNo]);

  // A chosen break only makes sense for the text it was chosen for.
  useEffect(() => setWordsBreakAt(null), [amountText]);

  const amountFils = parseAmountToFils(amountText);
  const measure = useMemo(() => createMeasure(settings.fontFamily), [settings.fontFamily]);

  const rendered = useMemo(() => {
    if (!account || !template) return null;
    // The cheque book's fine-tuning moves text on the cheque; the printer calibration places the cheque on the page.
    const onCheque = { ...settings, offsetX: account.offsetX, offsetY: account.offsetY };
    const data = { date, payee: payee || ' ', amountFils: amountFils ?? 0, crossing, wordsBreakAt };
    try {
      return { preview: renderCheque(template.layout, data, { ...settings, offsetX: 0, offsetY: 0 }, measure), print: renderCheque(template.layout, data, onCheque, measure) };
    } catch (e) {
      return { error: String(e) };
    }
  }, [account, template, settings, date, payee, amountFils, crossing, wordsBreakAt, measure]);

  if (!templates.length) {
    return (
      <section className="empty">
        <p>Start by adding a cheque book: upload a scan of a blank cheque leaf and the app works out where to print.</p>
        <button className="primary" onClick={() => onGoTo('books')}>Add cheque book</button>
      </section>
    );
  }
  if (!account) {
    return (
      <section className="empty">
        <p>Add a cheque book to start printing.</p>
        <button className="primary" onClick={() => onGoTo('books')}>Add cheque book</button>
      </section>
    );
  }

  const problems = [
    !template && 'This cheque book has no cheque layout yet. Upload a blank cheque on the Cheque Books tab.',
    !payee.trim() && 'Enter a payee.',
    amountFils === null && amountText && 'Amount must be a number like 1250.50.',
    (!amountFils || amountFils <= 0) && 'Enter an amount.',
    rendered && 'error' in rendered && rendered.error,
  ].filter(Boolean) as string[];

  const print = async (testPrint: boolean) => {
    if (!template || !rendered || !('print' in rendered) || !rendered.print) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.chequeApi.print({ items: rendered.print.items, layout: template.layout, settings, testPrint, placement: { rotation: account.feedRotation, x: account.pageX, y: account.pageY } });
      if (!result.ok) {
        setStatus({ kind: 'error', text: result.error ?? 'Printing failed' });
        return;
      }
      if (testPrint) {
        setStatus({ kind: 'ok', text: 'Test page sent. Hold it over a real cheque against the light to check alignment.' });
        return;
      }
      await window.chequeApi.recordCheque({ accountId: account.id, chequeNo, date, payee, amountFils: amountFils!, crossing, remark });
      setStatus({ kind: 'ok', text: `Cheque ${chequeNo || ''} for ${formatAmount(amountFils!)} printed and saved.` });
      setPayee('');
      setAmountText('');
      setRemark('');
      setPayees(await window.chequeApi.listPayees());
      onPrinted();
    } catch (e) {
      setStatus({ kind: 'error', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const warnings = rendered && 'preview' in rendered && rendered.preview ? rendered.preview.warnings : [];
  const printed = (role: 'words') =>
    rendered && 'preview' in rendered && rendered.preview ? rendered.preview.items.filter(i => i.kind === 'text' && i.role === role).map(i => (i.kind === 'text' ? i.text : '')) : [];
  const wordLines = printed('words');
  const lineBreak = (lines: string[]) => (lines.length > 1 ? splitIntoWords(lines[0]).length : splitIntoWords(lines.join(' ')).length);

  return (
    <section className="write">
      {!settings.calibrated && (
        <div className="banner">
          <span><b>Set up your printer once before printing cheques.</b> A ruler page tells the app where your printer places the cheque.</span>
          <button onClick={() => onGoTo('settings')}>Calibrate printer</button>
        </div>
      )}
      <form className="form" onSubmit={e => { e.preventDefault(); if (!problems.length) print(false); }}>
        <label>
          Cheque book
          <select value={account.id} onChange={e => setAccountId(Number(e.target.value))}>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}{templates.some(t => t.id === a.templateId) ? '' : ' (no cheque layout yet)'}</option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            Cheque No
            <input value={chequeNo} onChange={e => setChequeNo(e.target.value)} />
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </label>
        </div>
        <label>
          Payee
          <input list="payees" value={payee} onChange={e => setPayee(e.target.value)} placeholder="Name of the person or company" autoFocus />
          <datalist id="payees">{payees.map(p => <option key={p} value={p} />)}</datalist>
        </label>
        <label>
          Amount ({account.currency})
          <input value={amountText} onChange={e => setAmountText(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </label>
        {amountFils !== null && amountFils > 0 && wordLines.length > 0 && (
          <WordBreakPicker
            label="Amount in words"
            words={splitIntoWords(wordLines.join(' '))}
            breakAt={wordsBreakAt}
            autoBreakAt={lineBreak(wordLines)}
            onChange={setWordsBreakAt}
          />
        )}
        <label>
          Crossing
          <select value={crossing} onChange={e => setCrossing(e.target.value as CrossingOption)}>
            {Object.entries(CROSSING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Remark (not printed)
          <input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Invoice no, purpose…" />
        </label>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || problems.length > 0}>Print cheque</button>
          <button type="button" disabled={busy || problems.length > 0} onClick={() => print(true)}>Test print on plain paper</button>
        </div>
        {problems.length > 0 && (amountText + payee !== '' || !template) && <p className="hint">{problems[0]}</p>}
        {status && <p className={status.kind === 'ok' ? 'success' : 'error'}>{status.text}</p>}
      </form>

      <div className="preview">
        {template && rendered && 'preview' in rendered && rendered.preview && (
          <ChequeCanvas layout={template.layout} items={rendered.preview.items} fontFamily={settings.fontFamily} image={showLeaf ? template.image : null} />
        )}
        {warnings.map(w => <p key={w} className="warning">{w}</p>)}
        {template?.image && (
          <label className="check"><input type="checkbox" checked={showLeaf} onChange={e => setShowLeaf(e.target.checked)} /> Show the cheque image (it is never printed)</label>
        )}
        <p className="hint">The preview shows where text lands on the cheque. Printer shifts from Settings and the account are applied when printing.</p>
      </div>
    </section>
  );
}
