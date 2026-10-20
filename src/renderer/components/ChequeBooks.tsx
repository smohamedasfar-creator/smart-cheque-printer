import { useMemo, useState } from 'react';
import { renderCheque } from '../../shared/chequeRender';
import { blankLayout } from '../../shared/layoutDefaults';
import { A4_PAGE, footprint, pageGeometry } from '../../shared/print';
import type { Account, ChequeTemplate, FeedRotation, NewAccount, PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { ChequeCanvas } from './ChequeCanvas';
import { PagePlacement } from './PagePlacement';
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

const NEW_ACCOUNT: NewAccount = { name: '', accountNo: '', templateId: null, currency: 'AED', lastChequeNo: '', offsetX: 0, offsetY: 0, feedRotation: null, pageX: null, pageY: null };

const FEED_OPTIONS: Array<{ value: FeedRotation; title: string; hint: string; icon: string }> = [
  { value: 0, title: 'Sideways', hint: 'Long edge first, like a normal page turned sideways', icon: '▭' },
  { value: 270, title: 'Vertical ↺', hint: 'Short edge first, text turned anti-clockwise', icon: '▯↺' },
  { value: 90, title: 'Vertical ↻', hint: 'Short edge first, text turned clockwise', icon: '▯↻' },
  { value: 180, title: 'Upside down', hint: 'Long edge first, turned over', icon: '▭⟲' },
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

function DetailsForm({ account, template, settings, onCancel, onSave }: DetailsProps) {
  const [draft, setDraft] = useState(account);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const measure = useMemo(() => createMeasure(settings.fontFamily), [settings.fontFamily]);
  const set = <K extends keyof NewAccount>(key: K, value: NewAccount[K]) => setDraft(d => ({ ...d, [key]: value }));
  const onCheque = { ...settings, offsetX: draft.offsetX, offsetY: draft.offsetY };
  const sample = template ? renderCheque(template.layout, SAMPLE, onCheque, measure) : null;
  const placement = { rotation: draft.feedRotation, x: draft.pageX, y: draft.pageY };
  const rotation: FeedRotation = draft.feedRotation ?? settings.feedRotation ?? 0;
  // Where the leaf prints now: the hand-placed position, or the printer calibration.
  const at = template ? pageGeometry(template.layout, settings, placement) : null;
  const tenth = (v: number) => Math.round(v * 10) / 10;
  const place = (x: number, y: number) => setDraft(d => ({ ...d, pageX: tenth(x), pageY: tenth(y) }));
  const snapTo = (where: 'left' | 'center' | 'right') => {
    if (!template || !at) return;
    const [footW] = footprint(template.layout, rotation);
    place(where === 'left' ? 0 : where === 'right' ? A4_PAGE.width - footW : (A4_PAGE.width - footW) / 2, at.originY);
  };

  const save = async () => {
    try {
      await onSave(draft);
    } catch (e) {
      setMessage({ kind: 'error', text: String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '') });
    }
  };

  const testPrint = async () => {
    if (!template || !sample) return;
    const result = await window.chequeApi.print({ items: sample.items, layout: template.layout, settings, testPrint: true, placement });
    setMessage(result.ok ? { kind: 'ok', text: 'Test page sent. Hold it over a real cheque; adjust the fine-tuning below if needed.' } : { kind: 'error', text: result.error ?? 'Print failed' });
  };

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
        <h3>How does this cheque go into the printer?</h3>
        <div className="feed-options">
          {FEED_OPTIONS.map(o => (
            <button key={o.value} type="button" className={rotation === o.value ? 'feed-option active' : 'feed-option'} title={o.hint} onClick={() => set('feedRotation', o.value)}>
              <span className="feed-icon">{o.icon}</span>
              <span>{o.title}</span>
            </button>
          ))}
        </div>
        <p className="hint">{FEED_OPTIONS.find(o => o.value === rotation)?.hint}.{draft.feedRotation === null ? ' (Using the default from Settings.)' : ''}</p>

        <h3>Where does it sit on the page?</h3>
        <p className="hint">The page is shown <b>as the printer sees it</b>: the top is the end that goes in first, and left and right are mirrored compared with standing in front of the tray. Drag the leaf or use the buttons, then do a test print. If the text lands on the wrong side, try the other edge.</p>
        {at && (
          <>
            <div className="actions">
              <button type="button" onClick={() => snapTo('left')}>⇤ Left edge</button>
              <button type="button" onClick={() => snapTo('center')}>Centre</button>
              <button type="button" onClick={() => snapTo('right')}>Right edge ⇥</button>
            </div>
            <div className="row">
              <label>From left (mm)<input type="number" step="0.5" value={tenth(at.originX)} onChange={e => place(Number(e.target.value), at.originY)} /></label>
              <label>From top (mm)<input type="number" step="0.5" value={tenth(at.originY)} onChange={e => place(at.originX, Number(e.target.value))} /></label>
            </div>
            {draft.pageX !== null && (
              <button type="button" className="link" onClick={() => setDraft(d => ({ ...d, pageX: null, pageY: null }))}>Use the printer calibration from Settings instead</button>
            )}
          </>
        )}

        <details className="advanced">
          <summary>Printer fine-tuning for this cheque book (optional)</summary>
          <p className="hint">Only needed if a test print of this cheque book is slightly off after printer calibration.</p>
          <div className="row">
            <label>Shift right (mm)<input type="number" step="0.5" value={draft.offsetX} onChange={e => set('offsetX', Number(e.target.value))} /></label>
            <label>Shift down (mm)<input type="number" step="0.5" value={draft.offsetY} onChange={e => set('offsetY', Number(e.target.value))} /></label>
          </div>
        </details>
        <div className="actions">
          <button className="primary" onClick={save}>Save cheque book</button>
          <button onClick={testPrint} disabled={!template}>Test print</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      </div>
      {template && sample && at && (
        <div className="preview placement-preview">
          <PagePlacement layout={template.layout} image={template.image} rotation={rotation} x={at.originX} y={at.originY} onMove={place} />
          <ChequeCanvas layout={template.layout} items={sample.items} fontFamily={settings.fontFamily} image={template.image} scale={3} />
        </div>
      )}
    </div>
  );
}
