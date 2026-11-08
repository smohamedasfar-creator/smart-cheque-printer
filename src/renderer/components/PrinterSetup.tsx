import { useState } from 'react';
import { guessTray } from '../../shared/loading';
import {
  chequeTray,
  foldFromOffset,
  frontFacesUp,
  guessPaperSide,
  MAX_READING_MM,
  offsetFromFold,
  PAPER_SIDE_LABEL,
  paperSide,
  paperSideChosen,
  TRAY_TITLE,
  trayOffset,
  withChequeTray,
  withFrontFaceUp,
  withPaperSide,
  withTrayOffset,
  type PaperSide,
} from '../../shared/printerCalibration';
import type { TrayKind } from '../../shared/print';
import type { PrintSettings } from '../../shared/types';

const TRAY_HINT: Record<TrayKind, string> = {
  rear: 'Paper stands up behind the printer (Epson, HP Smart Tank, Canon ink)',
  front: 'Paper lies flat in a drawer at the front (most laser printers)',
  manual: 'Single sheet slot or bypass tray',
};
const ALL_TRAYS: TrayKind[] = ['rear', 'front', 'manual'];

interface Props {
  settings: PrintSettings;
  printers: Array<{ name: string; isDefault: boolean }>;
  onApply: (next: PrintSettings) => Promise<void>;
}

/**
 * Printer setup in four plain steps, once per printer: which printer, which tray, where a cheque sits in it, and the
 * folded calibration sheet. Every cheque book then prints in place, horizontal and vertical.
 */
