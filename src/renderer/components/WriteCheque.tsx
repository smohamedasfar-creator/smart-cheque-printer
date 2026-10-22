import { useEffect, useMemo, useState } from 'react';
import { formatAmount, parseAmountToFils } from '../../shared/amountInWords';
import { crossingFor } from '../../shared/banks';
import { renderCheque, splitIntoWords } from '../../shared/chequeRender';
import { adjustPosition, anyPositionSetUp, migratePositions, layoutForPosition, placementToShift, positionKeyOf, READY_POSITIONS, shiftFor, withReadyPositions, withShift } from '../../shared/positions';
import { LEADING_EDGE, nextChequeNo, pageGeometry, pageToTray, printProblems, type Placement } from '../../shared/print';
import { CROSSING_LABELS, type Account, type ChequeTemplate, type CrossingOption, type PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { ChequeCanvas } from './ChequeCanvas';
import { activePositionIndex } from './ChequeBookSetup';
import { PrintCorrection } from './PrintCorrection';
import { TrayPicture } from './TrayPicture';
import { WordBreakPicker } from './WordBreakPicker';
import { useFitScale } from '../useFitScale';
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
  // Every cheque book can print from the four ready positions, whatever it saved so far.
  const positions = account && template ? withReadyPositions(template.layout, account.positions) : account?.positions ?? [];
  const savedPlacement = account && account.feedRotation !== null && account.pageX !== null && account.pageY !== null ? { rotation: account.feedRotation, x: account.pageX, y: account.pageY } : null;
  const activePos = account ? (savedPlacement ? activePositionIndex({ ...account, positions }) : positions.length ? 0 : -1) : -1;
  // The preview shrinks to fit its column, so wide cheques are never cut off.
  const fit = useFitScale(template?.layout.chequeWidth ?? 200, 5);

  /** Makes a saved position the one this cheque book prints with (remembered for next time). */
  const choosePosition = async (i: number) => {
    const p = positions[i];
    if (!account || !p) return;
    await window.chequeApi.saveAccount({ ...account, positions, feedRotation: p.rotation, pageX: p.x, pageY: p.y });
    onPrinted();
  };

  /** Saves a drag correction to this cheque book and to the print position it is using. */
  const applyCorrection = async (next: Placement, what: string) => {
    if (!account) return;
    const key = template ? positionKeyOf(template.layout, positions[activePos]) : null;
    const from = placement.rotation !== null && placement.x !== null && placement.y !== null ? { rotation: placement.rotation, x: placement.x, y: placement.y } : null;
    if (template && key && from && next.rotation === from.rotation) {
      // A ready position keeps the correction as its own adjustment of the whole print.
      const now = shiftFor(template.layout, key);
      const d = placementToShift(template.layout, from, next);
      await window.chequeApi.saveTemplate({ id: template.id, name: template.name, image: template.image, layout: withShift(template.layout, key, { x: now.x + d.x, y: now.y + d.y }) });
    } else {
      const adjusted = activePos >= 0 ? adjustPosition(positions, activePos, next) : positions;
      await window.chequeApi.saveAccount({ ...account, positions: adjusted, feedRotation: next.rotation, pageX: next.x, pageY: next.y });
    }
    setStatus({ kind: 'ok', text: `${what} Saved.` });
    onPrinted();
  };

  useEffect(() => {
    window.chequeApi.listPayees().then(setPayees);
  }, []);

  // Older cheque books kept corrections in the page placement: turn them into the positions' own adjustments, once.
  useEffect(() => {
    if (!account || !template) return;
    const m = migratePositions(template.layout, account.positions);
    if (!m.changed) return;
    const old = withReadyPositions(template.layout, account.positions);
    const i = activePositionIndex({ ...account, positions: old });
    const active = i >= 0 ? m.positions[i] : null;
    (async () => {
      await window.chequeApi.saveTemplate({ id: template.id, name: template.name, image: template.image, layout: m.layout });
      await window.chequeApi.saveAccount({ ...account, positions: m.positions, ...(active ? { feedRotation: active.rotation, pageX: active.x, pageY: active.y } : {}) });
      onPrinted();
    })().catch(e => setStatus({ kind: 'error', text: String(e) }));
  }, [account?.id, template?.id, template?.layout.positionsVersion]);

  useEffect(() => {
    if (account) setChequeNo(nextChequeNo(account.lastChequeNo));
  }, [account?.id, account?.lastChequeNo]);

  // Each cheque design has its own crossing, e.g. only the "or bearer" strike when A/C PAYEE is already printed.
  useEffect(() => setCrossing(template ? crossingFor(template.layout) : 'ac-payee-bearer'), [template?.id, template?.layout.defaultCrossing]);

  // A chosen break only makes sense for the text it was chosen for.
  useEffect(() => setWordsBreakAt(null), [amountText]);

  const amountFils = parseAmountToFils(amountText);
  const measure = useMemo(() => createMeasure(settings.fontFamily), [settings.fontFamily]);

  const rendered = useMemo(() => {
    if (!account || !template) return null;
    // The cheque book's fine-tuning and the print position's own adjustment move text on the cheque; the printer
    // calibration places the cheque on the page.
    const key = positionKeyOf(template.layout, positions[activePos]);
    const onCheque = { ...settings, offsetX: account.offsetX, offsetY: account.offsetY };
    const printed = layoutForPosition(template.layout, key);
    const data = { date, payee: payee || ' ', amountFils: amountFils ?? 0, crossing, wordsBreakAt };
    try {
      return { preview: renderCheque(printed, data, { ...settings, offsetX: 0, offsetY: 0 }, measure), print: renderCheque(printed, data, onCheque, measure) };
    } catch (e) {
      return { error: String(e) };
    }
  }, [account, template, settings, date, payee, amountFils, crossing, wordsBreakAt, measure, activePos]);

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

  const ready = positions[activePos];
  const placement = savedPlacement ?? (ready ? { rotation: ready.rotation, x: ready.x, y: ready.y } : { rotation: account.feedRotation, x: account.pageX, y: account.pageY });
  const print = async (testPrint: boolean) => {
    if (!template || !rendered || !('print' in rendered) || !rendered.print) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await window.chequeApi.print({ items: rendered.print.items, layout: template.layout, settings, testPrint, placement, tray: positions[activePos]?.tray ?? 'rear' });
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

  const onPage = template && rendered && 'print' in rendered && rendered.print ? printProblems(rendered.print.items, pageGeometry(template.layout, settings, placement), measure) : [];
  const warnings = [...(rendered && 'preview' in rendered && rendered.preview ? rendered.preview.warnings : []), ...onPage];
  const printed = (role: 'words') =>
    rendered && 'preview' in rendered && rendered.preview ? rendered.preview.items.filter(i => i.kind === 'text' && i.role === role).map(i => (i.kind === 'text' ? i.text : '')) : [];
  const wordLines = printed('words');
  const lineBreak = (lines: string[]) => (lines.length > 1 ? splitIntoWords(lines[0]).length : splitIntoWords(lines.join(' ')).length);

  return (
    <section className="write">
      {template && !anyPositionSetUp(template.layout) && !positions[activePos]?.calibrated && !settings.calibrated && (
        <div className="banner">
          <span><b>Set up printing for this cheque book once.</b> Test print on a photocopy and move the print with the arrows if the text is off the lines.</span>
          <button onClick={() => onGoTo('books')}>Set up printing</button>
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
        {positions.length > 1 && (
          <label>
            Print position (how the cheque is loaded)
            <select value={activePos} onChange={e => choosePosition(Number(e.target.value))}>
              {activePos < 0 && <option value={-1}>Current setting · {LEADING_EDGE[account.feedRotation ?? settings.feedRotation ?? 0]}</option>}
              {positions.map((p, i) => (
                <option key={i} value={i}>{i < READY_POSITIONS.length ? p.name : `${p.name} · ${LEADING_EDGE[p.rotation]}`}</option>
              ))}
            </select>
          </label>
        )}
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

      <div className="preview" ref={fit.ref}>
        {template && rendered && 'preview' in rendered && rendered.preview && (
          <ChequeCanvas layout={template.layout} items={rendered.preview.items} fontFamily={settings.fontFamily} image={showLeaf ? template.image : null} scale={fit.scale} />
        )}
        {warnings.map(w => <p key={w} className="warning">{w}</p>)}
        {template?.image && (
          <label className="check"><input type="checkbox" checked={showLeaf} onChange={e => setShowLeaf(e.target.checked)} /> Show the cheque image (it is never printed)</label>
        )}
        <p className="hint">The preview shows where text lands on the cheque.</p>
        {template && placement.rotation !== null && placement.x !== null && placement.y !== null && (
          <details className="advanced loading-guide" open>
            <summary>How to load this cheque</summary>
            <TrayPicture
              layout={template.layout}
              image={template.image}
              tray={positions[activePos]?.tray ?? 'rear'}
              view={pageToTray(template.layout, positions[activePos]?.tray ?? 'rear', { rotation: placement.rotation, x: placement.x, y: placement.y })}
              interactive={false}
              scale={0.9}
            />
          </details>
        )}
        {template && rendered && 'print' in rendered && rendered.print && placement.rotation !== null && placement.x !== null && placement.y !== null && (
          <details className="advanced">
            <summary>Printed in the wrong place? Fix it by dragging</summary>
            <p className="hint">Drag the text to where it printed on your cheque (or test page), then press Fix position. The next print moves it back.</p>
            <PrintCorrection
              layout={template.layout}
              image={template.image}
              items={rendered.print.items}
              fontFamily={settings.fontFamily}
              placement={{ rotation: placement.rotation, x: placement.x, y: placement.y }}
              onApply={applyCorrection}
              scale={2.6}
            />
          </details>
        )}
      </div>
    </section>
  );
}
