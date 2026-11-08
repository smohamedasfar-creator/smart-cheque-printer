// Setting up printing for a cheque book: its details, the four ready print positions, test print, graph and fine-tuning.
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderCheque } from '../../shared/chequeRender';
import { guessTray } from '../../shared/loading';
import { correctPlacement, defaultTrayView, LEADING_EDGE, pageGeometry, pageToTray, printProblems, TRAY_KINDS, trayToPage, type Placement, type TrayGeometry, type TrayKind } from '../../shared/print';
import type { Account, ChequeLayout, FeedRotation, NewAccount, PrintPosition, PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { chequeTray, PAPER_SIDE_LABEL, paperSide, TRAY_TITLE, trayGeometry, trayOffset, viewOnSide } from '../../shared/printerCalibration';
import { loadCheck } from '../../shared/loading';
import { calibrateAsync, imageRaster, loadUpload } from '../upload';
import { activePositionIndex, adjustPosition, anyPositionSetUp, markActive, layoutForPosition, MAIN_POSITION, modeOf, placementToShift, positionKeyOf, READY_POSITIONS, readyPlacement, resetShift, shiftFor, hasOwnAdjustments, verticalDiffText, withoutOwnAdjustments, withReadyPositions, withShift, type Shift } from '../../shared/positions';
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

export { activePositionIndex } from '../../shared/positions';

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
const defaultTurn = (t: TrayGeometry) => TRAY_KINDS[t].turnFor(270);

/** Cheque book details and setting up printing, below the cheque layout on the same screen. */
export function ChequeBookSetup({ account, layout, image, onLayout, settings, bind }: SetupProps) {
  const settingsChequeTray = chequeTray(settings);
  // The ready positions are always there; a new cheque book starts on the printer's cheque tray, horizontal.
  const positions0 = withReadyPositions(layout, account.positions ?? []);
  const unplaced = account.pageX === null || account.pageY === null || account.feedRotation === null;
  const savedAt = activePositionIndex({ ...account, positions: positions0 });
  // Open on the tray chosen in Settings → Printer setup, keeping the cheque book's direction (horizontal or vertical).
  const trayNow = settingsChequeTray;
  const savedRot0 = positions0[savedAt]?.rotation;
  const sameDirection = READY_POSITIONS.findIndex(r => r.tray === trayNow && (r.leading === 270) === (savedRot0 === 90 || savedRot0 === 270));
  const saved0 = savedAt >= 0 && positions0[savedAt]?.tray !== trayNow && sameDirection >= 0 ? sameDirection : savedAt;
  const firstInTray = READY_POSITIONS.findIndex(r => r.tray === settingsChequeTray && r.leading === 0);
  const idx0 = saved0 >= 0 ? saved0 : unplaced && positions0.length ? Math.max(0, firstInTray) : -1;
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
  /** How far the whole print was moved with the arrow buttons, in mm on the cheque (right and up positive). */
  const [moved, setMoved] = useState({ x: 0, y: 0 });
  /** A test print was made: saving after it means the user saw the print land in place. */
  const [tested, setTested] = useState(false);
  const measure = useMemo(() => createMeasure(settings.fontFamily), [settings.fontFamily]);
  const set = <K extends keyof NewAccount>(key: K, value: NewAccount[K]) => setDraft(d => ({ ...d, [key]: value }));

  /** The tray this printer's cheques go in (Settings → Printer setup). */
  const mainTray = chequeTray(settings);
  /** Horizontal (long edge first) or vertical (short edge first). */
  const directionOf = (r: FeedRotation) => (r === 0 || r === 180 ? 'h' : 'v');
  /** Horizontal or vertical in the printer's cheque tray: the ready position for it, or a fresh one for the manual slot. */
  const chooseSimple = (d: 'h' | 'v') => {
    const leading: FeedRotation = d === 'h' ? 0 : 270;
    const i = READY_POSITIONS.findIndex(r => r.tray === mainTray && r.leading === leading);
    if (i >= 0) return selectPosition(i);
    const g = trayGeometry(mainTray, settings);
    setTray(mainTray);
    setCalibrated(false);
    setMoved({ x: 0, y: 0 });
    setTested(false);
    setPlacement(trayToPage(layout, g, defaultTrayView(layout, g, TRAY_KINDS[g].turnFor(leading))));
  };
  /** The tray as this printer handles it: the front drawer may print on the side facing up (Settings). */
  const geo = trayGeometry(tray, settings);
  // The placement printed now: the cheque book's own one, or a centred cheque pushed fully into the chosen tray.
  const placement: Placement =
    draft.pageX !== null && draft.pageY !== null && draft.feedRotation !== null
      ? { rotation: draft.feedRotation, x: draft.pageX, y: draft.pageY }
      : trayToPage(layout, geo, defaultTrayView(layout, geo, defaultTurn(geo)));
  /** Where this printer's tray puts a cheque (Settings); the picture and the print follow it. */
  const side = paperSide(settings, tray);
  const view = pageToTray(layout, geo, placement);
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
    const g = trayGeometry(t, settings);
    setPlacement(trayToPage(layout, g, defaultTrayView(layout, g, defaultTurn(g))));
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
    setPlacement(trayToPage(layout, geo, defaultTrayView(layout, geo, TRAY_KINDS[geo].turnFor(r))));
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
    return { ...draft, feedRotation: c.rotation, pageX: c.x, pageY: c.y, positions: markActive(positions, idx) };
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

  /** Fine-tuning: move the whole print on the cheque by 1 mm (right and up positive), whichever way it goes into the printer. */
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
    const result = await window.chequeApi.print({ items: sample.items, layout, settings, testPrint: false, calibrate: true, placement, tray });
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
    const result = await window.chequeApi.print({ items: sample.items, layout, settings, testPrint: marks, marks, placement, tray });
    if (result.ok && !marks) setTested(true);
    const sent = marks
      ? 'Alignment test sent. Measure the gaps between the crosshairs with a ruler: if they match the printed numbers, the size is right and only the position needs fixing in step 3.'
      : 'Test sent. Is the text on the cheque lines? If not, move the print with the arrows in step 3 and test again.';
    setMessage(result.ok ? { kind: 'ok', text: sent } : { kind: 'error', text: result.error ?? 'Print failed' });
  };

  const rotation = placement.rotation;
  const direction = directionOf(rotation);
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
        <p className="load-summary">
          Printer: <b>{settings.printerName || 'asked when printing'}</b> · {TRAY_TITLE[mainTray]} · cheque sits: {PAPER_SIDE_LABEL[paperSide(settings, mainTray)].toLowerCase()}{' '}
          <span className="hint">(change in Settings → Printer setup)</span>
        </p>
        <strong>How do you put this cheque in?</strong>
        <div className="feed-options two">
          {(['h', 'v'] as const).map(d => (
            <button key={d} type="button" className={direction === d && tray === mainTray ? 'feed-option active' : 'feed-option'} onClick={() => chooseSimple(d)}>
              <span className="feed-icon">{d === 'h' ? '▭' : '▯'}</span>
              <strong>{d === 'h' ? 'Horizontal' : 'Vertical'}</strong>
              <span className="hint">{d === 'h' ? 'Lying sideways, top edge goes in first' : 'Standing up, date end goes in first'}</span>
            </button>
          ))}
        </div>
        {trayOffset(settings, tray) ? (
          <p className="success">✓ This printer is calibrated for the {tray === 'front' ? 'front tray' : tray === 'manual' ? 'manual slot' : 'back tray'}: cheques print in place, horizontal and vertical.</p>
        ) : (
          <p className="warning">The {tray === 'front' ? 'front tray' : tray === 'manual' ? 'manual slot' : 'back tray'} of this printer is not calibrated yet. Calibrate it once in Settings → Printer calibration (an A4 sheet, folded twice): every cheque book then prints in place.</p>
        )}
        {trayOffset(settings, tray) && hasOwnAdjustments(layout) && (
          <p className="hint own-adjustments">
            This cheque book keeps its own settings from before the printer was calibrated (they still work). To use only the printer calibration, the same for horizontal and vertical:{' '}
            <button type="button" className="link" onClick={() => { onLayout(withoutOwnAdjustments(layout)); setMessage({ kind: 'ok', text: 'Now printing with the printer calibration only. Test print to check, then Save cheque book.' }); }}>Use only the printer calibration</button>
          </p>
        )}
        <ol className="setup-steps">
          <li>Load a photocopy of this cheque exactly as the picture shows ({PAPER_SIDE_LABEL[side].toLowerCase()} of the tray), then <button type="button" className="primary" onClick={() => testPrint(false)}>Test print</button></li>
          <li>Hold it over a real cheque against the light: the text should sit on the lines. Only if it is still a little off:
            <details className="advanced"><summary>Move the whole print</summary>
            <div className="nudge" role="group" aria-label="Move the print">
              <button type="button" onClick={() => nudge(0, 1)} title="Move the print 1 mm up">↑ Up</button>
              <button type="button" onClick={() => nudge(0, -1)} title="Move the print 1 mm down">↓ Down</button>
              <button type="button" onClick={() => nudge(-1, 0)} title="Move the print 1 mm left">← Left</button>
              <button type="button" onClick={() => nudge(1, 0)} title="Move the print 1 mm right">→ Right</button>
              <span className="hint">1 mm each click</span>
            </div>
            <span className="hint">{manual ? 'Moves this position only.' : 'Moves horizontal and vertical together.'}</span>
            </details>
          </li>
        </ol>
        <p className="hint">When the text sits on the lines, press Save cheque book.</p>
        {busy && <div className="busy">{busy}</div>}
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
        {onPage.map(w => <p key={w} className="warning">{w}</p>)}

      </div>
      {view && (
        <div className="preview placement-preview">
          <TrayPicture
            layout={layout}
            image={image}
            tray={geo}
            view={viewOnSide(layout, geo, view, side)}
            interactive={false}
            onChange={v => {
              setCalibrated(false);
              setPlacement(trayToPage(layout, geo, v));
              // Where the cheque sits changed: a correction measured for the old spot no longer applies.
              if (key) onLayout(resetShift(layout, key));
            }}
          />
        </div>
      )}
    </div>
  );
}
