// Setting up printing for a cheque book: its details, the four ready print positions, test print, graph and fine-tuning.
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderCheque } from '../../shared/chequeRender';
import { guessTray } from '../../shared/loading';
import { correctPlacement, defaultTrayView, LEADING_EDGE, pageGeometry, pageToTray, printProblems, TRAY_KINDS, trayToPage, type Placement, type TrayKind } from '../../shared/print';
import type { Account, ChequeLayout, FeedRotation, NewAccount, PrintPosition, PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { calibrateAsync, imageRaster, loadUpload } from '../upload';
import { correctionFromCorner } from '../../shared/graph';
import { adjustPosition, anyPositionSetUp, layoutForPosition, MAIN_POSITION, modeOf, placementToShift, positionKeyOf, READY_POSITIONS, readyPlacement, resetShift, shiftFor, VERTICAL_LIFT_MM, withReadyPositions, withShift, type Shift } from '../../shared/positions';
import { PrintCorrection } from './PrintCorrection';
import { TrayPicture } from './TrayPicture';

const FEED_OPTIONS: Array<{ value: FeedRotation; title: string; icon: string }> = [
  { value: 0, title: 'Top edge first', icon: '▭' },
  { value: 180, title: 'Bottom edge first', icon: '▭⟲' },
  { value: 90, title: 'Logo end first', icon: '▯↻' },
  { value: 270, title: 'Date end first', icon: '▯↺' },
];
const SAMPLE = { date: '2026-12-31', payee: 'Sample Payee Trading LLC', amountFils: 1_234_550, crossing: 'ac-payee-bearer' as const };

export type BookDraft = NewAccount & { id?: number };

interface SetupProps {
  /** The cheque book (already brought up to date, see migratePositions). */
  account: BookDraft;
  /** The cheque layout being edited on the same screen, with each position's X / Y. */
  layout: ChequeLayout;
  /** The blank leaf, shown on the tray picture. */
  image: string | null;
  onLayout: (next: ChequeLayout) => void;
  settings: PrintSettings;
  /** Hands the screen a way to read the cheque book as it should be saved. */
  bind: (read: () => BookDraft) => void;
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

/** A position's X / Y in words, e.g. "1 mm right, 5.5 mm up". */
function describeShift(s: Shift): string {
  const parts = [s.x ? `${Math.abs(s.x)} mm ${s.x > 0 ? 'right' : 'left'}` : '', s.y ? `${Math.abs(s.y)} mm ${s.y > 0 ? 'up' : 'down'}` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'as laid out';
}

/** Cheques go in date end first by default: lengthways they are long enough in the feed direction not to jam. */
const defaultTurn = (t: TrayKind) => TRAY_KINDS[t].turnFor(270);

/** Cheque book details and setting up printing, below the cheque layout on the same screen. */
export function ChequeBookSetup({ account, layout, image, onLayout, settings, bind }: SetupProps) {
  // The four ready positions are always there; a new cheque book starts on the main one (back tray, horizontal).
  const positions0 = withReadyPositions(layout, account.positions ?? []);
  const unplaced = account.pageX === null || account.pageY === null || account.feedRotation === null;
  const saved0 = activePositionIndex({ ...account, positions: positions0 });
  const idx0 = saved0 >= 0 ? saved0 : unplaced && positions0.length ? 0 : -1;
  const start0 = idx0 >= 0 ? { feedRotation: positions0[idx0].rotation, pageX: positions0[idx0].x, pageY: positions0[idx0].y } : {};
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

  // The placement printed now: the cheque book's own one, or a centred cheque pushed fully into the chosen tray.
  const placement: Placement =
    draft.pageX !== null && draft.pageY !== null && draft.feedRotation !== null
      ? { rotation: draft.feedRotation, x: draft.pageX, y: draft.pageY }
      : trayToPage(layout, tray, defaultTrayView(layout, tray, defaultTurn(tray)));
  const view = pageToTray(layout, tray, placement);
  /** Which ready position is being set up; its X / Y moves the whole print on the cheque. */
  const key = positionKeyOf(layout, { tray, rotation: placement.rotation });
  const manual = modeOf(layout) === 'manual';
  const onCheque = { ...settings, offsetX: draft.offsetX, offsetY: draft.offsetY };
  const sample = renderCheque(layoutForPosition(layout, key), SAMPLE, onCheque, measure);
  const setUp = anyPositionSetUp(layout);
  /** Sets this position's X / Y (default setting: all four move and keep their difference). */
  const setShift = (next: Shift) => {
    if (!key) return;
    onLayout(withShift(layout, key, next));
    setCalibrated(true);
  };
  const setPlacement = (p: Placement) => setDraft(d => ({ ...d, feedRotation: p.rotation, pageX: p.x, pageY: p.y }));

  const chooseTray = (t: TrayKind) => {
    setTray(t);
    setCalibrated(false);
    setMoved({ x: 0, y: 0 });
    setTested(false);
    // A name the app filled in follows the tray; a name the user typed is kept.
    if (!posName.trim() || TRAYS.some(x => x.title === posName)) setPosName(TRAYS.find(x => x.value === t)?.title ?? '');
    setPlacement(trayToPage(layout, t, defaultTrayView(layout, t, defaultTurn(t))));
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
    setCalibrated(false);
    setMoved({ x: 0, y: 0 });
    setTested(false);
    setPlacement(trayToPage(layout, tray, defaultTrayView(layout, tray, TRAY_KINDS[tray].turnFor(r))));
  };

  const current = (): PrintPosition | null => ({ name: posName.trim() || `Position ${draft.positions.length + 1}`, tray, rotation: placement.rotation, x: placement.x, y: placement.y, calibrated: calibrated || tested });

  /** The positions with the one being edited written in, and its index. */
  const commitCurrent = (): { positions: PrintPosition[]; idx: number } => {
    const c = current();
    const positions = [...draft.positions];
    if (!c) return { positions, idx: activeIdx ?? -1 };
    if (activeIdx === null || activeIdx >= positions.length) return { positions: [...positions, c], idx: positions.length };
    positions[activeIdx] = c;
    return { positions, idx: activeIdx };
  };

  /** Moves the position being edited to `next`; the positions not yet set up (both trays) move with it. */
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

  // A new size (the real width typed in, or another leaf uploaded): the ready positions sit the cheque afresh.
  const size = `${layout.chequeWidth}x${layout.chequeHeight}`;
  const sizeSeen = useRef(size);
  useEffect(() => {
    if (sizeSeen.current === size) return;
    sizeSeen.current = size;
    setDraft(d => {
      const positions = d.positions.map((p, i) => {
        const r = READY_POSITIONS[i];
        return r ? { ...p, ...readyPlacement(layout, r.tray, r.leading) } : p;
      });
      const p = positions[activeIdx ?? 0] ?? positions[0];
      return p ? { ...d, positions, feedRotation: p.rotation, pageX: p.x, pageY: p.y } : d;
    });
  }, [size]);

  // The screen's Save reads the cheque book with the position being edited written in.
  useEffect(() => bind(() => withCurrent('update')));

  /** Step 2: graph paper in mm over the cheque copy, counted from its bottom-left corner, to read where each line starts. */
  const printGraph = async () => {
    const result = await window.chequeApi.print({ items: [], layout, settings, testPrint: false, graph: true, placement });
    if (!result.ok) { setMessage({ kind: 'error', text: result.error ?? 'Print failed' }); return; }
    setTestedFor(placement);
    setCorner({ x: '', y: '' });
    setMessage({ kind: 'ok', text: 'Graph sent. On the printed copy, read where each line starts (red X, blue Y) and type it in "Where each field starts" above. Advanced can also read the paper\'s bottom-left corner.' });
  };

  /** Advanced: the graph point on the paper's corner tells how far the print landed off; move it back by that. */
  const applyCorner = () => {
    const x = Number(corner.x);
    const y = Number(corner.y);
    if (corner.x.trim() === '' || corner.y.trim() === '' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 40 || Math.abs(y) > 40) {
      setMessage({ kind: 'error', text: "Type the two graph numbers at the paper's bottom-left corner, for example X -1.5 and Y 2 (both 0 if the corner is exactly on 0, 0)." });
      return;
    }
    const base = testedFor ?? placement;
    const fixed = correctionFromCorner(layout, base, { x, y });
    if (key) setShift(placementToShift(layout, base, fixed));
    else adjustTo(fixed);
    setTestedFor(null);
    const moves = [x ? `${Math.abs(x)} mm ${x > 0 ? 'right' : 'left'}` : '', y ? `${Math.abs(y)} mm ${y > 0 ? 'up' : 'down'}` : ''].filter(Boolean).join(' and ');
    setMessage({ kind: 'ok', text: `✓ Set up. ${moves ? `The print moves ${moves} on the cheque.` : 'The print was already in place.'} Press Save cheque book, then Test print to check.` });
  };

  /** Step 3: move the whole print on the cheque by 1 mm (right and up positive), whichever way it goes into the printer. */
  const nudge = (right: number, up: number) => {
    if (key) {
      const now = shiftFor(layout, key);
      setShift({ x: now.x + right, y: now.y + up });
    } else {
      // An extra position keeps its correction in the page placement. To move the print right, it landed left.
      adjustTo(correctPlacement(layout, placement, -right, up));
    }
    const next = { x: Math.round((moved.x + right) * 10) / 10, y: Math.round((moved.y + up) * 10) / 10 };
    setMoved(next);
    const parts = [next.y ? `${Math.abs(next.y)} mm ${next.y > 0 ? 'up' : 'down'}` : '', next.x ? `${Math.abs(next.x)} mm ${next.x > 0 ? 'right' : 'left'}` : ''].filter(Boolean);
    setMessage({ kind: 'ok', text: parts.length ? `Print moved ${parts.join(' and ')}. Test print again to check, then Save cheque book.` : 'Print back where it started.' });
  };

  /** Advanced: the test page with the sample text and the calibration dots. */
  const printTestPage = async () => {
    const result = await window.chequeApi.print({ items: sample.items, layout, settings, testPrint: false, calibrate: true, placement });
    if (!result.ok) { setMessage({ kind: 'error', text: result.error ?? 'Print failed' }); return; }
    setTestedFor(placement);
    setMessage({ kind: 'ok', text: 'Test page sent. Scan the printed cheque (300 DPI) and choose the scan in step 3.' });
  };

  /** Advanced: read the scan of the printed test and move the print position to where the cheque really sits. */
  const onScan = async (file: File | undefined) => {
    if (!file) return;
    const expected = testedFor ?? placement;
    setBusy('Reading the test print…');
    setMessage(null);
    try {
      const upload = await loadUpload(file);
      const reference = image ? await imageRaster(image) : undefined;
      const result = await calibrateAsync(upload, layout, expected, reference);
      if (result.ok && result.placement) {
        if (key && result.placement.rotation === expected.rotation) setShift(placementToShift(layout, expected, result.placement));
        else adjustTo(result.placement);
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
    const result = await window.chequeApi.print({ items: sample.items, layout, settings, testPrint: marks, marks, placement });
    if (result.ok && !marks) setTested(true);
    const sent = marks
      ? 'Alignment test sent. Measure the gaps between the crosshairs with a ruler: if they match the printed numbers, the size is right and only the position needs fixing in step 3.'
      : 'Test sent. Is the text on the cheque lines? If not, move the print with the arrows in step 3 and test again.';
    setMessage(result.ok ? { kind: 'ok', text: sent } : { kind: 'error', text: result.error ?? 'Print failed' });
  };

  const rotation = placement.rotation;
  const onPage = printProblems(sample.items, pageGeometry(layout, settings, placement), measure);
  return (
    <div className="details-layout">
      <div className="form">
        <h2>Cheque book details</h2>
        <div className="row">
          <label>Account No (optional)<input value={draft.accountNo} onChange={e => set('accountNo', e.target.value)} /></label>
          <label>Currency<input value={draft.currency} onChange={e => set('currency', e.target.value.toUpperCase().slice(0, 3))} /></label>
        </div>
        <label>Last cheque number used<input value={draft.lastChequeNo} onChange={e => set('lastChequeNo', e.target.value)} placeholder="e.g. 000123 — the next cheque will be 000124" /></label>

        <h3>Set up printing</h3>
        <p className={setUp || calibrated ? 'success' : 'hint'}>
          {setUp || calibrated ? '✓ Set up: this cheque book prints in place on your printer.' : 'Not set up yet. Set up one position and the other three follow:'}
        </p>
        <p className="hint">
          How will you load the cheque?{' '}
          {manual
            ? 'Manual setting: each position has its own fields and X / Y; changing one never changes another.'
            : `Default setting: one X / Y for all four; vertical prints ${VERTICAL_LIFT_MM} mm higher than horizontal. Switch to Manual in the cheque layout above to set each position on its own.`}
        </p>
        <div className="feed-options ready-positions">
          {READY_POSITIONS.map((r, i) => (
            <button key={r.name} type="button" className={i === activeIdx ? 'feed-option active' : 'feed-option'} onClick={() => selectPosition(i)}>
              <strong>{r.tray === 'rear' ? 'Back tray' : 'Front tray'}{r.key === MAIN_POSITION ? ' · main' : ''}</strong>
              <span>{r.leading === 270 ? 'Vertical · date end first' : 'Horizontal · top edge first'}</span>
              <span className="hint">{describeShift(shiftFor(layout, r.key))}</span>
            </button>
          ))}
        </div>
        <ol className="setup-steps">
          <li>Load a photocopy of this cheque (or plain paper cut to its size) as the picture shows.</li>
          <li>
            <button type="button" className="primary" onClick={() => testPrint(false)}>Test print</button>{' '}
            <button type="button" onClick={printGraph} disabled={!!busy}>Print graph</button>
            <span className="hint"> Test print shows where the text lands. Print graph prints mm graph paper on the cheque copy: read where each line starts (red X, blue Y) and type it in the field table above.</span>
          </li>
          <li>
            Is the text on the cheque lines? If not, move the whole print and test again:
            <div className="nudge" role="group" aria-label="Move the print">
              <button type="button" onClick={() => nudge(0, 1)} title="Move the print 1 mm up">↑ Up</button>
              <button type="button" onClick={() => nudge(0, -1)} title="Move the print 1 mm down">↓ Down</button>
              <button type="button" onClick={() => nudge(-1, 0)} title="Move the print 1 mm left">← Left</button>
              <button type="button" onClick={() => nudge(1, 0)} title="Move the print 1 mm right">→ Right</button>
              <span className="hint">1 mm each click</span>
            </div>
            <span className="hint">{manual ? 'Moves this position only.' : `Moves all four positions together; vertical stays ${VERTICAL_LIFT_MM} mm higher.`}</span>
          </li>
          <li>When the text sits on the lines, press Save cheque book.</li>
        </ol>
        {busy && <div className="busy">{busy}</div>}
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
        {onPage.map(w => <p key={w} className="warning">{w}</p>)}

        <details className="advanced" onToggle={e => setAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary>Advanced: tray, direction and manual adjustment</summary>
          <h3>Read the graph at the paper's corner</h3>
          <p className="hint">After Print graph (step 2) on plain paper cut to the cheque size: find the graph point that sits exactly on its <b>bottom-left corner</b> (count the small mm lines from the nearest numbered lines), type it and Apply.</p>
          <div className="row corner-reading">
            <label>X (red)<input type="number" step="0.5" value={corner.x} onChange={e => setCorner(c => ({ ...c, x: e.target.value }))} placeholder="e.g. -1.5" /></label>
            <label>Y (blue)<input type="number" step="0.5" value={corner.y} onChange={e => setCorner(c => ({ ...c, y: e.target.value }))} placeholder="e.g. 2" /></label>
            <button type="button" className="primary" onClick={applyCorner}>Apply</button>
          </div>
          <h3>Set up from a scan instead</h3>
          <p className="hint">Print a test page with dot rows, scan the printed cheque at 300 DPI on a flatbed scanner and choose the scan: the app reads where the ink landed.</p>
          <div className="actions">
            <button type="button" onClick={printTestPage} disabled={!!busy}>Print test page</button>
            <button type="button" onClick={() => scanInput.current?.click()} disabled={!!busy}>Choose the scan</button>
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
            <button type="button" onClick={() => testPrint(false)}>Test print (text only)</button>
            <button type="button" onClick={() => testPrint(true)} title="Crosshairs at the corners and centre with their distances">Print alignment marks</button>
          </div>
        </details>
      </div>
      {view && (
        <div className="preview placement-preview">
          <TrayPicture
            layout={layout}
            image={image}
            tray={tray}
            view={view}
            interactive={advanced}
            onChange={v => {
              setCalibrated(false);
              setPlacement(trayToPage(layout, tray, v));
              // Where the cheque sits changed: a correction measured for the old spot no longer applies.
              if (key) onLayout(resetShift(layout, key));
            }}
          />
          {advanced && (
            <div className="correction-panel">
              <h3>Drag the text to where it printed</h3>
              <PrintCorrection
                layout={layout}
                image={image}
                items={sample.items}
                fontFamily={settings.fontFamily}
                placement={placement}
                onApply={(next, what) => {
                  if (key && next.rotation === placement.rotation) {
                    const now = shiftFor(layout, key);
                    const d = placementToShift(layout, placement, next);
                    setShift({ x: now.x + d.x, y: now.y + d.y });
                  } else setPlacement(next);
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
