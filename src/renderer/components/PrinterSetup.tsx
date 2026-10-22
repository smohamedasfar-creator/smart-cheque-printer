import { useState } from 'react';
import { foldFromOffset, MAX_READING_MM, offsetFromFold, trayOffset, withTrayOffset } from '../../shared/printerCalibration';
import type { TrayKind } from '../../shared/print';
import type { PrintSettings } from '../../shared/types';

const TRAYS: Array<{ value: TrayKind; title: string }> = [
  { value: 'rear', title: 'Back tray' },
  { value: 'front', title: 'Front tray' },
];

/**
 * Printer calibration, once per printer and tray: print an A4 sheet, fold it in half each way and type the two numbers
 * read at the folds. Every cheque book then prints in place, horizontal and vertical.
 */
export function PrinterSetup({ settings, onApply }: { settings: PrintSettings; onApply: (next: PrintSettings) => Promise<void> }) {
  return (
    <div className="printer-setup">
      <h3>Printer calibration (once per tray)</h3>
      <p className="hint">
        Every printer puts its print a few millimetres off, differently in each tray. Calibrate each tray you use once: then every cheque book, of any
        bank, prints in place both horizontally and vertically. Load a plain A4 sheet in the tray and press Print calibration sheet. Fold the printed
        sheet in half from left to right (edges exactly together) and read scale A where the fold crosses it; unfold, fold top to bottom and read
        scale B. Type both numbers and Save.
      </p>
      {TRAYS.map(t => <TrayCalibration key={t.value} tray={t.value} title={t.title} settings={settings} onApply={onApply} />)}
    </div>
  );
}

function TrayCalibration({ tray, title, settings, onApply }: { tray: TrayKind; title: string; settings: PrintSettings; onApply: (next: PrintSettings) => Promise<void> }) {
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
      <div className="tray-calibration-head">
        <strong>{title}</strong>
        <span className="hint">{shown ? `✓ Calibrated: A ${shown.a}, B ${shown.b}` : 'Not calibrated yet'}</span>
      </div>
      <div className="row tray-calibration-row">
        <button type="button" onClick={printSheet}>Print calibration sheet</button>
        <label>A (fold left to right)<input type="number" step="0.5" value={a} onChange={e => setA(e.target.value)} placeholder="e.g. -1" /></label>
        <label>B (fold top to bottom)<input type="number" step="0.5" value={b} onChange={e => setB(e.target.value)} placeholder="e.g. 6.5" /></label>
        <button type="button" className="primary" onClick={save}>Save</button>
        {saved && <button type="button" className="link" onClick={clear}>Remove</button>}
      </div>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
    </div>
  );
}
