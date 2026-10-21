import { useEffect, useMemo, useState } from 'react';
import { renderCheque } from '../../shared/chequeRender';
import { blankLayout } from '../../shared/layoutDefaults';
import { guessTray } from '../../shared/loading';
import { defaultTrayView, LEADING_EDGE, pageGeometry, pageToTray, printProblems, TRAY_KINDS, trayToPage, type Placement, type TrayKind } from '../../shared/print';
import type { Account, ChequeTemplate, FeedRotation, NewAccount, PrintPosition, PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { ChequeCanvas } from './ChequeCanvas';
import { PrintCorrection } from './PrintCorrection';
import { TrayPicture } from './TrayPicture';
import { TemplateEditor, type Draft } from './TemplateEditor';

interface Props {
  accounts: Account[];
  templates: ChequeTemplate[];
  settings: PrintSettings;
  onChanged: () => Promise<void>;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'design'; draft: Draft; account: NewAccount & { id?: number }; isNew: boolean }
  | { kind: 'details'; account: NewAccount & { id?: number }; isNew: boolean };

const NEW_ACCOUNT: NewAccount = { name: '', accountNo: '', templateId: null, currency: 'AED', lastChequeNo: '', offsetX: 0, offsetY: 0, feedRotation: null, pageX: null, pageY: null, positions: [] };

const FEED_OPTIONS: Array<{ value: FeedRotation; title: string; icon: string }> = [
  { value: 0, title: 'Top edge first', icon: '▭' },
  { value: 180, title: 'Bottom edge first', icon: '▭⟲' },
  { value: 90, title: 'Logo end first', icon: '▯↻' },
  { value: 270, title: 'Date end first', icon: '▯↺' },
];
const SAMPLE = { date: '2026-12-31', payee: 'Sample Payee Trading LLC', amountFils: 1_234_550, crossing: 'ac-payee-bearer' as const };

/** One place for everything about a cheque book: its bank details and the layout of its cheque leaf. */
export function ChequeBooks({ accounts, templates, settings, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const templateOf = (a: { templateId: number | null }) => templates.find(t => t.id === a.templateId);
  const unused = templates.filter(t => !accounts.some(a => a.templateId === t.id));

  const fail = (e: unknown) => setMessage({ kind: 'error', text: String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '') });

  const startNew = () =>
    setMode({ kind: 'design', isNew: true, account: { ...NEW_ACCOUNT }, draft: { name: '', layout: blankLayout(158, 80), image: null } });

  const editDesign = (account: Account) => {
    const t = templateOf(account);
    const draft: Draft = t ? { id: t.id, name: t.name, layout: t.layout, image: t.image } : { name: account.name, layout: blankLayout(158, 80), image: null };
    setMode({ kind: 'design', isNew: false, account, draft });
  };

  const remove = async (account: Account) => {
    if (!confirm(`Delete the cheque book "${account.name}"? Its cheque history must be deleted first.`)) return;
    try {
      await window.chequeApi.deleteAccount(account.id);
      const t = templateOf(account);
      if (t && !accounts.some(a => a.id !== account.id && a.templateId === t.id)) await window.chequeApi.deleteTemplate(t.id);
      await onChanged();
      setMessage({ kind: 'ok', text: `Deleted "${account.name}".` });
    } catch (e) {
      fail(e);
    }
  };

  const removeUnused = async (t: ChequeTemplate) => {
    if (!confirm(`Delete the unused cheque design "${t.name}"?`)) return;
    try {
      await window.chequeApi.deleteTemplate(t.id);
      await onChanged();
    } catch (e) {
      fail(e);
    }
  };

  if (mode.kind === 'design') {
    return (
      <section>
        <Steps step={1} isNew={mode.isNew} />
        <TemplateEditor
          initial={mode.draft}
          settings={settings}
          saveLabel={mode.isNew ? 'Next: cheque book details →' : 'Save cheque design'}
          onCancel={() => setMode({ kind: 'list' })}
          onSaved={async template => {
            const account = { ...mode.account, templateId: template.id, name: mode.account.name || template.name };
            if (mode.isNew) {
              // Reload so the details step can show and test-print the design just saved.
              await onChanged();
              setMode({ kind: 'details', isNew: true, account });
              return;
            }
            if ('id' in mode.account && mode.account.id) await window.chequeApi.saveAccount(account);
            await onChanged();
            setMode({ kind: 'list' });
            setMessage({ kind: 'ok', text: 'Cheque design saved.' });
          }}
        />
      </section>
    );
  }

  if (mode.kind === 'details') {
    return (
      <section>
        <Steps step={2} isNew={mode.isNew} />
        <DetailsForm
          account={mode.account}
          template={templateOf(mode.account)}
          settings={settings}
          onCancel={async () => {
            await onChanged();
            setMode({ kind: 'list' });
          }}
          onSave={async account => {
            await window.chequeApi.saveAccount(account);
            await onChanged();
            setMode({ kind: 'list' });
            setMessage({ kind: 'ok', text: `"${account.name}" is ready. Go to Write Cheque to print.` });
          }}
        />
      </section>
    );
  }

  return (
    <section className="books">
      <div className="templates-head">
        <div>
          <h2>Cheque books</h2>
          <p className="hint">Add one cheque book per bank account. Upload a scan of a blank cheque leaf and the app finds where to print.</p>
        </div>
        <button className="primary" onClick={startNew}>+ Add cheque book</button>
      </div>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      {accounts.length === 0 && <div className="empty">No cheque books yet. Click <b>Add cheque book</b> and upload a scan of a blank cheque leaf.</div>}

      <div className="template-grid">
        {accounts.map(a => {
          const t = templateOf(a);
          return (
            <div key={a.id} className="template-card">
              <div className="thumb" style={{ backgroundImage: t?.image ? `url(${t.image})` : undefined }}>
                {!t && <span className="thumb-missing">No cheque design yet</span>}
              </div>
              <div className="template-info">
                <strong>{a.name}</strong>
                <span className="hint">
                  {a.accountNo && <>A/C {a.accountNo} · </>}Last cheque {a.lastChequeNo || '—'}
                  {t && <> · {t.layout.chequeWidth.toFixed(0)} × {t.layout.chequeHeight.toFixed(0)} mm</>}
                </span>
              </div>
              <div className="actions">
                <button onClick={() => setMode({ kind: 'details', isNew: false, account: a })}>Details</button>
                <button className={t ? '' : 'primary'} onClick={() => editDesign(a)}>{t ? 'Cheque layout' : 'Upload blank cheque'}</button>
                <button onClick={() => remove(a)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {unused.length > 0 && (
        <>
          <h3>Cheque designs not used by any cheque book</h3>
          <div className="template-grid">
            {unused.map(t => (
              <div key={t.id} className="template-card">
                <div className="thumb" style={{ backgroundImage: t.image ? `url(${t.image})` : undefined }} />
                <div className="template-info"><strong>{t.name}</strong></div>
                <div className="actions">
                  <button className="primary" onClick={() => setMode({ kind: 'details', isNew: true, account: { ...NEW_ACCOUNT, name: t.name, templateId: t.id } })}>Use for a cheque book</button>
                  <button onClick={() => removeUnused(t)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Steps({ step, isNew }: { step: 1 | 2; isNew: boolean }) {
  if (!isNew) return null;
  return (
    <div className="steps">
      <span className={step === 1 ? 'active' : 'done'}>1. Upload blank cheque &amp; check layout</span>
      <span className={step === 2 ? 'active' : ''}>2. Cheque book details</span>
    </div>
  );
}

interface DetailsProps {
  account: NewAccount & { id?: number };
  template: ChequeTemplate | undefined;
  settings: PrintSettings;
  onCancel: () => void;
  onSave: (account: NewAccount & { id?: number }) => Promise<void>;
}

/** Index of the saved position the cheque book is using now, if any. */
export function activePositionIndex(a: Pick<Account, 'positions' | 'feedRotation' | 'pageX' | 'pageY'>): number {
  return a.positions.findIndex(p => p.rotation === a.feedRotation && p.x === a.pageX && p.y === a.pageY);
}

const TRAYS: Array<{ value: TrayKind; title: string; hint: string }> = [
  { value: 'rear', title: 'Back tray', hint: 'Paper stands up behind the printer, printed side facing you (most ink tank printers)' },
  { value: 'front', title: 'Front drawer', hint: 'Paper lies flat in a drawer or cassette, printed side down (most laser printers)' },
  { value: 'manual', title: 'Manual feed slot', hint: 'Paper lies flat on a manual feed or bypass tray, printed side up' },
];

export function describePosition(p: PrintPosition): string {
  return `${TRAYS.find(t => t.value === (p.tray ?? 'rear'))?.title} · ${LEADING_EDGE[p.rotation]}`;
}

/** The way most people load a cheque in each tray: date end first in a back tray, top edge first when lying flat. */
const defaultTurn = (t: TrayKind) => TRAY_KINDS[t].turnFor(t === 'rear' ? 270 : 0);

function DetailsForm({ account, template, settings, onCancel, onSave }: DetailsProps) {
  const positions0 = account.positions ?? [];
  const idx0 = activePositionIndex({ ...account, positions: positions0 });
  const [draft, setDraft] = useState({ ...account, positions: positions0 });
  const [activeIdx, setActiveIdx] = useState<number | null>(idx0 >= 0 ? idx0 : null);
  const [posName, setPosName] = useState(idx0 >= 0 ? positions0[idx0].name : positions0.length ? '' : 'Back tray');
  const [tray, setTray] = useState<TrayKind>(idx0 >= 0 ? positions0[idx0].tray ?? 'rear' : 'rear');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const measure = useMemo(() => createMeasure(settings.fontFamily), [settings.fontFamily]);
  const set = <K extends keyof NewAccount>(key: K, value: NewAccount[K]) => setDraft(d => ({ ...d, [key]: value }));
  const onCheque = { ...settings, offsetX: draft.offsetX, offsetY: draft.offsetY };
  const sample = template ? renderCheque(template.layout, SAMPLE, onCheque, measure) : null;
  const layout = template?.layout;

  // The placement printed now: the cheque book's own one, or a centred cheque pushed fully into the chosen tray.
  const placement: Placement | null = layout
    ? draft.pageX !== null && draft.pageY !== null && draft.feedRotation !== null
      ? { rotation: draft.feedRotation, x: draft.pageX, y: draft.pageY }
      : trayToPage(layout, tray, defaultTrayView(layout, tray, defaultTurn(tray)))
    : null;
  const view = layout && placement ? pageToTray(layout, tray, placement) : null;
  const setPlacement = (p: Placement) => setDraft(d => ({ ...d, feedRotation: p.rotation, pageX: p.x, pageY: p.y }));

  const chooseTray = (t: TrayKind) => {
    setTray(t);
    // A name the app filled in follows the tray; a name the user typed is kept.
    if (!posName.trim() || TRAYS.some(x => x.title === posName)) setPosName(TRAYS.find(x => x.value === t)?.title ?? '');
    if (layout) setPlacement(trayToPage(layout, t, defaultTrayView(layout, t, defaultTurn(t))));
  };
  // Start a new cheque book on the tray its printer usually uses for a single cheque (the user can change it).
  const [printerGuess, setPrinterGuess] = useState<{ name: string; tray: TrayKind; reason: string } | null>(null);
  useEffect(() => {
    let alive = true;
    window.chequeApi
      .listPrinters()
      .then(list => {
        const name = settings.printerName || list.find(p => p.isDefault)?.name || '';
        const guess = guessTray(name);
        if (!alive || !guess) return;
        setPrinterGuess({ name, ...guess });
        if (positions0.length === 0 && account.pageX === null) chooseTray(guess.tray);
      })
      .catch(() => {
        // no printer list: keep the back tray
      });
    return () => {
      alive = false;
    };
    // Only when the form opens: later tray changes are the user's.
  }, []);

  /** One of the four directions: re-seat the cheque pushed fully in and centred. */
  const chooseDirection = (r: FeedRotation) => {
    if (!layout) return;
    setPlacement(trayToPage(layout, tray, defaultTrayView(layout, tray, TRAY_KINDS[tray].turnFor(r))));
  };

  const current = (): PrintPosition | null =>
    placement ? { name: posName.trim() || `Position ${draft.positions.length + 1}`, tray, rotation: placement.rotation, x: placement.x, y: placement.y } : null;

  const withCurrent = (mode: 'update' | 'add') => {
    const c = current();
    if (!c) return draft;
    const positions = [...draft.positions];
    let idx = activeIdx;
    if (mode === 'add' || idx === null || idx >= positions.length) {
      positions.push(c);
      idx = positions.length - 1;
    } else {
      positions[idx] = c;
    }
    setActiveIdx(idx);
    return { ...draft, feedRotation: c.rotation, pageX: c.x, pageY: c.y, positions };
  };

  const editPosition = (i: number) => {
    const p = draft.positions[i];
    setActiveIdx(i);
    setPosName(p.name);
    setTray(p.tray ?? 'rear');
    setPlacement(p);
  };

  const removePosition = (i: number) => {
    setDraft(d => ({ ...d, positions: d.positions.filter((_, j) => j !== i) }));
    if (activeIdx === i) setActiveIdx(null);
    else if (activeIdx !== null && activeIdx > i) setActiveIdx(activeIdx - 1);
  };

  const newPosition = () => {
    const next = withCurrent('update');
    setDraft(next);
    setActiveIdx(null);
    setPosName('');
    setMessage({ kind: 'ok', text: 'Set up the new position below, then press Save cheque book.' });
  };

  const save = async () => {
    try {
      await onSave(withCurrent('update'));
    } catch (e) {
      setMessage({ kind: 'error', text: String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '') });
    }
  };

  const testPrint = async () => {
    if (!template || !sample || !placement) return;
    const result = await window.chequeApi.print({ items: sample.items, layout: template.layout, settings, testPrint: false, placement });
    setMessage(result.ok ? { kind: 'ok', text: 'Test sent. Compare it with the cheque, then drag the text in step 3 to where it printed.' } : { kind: 'error', text: result.error ?? 'Print failed' });
  };

  const rotation = placement?.rotation ?? 0;
  const onPage = layout && sample && placement ? printProblems(sample.items, pageGeometry(layout, settings, placement), measure) : [];
  return (
    <div className="details-layout">
      <div className="form">
        <h2>Cheque book details</h2>
        <label>Name<input value={draft.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main current account" autoFocus /></label>
        <div className="row">
          <label>Account No (optional)<input value={draft.accountNo} onChange={e => set('accountNo', e.target.value)} /></label>
          <label>Currency<input value={draft.currency} onChange={e => set('currency', e.target.value.toUpperCase().slice(0, 3))} /></label>
        </div>
        <label>Last cheque number used<input value={draft.lastChequeNo} onChange={e => set('lastChequeNo', e.target.value)} placeholder="e.g. 000123 — the next cheque will be 000124" /></label>

        <h3>Print positions</h3>
        <p className="hint">One position for every way this cheque book goes into a printer. You choose the position when printing.</p>
        {draft.positions.length > 0 && (
          <div className="positions">
            {draft.positions.map((p, i) => (
              <div key={i} className={i === activeIdx ? 'position active' : 'position'}>
                <div>
                  <strong>{p.name}</strong>
                  <span className="hint">{describePosition(p)}</span>
                </div>
                <div className="actions">
                  {i === activeIdx ? <span className="tag">Editing</span> : <button type="button" onClick={() => editPosition(i)}>Edit</button>}
                  <button type="button" onClick={() => removePosition(i)}>Delete</button>
                </div>
              </div>
            ))}
            <button type="button" onClick={newPosition}>+ Add another position</button>
          </div>
        )}
        <label>Position name<input value={posName} onChange={e => setPosName(e.target.value)} placeholder="e.g. Back tray · date end first" /></label>

        <h3>1. Which tray?</h3>
        {printerGuess && (
          <p className="hint">
            Usual for <b>{printerGuess.name}</b>: {TRAYS.find(t => t.value === printerGuess.tray)?.title}, because {printerGuess.reason}.
          </p>
        )}
        <div className="feed-options three">
          {TRAYS.map(t => (
            <button key={t.value} type="button" className={tray === t.value ? 'feed-option active' : 'feed-option'} onClick={() => chooseTray(t.value)}>
              <strong>{t.title}</strong>
              <span className="hint">{t.hint}</span>
            </button>
          ))}
        </div>

        <h3>2. Which end goes in first?</h3>
        <div className="feed-options">
          {FEED_OPTIONS.map(o => (
            <button key={o.value} type="button" className={rotation === o.value ? 'feed-option active' : 'feed-option'} title={LEADING_EDGE[o.value]} onClick={() => chooseDirection(o.value)}>
              <span className="feed-icon">{o.icon}</span>
              <span>{o.title}</span>
            </button>
          ))}
        </div>
        <p className="hint">Then slide the cheque on the tray picture to where it really sits, or line it up with a guide.</p>
        {onPage.map(w => <p key={w} className="warning">{w}</p>)}

        <h3>3. Test print and fix by dragging</h3>
        <p className="hint">
          Load a photocopy of a blank cheque cut to size (or a real cheque) exactly as the picture shows and press <b>Test print</b>. If the text lands in the wrong place, drag the text
          on the cheque picture (right) to where it printed and press <b>Fix position</b>. Print again to check.
        </p>
        <div className="actions">
          <button type="button" onClick={testPrint} disabled={!template}>Test print</button>
        </div>

        <div className="actions">
          <button className="primary" onClick={save}>Save cheque book</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      </div>
      {template && view && (
        <div className="preview placement-preview">
          <TrayPicture
            layout={template.layout}
            image={template.image}
            tray={tray}
            view={view}
            onChange={v => setPlacement(trayToPage(template.layout, tray, v))}
          />
          <div className="correction-panel">
            <h3>3. Drag the text to where it printed</h3>
            {sample && placement && (
              <PrintCorrection
                layout={template.layout}
                image={template.image}
                items={sample.items}
                fontFamily={settings.fontFamily}
                placement={placement}
                onApply={(next, what) => {
                  setPlacement(next);
                  setMessage({ kind: 'ok', text: `${what} Press Save cheque book to keep it.` });
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
