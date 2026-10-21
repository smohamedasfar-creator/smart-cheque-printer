import { useEffect, useMemo, useRef, useState } from 'react';
import { renderCheque } from '../../shared/chequeRender';
import { blankLayout } from '../../shared/layoutDefaults';
import { guessTray } from '../../shared/loading';
import { correctPlacement, defaultTrayView, LEADING_EDGE, pageGeometry, pageToTray, printProblems, TRAY_KINDS, trayToPage, type Placement, type TrayKind } from '../../shared/print';
import type { Account, ChequeTemplate, FeedRotation, NewAccount, PrintPosition, PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { calibrateAsync, imageRaster, loadUpload } from '../upload';
import { correctionFromCorner } from '../../shared/graph';
import { adjustPosition, moveFieldShiftIntoPositions, READY_POSITIONS, withReadyPositions } from '../../shared/positions';
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

/**
 * The fields of `template` went back onto the cheque lines by `moved`: every cheque book using it keeps printing where it
 * did, and the same tray's other direction takes the correction as a page shift. Returns how many were changed.
 */
async function takeOverFieldShift(template: ChequeTemplate, moved: { x: number; y: number }): Promise<number> {
  const books = (await window.chequeApi.listAccounts()).filter(a => a.templateId === template.id && a.feedRotation !== null && a.pageX !== null && a.pageY !== null);
  for (const a of books) {
    const positions = withReadyPositions(template.layout, a.positions);
    const idx = activePositionIndex({ ...a, positions });
    const next = moveFieldShiftIntoPositions(template.layout, positions, idx, moved);
    // A placement not saved as a position still keeps printing where it did.
    const active = idx >= 0 ? next[idx] : correctPlacement(template.layout, { rotation: a.feedRotation!, x: a.pageX!, y: a.pageY! }, moved.x, moved.y);
    await window.chequeApi.saveAccount({ ...a, positions: next, feedRotation: active.rotation, pageX: active.x, pageY: active.y });
  }
  return books.length;
}

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
          onSaved={async (template, fieldsMoved) => {
            const account = { ...mode.account, templateId: template.id, name: mode.account.name || template.name };
            if (mode.isNew) {
              // Reload so the details step can show and test-print the design just saved.
              await onChanged();
              setMode({ kind: 'details', isNew: true, account });
              return;
            }
            if ('id' in mode.account && mode.account.id) await window.chequeApi.saveAccount(account);
            const moved = fieldsMoved && (Math.abs(fieldsMoved.x) >= 0.1 || Math.abs(fieldsMoved.y) >= 0.1) ? await takeOverFieldShift(template, fieldsMoved) : 0;
            await onChanged();
            setMode({ kind: 'list' });
            setMessage({
              kind: 'ok',
              text: moved
                ? `Cheque design saved. The fields are back on the cheque lines and the print moved with them, so cheques print where they did. The other direction of the same tray is corrected too: test print it once to check.`
                : 'Cheque design saved.',
            });
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

/** Cheques go in date end first by default: lengthways they are long enough in the feed direction not to jam. */
const defaultTurn = (t: TrayKind) => TRAY_KINDS[t].turnFor(270);

function DetailsForm({ account, template, settings, onCancel, onSave }: DetailsProps) {
  // The four ready positions are always there; a new cheque book starts on the first (back tray, vertical).
  const positions0 = template ? withReadyPositions(template.layout, account.positions ?? []) : account.positions ?? [];
  const unplaced = account.pageX === null || account.pageY === null || account.feedRotation === null;
  const saved0 = activePositionIndex({ ...account, positions: positions0 });
  const idx0 = saved0 >= 0 ? saved0 : unplaced && positions0.length ? 0 : -1;
  const start0 = unplaced && idx0 >= 0 ? { feedRotation: positions0[idx0].rotation, pageX: positions0[idx0].x, pageY: positions0[idx0].y } : {};
  const [draft, setDraft] = useState({ ...account, ...start0, positions: positions0 });
  const [activeIdx, setActiveIdx] = useState<number | null>(idx0 >= 0 ? idx0 : null);
  const [posName, setPosName] = useState(idx0 >= 0 ? positions0[idx0].name : positions0.length ? '' : 'Back tray');
  const [tray, setTray] = useState<TrayKind>(idx0 >= 0 ? positions0[idx0].tray ?? 'rear' : 'rear');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [calibrated, setCalibrated] = useState(idx0 >= 0 && positions0[idx0].calibrated === true);
  const [busy, setBusy] = useState('');
  const [advanced, setAdvanced] = useState(false);
  /** The position the last test page was printed for: the scan is read against it. */
  const [testedFor, setTestedFor] = useState<Placement | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  /** The graph numbers read on the printed paper's bottom-left corner, as typed. */
  const [corner, setCorner] = useState({ x: '', y: '' });
  /** How far the whole print was moved with the arrow buttons, in mm on the cheque (right and up positive). */
  const [moved, setMoved] = useState({ x: 0, y: 0 });
  /** A test print was made: saving after it means the user saw the print land in place. */
  const [tested, setTested] = useState(false);
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
    setCalibrated(false);
    setMoved({ x: 0, y: 0 });
    setTested(false);
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
        if (unplaced && (account.positions ?? []).length === 0 && guess.tray === 'front') selectPosition(READY_POSITIONS.findIndex(r => r.tray === 'front'));
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
    setCalibrated(false);
    setMoved({ x: 0, y: 0 });
    setTested(false);
    setPlacement(trayToPage(layout, tray, defaultTrayView(layout, tray, TRAY_KINDS[tray].turnFor(r))));
  };

  const current = (): PrintPosition | null =>
    placement ? { name: posName.trim() || `Position ${draft.positions.length + 1}`, tray, rotation: placement.rotation, x: placement.x, y: placement.y, calibrated: calibrated || tested } : null;

  /** The positions with the one being edited written in, and its index. */
  const commitCurrent = (): { positions: PrintPosition[]; idx: number } => {
    const c = current();
    const positions = [...draft.positions];
    if (!c) return { positions, idx: activeIdx ?? -1 };
    if (activeIdx === null || activeIdx >= positions.length) return { positions: [...positions, c], idx: positions.length };
    positions[activeIdx] = c;
    return { positions, idx: activeIdx };
  };

  /** Moves the position being edited to `next`; the same tray's positions not yet adjusted move with it. */
  const adjustTo = (next: Placement) => {
    const { positions, idx } = commitCurrent();
    if (idx < 0) return;
    setActiveIdx(idx);
    setDraft(d => ({ ...d, positions: adjustPosition(positions, idx, next), feedRotation: next.rotation, pageX: next.x, pageY: next.y }));
    setCalibrated(true);
  };

  /** One of the ready (or saved) positions, keeping what was changed on the one before. */
  const selectPosition = (i: number) => {
    const { positions } = commitCurrent();
    const p = positions[i];
    if (!p) return;
    setDraft(d => ({ ...d, positions, feedRotation: p.rotation, pageX: p.x, pageY: p.y }));
    setActiveIdx(i);
    setPosName(p.name);
    setTray(p.tray ?? 'rear');
    setCalibrated(p.calibrated === true);
    setMoved({ x: 0, y: 0 });
    setTested(false);
  };

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

  /** Advanced: graph paper over the cheque, counted from its bottom-left corner. */
  const printGraph = async () => {
    if (!template || !placement) return;
    const result = await window.chequeApi.print({ items: [], layout: template.layout, settings, testPrint: false, graph: true, placement });
    if (!result.ok) { setMessage({ kind: 'error', text: result.error ?? 'Print failed' }); return; }
    setTestedFor(placement);
    setCorner({ x: '', y: '' });
    setMessage({ kind: 'ok', text: 'Graph sent. Read the X and Y numbers at the bottom-left corner of the printed paper and type them under Advanced.' });
  };

  /** Advanced: the graph point on the paper's corner tells how far the print landed off; move it back by that. */
  const applyCorner = () => {
    const x = Number(corner.x);
    const y = Number(corner.y);
    if (!template || corner.x.trim() === '' || corner.y.trim() === '' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 40 || Math.abs(y) > 40) {
      setMessage({ kind: 'error', text: "Type the two graph numbers at the paper's bottom-left corner, for example X -1.5 and Y 2 (both 0 if the corner is exactly on 0, 0)." });
      return;
    }
    const base = testedFor ?? placement;
    if (!base) return;
    adjustTo(correctionFromCorner(template.layout, base, { x, y }));
    setTestedFor(null);
    const moves = [x ? `${Math.abs(x)} mm ${x > 0 ? 'right' : 'left'}` : '', y ? `${Math.abs(y)} mm ${y > 0 ? 'up' : 'down'}` : ''].filter(Boolean).join(' and ');
    setMessage({ kind: 'ok', text: `✓ Set up. ${moves ? `The print moves ${moves} on the cheque.` : 'The print was already in place.'} Press Save cheque book, then Test print to check.` });
  };

  /** Step 3: move the whole print on the cheque by 1 mm (right and up positive), whichever way it goes into the printer. */
  const nudge = (right: number, up: number) => {
    if (!layout || !placement) return;
    // correctPlacement takes where the print landed minus where it belongs: to move it right, it landed left.
    adjustTo(correctPlacement(layout, placement, -right, up));
    const next = { x: Math.round((moved.x + right) * 10) / 10, y: Math.round((moved.y + up) * 10) / 10 };
    setMoved(next);
    const parts = [next.y ? `${Math.abs(next.y)} mm ${next.y > 0 ? 'up' : 'down'}` : '', next.x ? `${Math.abs(next.x)} mm ${next.x > 0 ? 'right' : 'left'}` : ''].filter(Boolean);
    setMessage({ kind: 'ok', text: parts.length ? `Print moved ${parts.join(' and ')}. Test print again to check, then Save cheque book.` : 'Print back where it started.' });
  };

  /** Advanced: the test page with the sample text and the calibration dots. */
  const printTestPage = async () => {
    if (!template || !sample || !placement) return;
    const result = await window.chequeApi.print({ items: sample.items, layout: template.layout, settings, testPrint: false, calibrate: true, placement });
    if (!result.ok) { setMessage({ kind: 'error', text: result.error ?? 'Print failed' }); return; }
    setTestedFor(placement);
    setMessage({ kind: 'ok', text: 'Test page sent. Scan the printed cheque (300 DPI) and choose the scan in step 3.' });
  };

  /** Advanced: read the scan of the printed test and move the print position to where the cheque really sits. */
  const onScan = async (file: File | undefined) => {
    if (!file || !template) return;
    const expected = testedFor ?? placement;
    if (!expected) return;
    setBusy('Reading the test print…');
    setMessage(null);
    try {
      const upload = await loadUpload(file);
      const reference = template.image ? await imageRaster(template.image) : undefined;
      const result = await calibrateAsync(upload, template.layout, expected, reference);
      if (result.ok && result.placement) {
        adjustTo(result.placement);
        setMessage({ kind: 'ok', text: `✓ Calibrated. ${result.message} Press Save cheque book.` });
      } else {
        setMessage({ kind: 'error', text: result.message });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: `Could not read the scan: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy('');
    }
  };

  const testPrint = async (marks: boolean) => {
    if (!template || !sample || !placement) return;
    const result = await window.chequeApi.print({ items: sample.items, layout: template.layout, settings, testPrint: marks, marks, placement });
    if (result.ok && !marks) setTested(true);
    const sent = marks
      ? 'Alignment test sent. Measure the gaps between the crosshairs with a ruler: if they match the printed numbers, the size is right and only the position needs fixing in step 3.'
      : 'Test sent. Is the text on the cheque lines? If not, move the print with the arrows in step 3 and test again.';
    setMessage(result.ok ? { kind: 'ok', text: sent } : { kind: 'error', text: result.error ?? 'Print failed' });
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

        <h3>Set up printing</h3>
        <p className={calibrated ? 'success' : 'hint'}>
          {calibrated ? '✓ Set up: this cheque book prints in place on your printer.' : 'Not set up yet. Once per cheque book:'}
        </p>
        <p className="hint">How will you load the cheque? All four are ready; set up the ones you use.</p>
        <div className="feed-options ready-positions">
          {READY_POSITIONS.map((r, i) => (
            <button key={r.name} type="button" className={i === activeIdx ? 'feed-option active' : 'feed-option'} onClick={() => selectPosition(i)}>
              <strong>{r.tray === 'rear' ? 'Back tray' : 'Front tray'}</strong>
              <span>{r.leading === 270 ? 'Vertical · date end first' : 'Horizontal · top edge first'}</span>
              {(i === activeIdx ? calibrated : draft.positions[i]?.calibrated) && <span className="hint">✓ set up</span>}
            </button>
          ))}
        </div>
        <ol className="setup-steps">
          <li>Load a photocopy of this cheque (or plain paper cut to its size) as the picture shows.</li>
          <li>
            <button type="button" className="primary" onClick={() => testPrint(false)} disabled={!template}>Test print</button>
          </li>
          <li>
            Is the text on the cheque lines? If not, move the whole print and test again:
            <div className="nudge" role="group" aria-label="Move the print">
              <button type="button" onClick={() => nudge(0, 1)} disabled={!template} title="Move the print 1 mm up">↑ Up</button>
              <button type="button" onClick={() => nudge(0, -1)} disabled={!template} title="Move the print 1 mm down">↓ Down</button>
              <button type="button" onClick={() => nudge(-1, 0)} disabled={!template} title="Move the print 1 mm left">← Left</button>
              <button type="button" onClick={() => nudge(1, 0)} disabled={!template} title="Move the print 1 mm right">→ Right</button>
              <span className="hint">1 mm each click</span>
            </div>
            <span className="hint">The other direction of the same tray moves with it, until you set that one up too.</span>
          </li>
          <li>When the text sits on the lines, press Save cheque book.</li>
        </ol>
        {busy && <div className="busy">{busy}</div>}
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
        {onPage.map(w => <p key={w} className="warning">{w}</p>)}

        <div className="actions">
          <button className="primary" onClick={save}>Save cheque book</button>
          <button onClick={onCancel}>Cancel</button>
        </div>

        <details className="advanced" onToggle={e => setAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary>Advanced: tray, direction and manual adjustment</summary>
          <h3>Set up with the printed graph</h3>
          <p className="hint">Exact to half a millimetre. Load plain paper cut to the cheque size and print the graph: graph paper in mm, counted from the cheque's bottom-left corner, red numbers X and blue numbers Y.</p>
          <div className="actions">
            <button type="button" onClick={printGraph} disabled={!template || !!busy}>Print graph</button>
          </div>
          <p className="hint">On the printed paper, find the graph point that sits exactly on its <b>bottom-left corner</b> (count the small mm lines from the nearest numbered lines), type it and Apply.</p>
          <div className="row corner-reading">
            <label>X (red)<input type="number" step="0.5" value={corner.x} onChange={e => setCorner(c => ({ ...c, x: e.target.value }))} placeholder="e.g. -1.5" /></label>
            <label>Y (blue)<input type="number" step="0.5" value={corner.y} onChange={e => setCorner(c => ({ ...c, y: e.target.value }))} placeholder="e.g. 2" /></label>
            <button type="button" className="primary" onClick={applyCorner} disabled={!template}>Apply</button>
          </div>
          <h3>Set up from a scan instead</h3>
          <p className="hint">Print a test page with dot rows, scan the printed cheque at 300 DPI on a flatbed scanner and choose the scan: the app reads where the ink landed.</p>
          <div className="actions">
            <button type="button" onClick={printTestPage} disabled={!template || !!busy}>Print test page</button>
            <button type="button" onClick={() => scanInput.current?.click()} disabled={!template || !!busy}>Choose the scan</button>
            <input ref={scanInput} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden onChange={e => { onScan(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <h3>Print positions</h3>
          <p className="hint">One position for every way this cheque book goes into a printer. You choose the position when printing.</p>
          {draft.positions.length > 0 && (
            <div className="positions">
              {draft.positions.map((p, i) => (
                <div key={i} className={i === activeIdx ? 'position active' : 'position'}>
                  <div>
                    <strong>{p.name}</strong>
                    <span className="hint">{describePosition(p)}{p.calibrated ? ' · calibrated' : ''}</span>
                  </div>
                  <div className="actions">
                    {i === activeIdx ? <span className="tag">Editing</span> : <button type="button" onClick={() => selectPosition(i)}>Edit</button>}
                    {i >= READY_POSITIONS.length && <button type="button" onClick={() => removePosition(i)}>Delete</button>}
                  </div>
                </div>
              ))}
              <button type="button" onClick={newPosition}>+ Add another position</button>
            </div>
          )}
          <label>Position name<input value={posName} onChange={e => setPosName(e.target.value)} placeholder="e.g. Back tray · date end first" /></label>

          <h3>Which tray?</h3>
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

          <h3>Which end goes in first?</h3>
          <div className="feed-options">
            {FEED_OPTIONS.map(o => (
              <button key={o.value} type="button" className={rotation === o.value ? 'feed-option active' : 'feed-option'} title={LEADING_EDGE[o.value]} onClick={() => chooseDirection(o.value)}>
                <span className="feed-icon">{o.icon}</span>
                <span>{o.title}</span>
              </button>
            ))}
          </div>
          <p className="hint">Slide the cheque on the tray picture to where it sits, or line it up with a guide. Then drag the text on the cheque picture to where a test printed.</p>
          <div className="actions">
            <button type="button" onClick={() => testPrint(false)} disabled={!template}>Test print (text only)</button>
            <button type="button" onClick={() => testPrint(true)} disabled={!template} title="Crosshairs at the corners and centre with their distances">Print alignment marks</button>
          </div>
        </details>
      </div>
      {template && view && (
        <div className="preview placement-preview">
          <TrayPicture
            layout={template.layout}
            image={template.image}
            tray={tray}
            view={view}
            interactive={advanced}
            onChange={v => { setCalibrated(false); setPlacement(trayToPage(template.layout, tray, v)); }}
          />
          {advanced && sample && placement && (
            <div className="correction-panel">
              <h3>Drag the text to where it printed</h3>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
