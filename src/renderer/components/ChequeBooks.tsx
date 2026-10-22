import { useRef, useState } from 'react';
import { blankLayout } from '../../shared/layoutDefaults';
import { migratePositions, POSITIONS_VERSION, withReadyPositions } from '../../shared/positions';
import type { Account, ChequeTemplate, NewAccount, PrintSettings } from '../../shared/types';
import { activePositionIndex, ChequeBookSetup, type BookDraft } from './ChequeBookSetup';
import { TemplateEditor, type Draft } from './TemplateEditor';

interface Props {
  accounts: Account[];
  templates: ChequeTemplate[];
  settings: PrintSettings;
  onChanged: () => Promise<void>;
}

type Mode = { kind: 'list' } | { kind: 'edit'; draft: Draft; account: BookDraft; isNew: boolean };

const NEW_ACCOUNT: NewAccount = { name: '', accountNo: '', templateId: null, currency: 'AED', lastChequeNo: '', offsetX: 0, offsetY: 0, feedRotation: null, pageX: null, pageY: null, positions: [] };

const cleanError = (e: unknown) => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

/**
 * Opens a cheque book on its one screen. Older cheque books are brought up to date here (once): their print
 * corrections become the positions' X / Y, and the position they print with is kept.
 */
function openBook(account: BookDraft, t: ChequeTemplate | undefined): Mode {
  if (!t) return { kind: 'edit', isNew: account.id === undefined, account, draft: { name: account.name, layout: blankLayout(158, 80), image: null } };
  const m = migratePositions(t.layout, account.positions ?? []);
  const old = withReadyPositions(t.layout, account.positions ?? []);
  const i = activePositionIndex({ ...account, positions: old });
  const active = i >= 0 ? m.positions[i] : null;
  const book = { ...account, positions: m.positions, ...(active ? { feedRotation: active.rotation, pageX: active.x, pageY: active.y } : {}) };
  return { kind: 'edit', isNew: account.id === undefined, account: book, draft: { id: t.id, name: account.name || t.name, layout: m.layout, image: t.image } };
}

/** One place for everything about a cheque book: its cheque layout, its details and how it prints, on one screen. */
export function ChequeBooks({ accounts, templates, settings, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const templateOf = (a: { templateId: number | null }) => templates.find(t => t.id === a.templateId);
  const unused = templates.filter(t => !accounts.some(a => a.templateId === t.id));

  const fail = (e: unknown) => setMessage({ kind: 'error', text: cleanError(e) });

  const startNew = () => setMode({ kind: 'edit', isNew: true, account: { ...NEW_ACCOUNT }, draft: { name: '', layout: blankLayout(158, 80), image: null } });

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

  if (mode.kind === 'edit') {
    return (
      <BookScreen
        key={mode.account.id ?? 'new'}
        initial={mode}
        settings={settings}
        onCancel={() => setMode({ kind: 'list' })}
        onSaved={async name => {
          await onChanged();
          setMode({ kind: 'list' });
          setMessage({ kind: 'ok', text: `"${name}" is saved. Go to Write Cheque to print.` });
        }}
      />
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
                <button className="primary" onClick={() => setMode(openBook(a, t))}>{t ? 'Open' : 'Upload blank cheque'}</button>
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
                  <button className="primary" onClick={() => setMode(openBook({ ...NEW_ACCOUNT, name: t.name, templateId: t.id }, t))}>Use for a cheque book</button>
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

/** The cheque layout (upload, fields, the four positions) and the cheque book details with printing set-up, saved together. */
function BookScreen({ initial, settings, onCancel, onSaved }: { initial: Extract<Mode, { kind: 'edit' }>; settings: PrintSettings; onCancel: () => void; onSaved: (name: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const readBook = useRef<() => BookDraft>(() => initial.account);
  const hasLeaf = draft.image !== null || draft.id !== undefined;

  const save = async () => {
    const name = draft.name.trim();
    if (!name) return setError('Give the cheque book a name, for example "FAB current account".');
    if (!hasLeaf) return setError('Upload a scan of a blank cheque leaf first.');
    if (blocked) return setError(blocked);
    setError('');
    setSaving(true);
    try {
      // Saved with the current print position data, so it is never brought up to date again.
      const template = await window.chequeApi.saveTemplate({ id: draft.id, name, layout: { ...draft.layout, positionsVersion: POSITIONS_VERSION }, image: draft.image });
      await window.chequeApi.saveAccount({ ...readBook.current(), name, templateId: template.id });
      await onSaved(name);
    } catch (e) {
      setError(cleanError(e));
      setSaving(false);
    }
  };

  return (
    <section className="book-screen">
      <TemplateEditor draft={draft} setDraft={setDraft} settings={settings} onBlock={setBlocked} />
      {hasLeaf && (
        <ChequeBookSetup
          account={initial.account}
          layout={draft.layout}
          image={draft.image}
          onLayout={layout => setDraft(d => ({ ...d, layout }))}
          settings={settings}
          bind={read => { readBook.current = read; }}
        />
      )}
      <div className="book-actions">
        <button className="primary" onClick={save} disabled={saving}>Save cheque book</button>
        <button onClick={onCancel} disabled={saving}>Cancel</button>
        {error && <span className="error">{error}</span>}
      </div>
    </section>
  );
}