export function PrinterSetup({ settings, printers, onApply }: Props) {
  const tray = chequeTray(settings);
  const guess = guessTray(settings.printerName ?? '');
  const others = ALL_TRAYS.filter(t => t !== tray);
  const done = Boolean(trayOffset(settings, tray));

  return (
    <div className="printer-setup simple-setup">
      <h2>Printer setup {done ? <span className="tag ok">✓ Ready</span> : <span className="tag">Do this once per printer</span>}</h2>

      <div className="setup-step">
        <span className="step-no">1</span>
        <div>
          <strong>Printer</strong>
          <select value={settings.printerName} onChange={e => onApply({ ...settings, printerName: e.target.value })}>
            <option value="">Ask every time</option>
            {printers.map(p => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
          </select>
        </div>
      </div>

      <div className="setup-step">
        <span className="step-no">2</span>
        <div>
          <strong>Which tray do you put cheques in?</strong>
          <div className="feed-options three">
            {ALL_TRAYS.map(t => (
              <button key={t} type="button" className={tray === t ? 'feed-option active' : 'feed-option'} onClick={() => onApply(withChequeTray(settings, t))}>
                <strong>{TRAY_TITLE[t]}{guess?.tray === t ? ' · suggested' : ''}</strong>
                <span className="hint">{TRAY_HINT[t]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="setup-step">
        <span className="step-no">3</span>
        <div>
          <strong>Where does a cheque sit in the {TRAY_TITLE[tray].toLowerCase()}?</strong>
          <PaperSideChoice tray={tray} settings={settings} onApply={onApply} />
          {tray === 'front' && <FrontFace settings={settings} onApply={onApply} />}
        </div>
      </div>

      <div className="setup-step">
        <span className="step-no">4</span>
        <div>
          <strong>Calibrate the {TRAY_TITLE[tray].toLowerCase()}</strong>
          <ol className="setup-steps">
            <li>Put a plain A4 sheet in the {TRAY_TITLE[tray].toLowerCase()} and press <b>Print calibration sheet</b> (print window: A4, margins None, scale 100%).</li>
            <li>Fold it in half left to right, edges exactly together. Type the number where the fold crosses scale <b>A</b>.</li>
            <li>Unfold, fold top to bottom. Type the number on scale <b>B</b>. Press <b>Save</b>.</li>
          </ol>
          <TrayCalibration tray={tray} settings={settings} onApply={onApply} />
        </div>
      </div>

      <details className="advanced">
        <summary>Other trays of this printer (only if you also use them)</summary>
        {others.map(t => (
          <div key={t} className="other-tray">
            <strong>{TRAY_TITLE[t]}</strong>
            <PaperSideChoice tray={t} settings={settings} onApply={onApply} />
            {t === 'front' && <FrontFace settings={settings} onApply={onApply} />}
            <TrayCalibration tray={t} settings={settings} onApply={onApply} />
          </div>
        ))}
      </details>
    </div>
  );
}

function TrayCalibration({ tray, settings, onApply }: { tray: TrayKind; settings: PrintSettings; onApply: (next: PrintSettings) => Promise<void> }) {
  const title = TRAY_TITLE[tray];
  const saved = trayOffset(settings, tray);
  const shown = saved ? foldFromOffset(saved) : null;
  const [a, setA] = useState(shown ? String(shown.a) : '');
  const [b, setB] = useState(shown ? String(shown.b) : '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const printSheet = async () => {
    const result = await window.chequeApi.printFoldSheet(settings.printerName, title);
    setMessage(result.ok ? { kind: 'ok', text: 'Sheet sent. Fold it and read scales A and B.' } : { kind: 'error', text: result.error ?? 'Print failed' });
  };

  const save = async () => {
    const reading = { a: Number(a), b: Number(b) };
    if (a.trim() === '' || b.trim() === '' || !Number.isFinite(reading.a) || !Number.isFinite(reading.b) || Math.abs(reading.a) > MAX_READING_MM || Math.abs(reading.b) > MAX_READING_MM) {
      setMessage({ kind: 'error', text: `Type the numbers read at the two folds, between -${MAX_READING_MM} and ${MAX_READING_MM} (0 when the fold crosses the 0 mark).` });
      return;
    }
    await onApply(withTrayOffset(settings, tray, offsetFromFold(reading)));
    setMessage({ kind: 'ok', text: `✓ ${title} calibrated. Every cheque printed from it is moved into place.` });
  };

  const clear = async () => {
    await onApply(withTrayOffset(settings, tray, null));
    setA('');
    setB('');
    setMessage({ kind: 'ok', text: `${title} calibration removed.` });
  };

  return (
    <div className={`tray-calibration${saved ? ' done' : ''}`} data-tray={tray}>
      <div className="row tray-calibration-row">
        <button type="button" onClick={printSheet}>Print calibration sheet</button>
        <label>A<input type="number" step="0.5" value={a} onChange={e => setA(e.target.value)} placeholder="e.g. -1" /></label>
        <label>B<input type="number" step="0.5" value={b} onChange={e => setB(e.target.value)} placeholder="e.g. 6.5" /></label>
        <button type="button" className="primary" onClick={save}>Save</button>
        {saved && <button type="button" className="link" onClick={clear}>Remove</button>}
      </div>
      <span className="hint">{shown ? `✓ Calibrated: A ${shown.a}, B ${shown.b}` : 'Not calibrated yet'}</span>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
    </div>
  );
}

/** Where this tray puts paper narrower than A4: in the middle, or against one side. Every cheque book follows it. */
function PaperSideChoice({ tray, settings, onApply }: { tray: TrayKind; settings: PrintSettings; onApply: (next: PrintSettings) => Promise<void> }) {
  const side = paperSide(settings, tray);
  const guess = guessPaperSide(settings.printerName ?? '', tray);
  const chosen = paperSideChosen(settings, tray);
  return (
    <div className="side-choice" role="radiogroup" aria-label="Where a cheque sits in this tray">
      <div className="feed-options three">
        {(['left', 'centre', 'right'] as PaperSide[]).map(s => (
          <button key={s} type="button" role="radio" aria-checked={side === s} className={side === s ? 'feed-option active' : 'feed-option'} onClick={() => onApply(withPaperSide(settings, tray, s))}>
            <span className="side-icon" data-side={s}><i /></span>
            <span>{PAPER_SIDE_LABEL[s]}{!chosen && guess.side === s && guess.reason ? ' · suggested' : ''}</span>
          </button>
        ))}
      </div>
      <span className="hint">Look at the tray from the front: both guides close to the middle → Centre. One side fixed, one guide slides → that fixed side.</span>
    </div>
  );
}

function FrontFace({ settings, onApply }: { settings: PrintSettings; onApply: (next: PrintSettings) => Promise<void> }) {
  return (
    <div className="face-choice" role="radiogroup" aria-label="Front tray prints on the side facing">
      <span>The drawer prints on the side facing:</span>
      <label><input type="radio" name="front-face" checked={!frontFacesUp(settings)} onChange={() => onApply(withFrontFaceUp(settings, false))} /> Down (most printers)</label>
      <label><input type="radio" name="front-face" checked={frontFacesUp(settings)} onChange={() => onApply(withFrontFaceUp(settings, true))} /> Up</label>
    </div>
  );
}
