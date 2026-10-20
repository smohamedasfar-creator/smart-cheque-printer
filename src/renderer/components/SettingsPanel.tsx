import { useEffect, useState } from 'react';
import { amountInWords } from '../../shared/amountInWords';
import { TEXT_SIZES } from '../../shared/chequeRender';
import { DEFAULT_SETTINGS, type PrintSettings } from '../../shared/types';

interface Props {
  settings: PrintSettings;
  onSave: (settings: PrintSettings) => Promise<void>;
}

interface CalibrationProps {
  settings: PrintSettings;
  onApply: (settings: PrintSettings) => Promise<void>;
}

/** One-time setup: the ruler page shows where this printer puts a cheque on the page. */
function PrinterCalibration({ settings, onApply }: CalibrationProps) {
  const [left, setLeft] = useState('');
  const [top, setTop] = useState('0');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const printRuler = async () => {
    const result = await window.chequeApi.printCalibration(settings.printerName);
    setMessage(result.ok ? { kind: 'ok', text: 'Ruler page sent. Now read the numbers at the cheque edges.' } : { kind: 'error', text: result.error ?? 'Printing failed' });
  };

  const apply = async () => {
    const x = Number(left);
    const y = Number(top);
    if (left.trim() === '' || !Number.isFinite(x) || x < 0 || x > 150 || !Number.isFinite(y) || y < 0 || y > 100) {
      setMessage({ kind: 'error', text: 'Enter the two ruler numbers in millimetres, for example 52 and 0.' });
      return;
    }
    await onApply({ ...settings, paper: 'a4-portrait', feedAlign: 'left', offsetX: x, offsetY: y, calibrated: true });
    setMessage({ kind: 'ok', text: `Saved: your printer puts the cheque ${x} mm from the left and ${y} mm from the top of the page. Do a test print to confirm.` });
  };

  return (
    <div className={`calibration${settings.calibrated ? ' done' : ''}`}>
      <h3>{settings.calibrated ? '✓ Printer calibrated' : 'Printer calibration (do this once)'}</h3>
      {settings.calibrated && (
        <p className="hint">Cheque position: {settings.offsetX} mm from the left, {settings.offsetY} mm from the top. Repeat only if you change printer or how you feed cheques.</p>
      )}
      <ol>
        <li>Cut a plain paper to the size of your cheque (or use a spoiled cheque).</li>
        <li>Put it in the printer <b>exactly like a real cheque</b>: same tray, same edge against the guide, same side up.</li>
        <li><button onClick={printRuler}>Print ruler page</button></li>
        <li>On the printed paper, read the ruler number at the cheque's <b>left edge</b> and at its <b>top edge</b>.</li>
      </ol>
      <div className="row">
        <label>Number at the left edge (mm)<input type="number" step="0.5" value={left} onChange={e => setLeft(e.target.value)} placeholder="e.g. 52" /></label>
        <label>Number at the top edge (mm)<input type="number" step="0.5" value={top} onChange={e => setTop(e.target.value)} /></label>
      </div>
      <div className="actions">
        <button className="primary" onClick={apply}>Save calibration</button>
      </div>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
    </div>
  );
}

function DataBackup() {
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const backup = async () => {
    const r = await window.chequeApi.backupData();
    if (r.saved) setMessage({ kind: 'ok', text: `Backup saved to ${r.path}` });
  };
  const restore = async () => {
    const r = await window.chequeApi.restoreData();
    if (r.error) setMessage({ kind: 'error', text: r.error });
  };
  return (
    <>
      <div className="actions">
        <button onClick={backup}>Back up data…</button>
        <button onClick={restore}>Restore from backup…</button>
      </div>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
    </>
  );
}

const COMMON_FONTS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

/** Installed fonts, read once from Windows (Local Font Access); falls back to common Windows fonts. */
function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [fonts, setFonts] = useState<string[]>(COMMON_FONTS);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (loaded) return;
    setLoaded(true);
    try {
      const query = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
      if (!query) return;
      const families = [...new Set((await query()).map(f => f.family))].sort((a, b) => a.localeCompare(b));
      if (families.length) setFonts(families);
    } catch {
      // keep the common list
    }
  };

  useEffect(() => {
    load();
  }, []);

  const options = fonts.includes(value) ? fonts : [value, ...fonts];
  return (
    <label>
      Font
      <select value={value} onFocus={load} onChange={e => onChange(e.target.value)} style={{ fontFamily: value }}>
        {options.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
      </select>
    </label>
  );
}

export function SettingsPanel({ settings, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  const [printers, setPrinters] = useState<Array<{ name: string; isDefault: boolean }>>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.chequeApi.listPrinters().then(setPrinters);
  }, []);

  const set = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
    setSaved(false);
    setDraft(d => ({ ...d, [key]: value }));
  };

  const example = amountInWords(125050, {
    style: draft.wordsStyle,
    prefix: draft.wordsPrefix,
    suffix: draft.wordsSuffix,
    minorUnit: draft.minorUnit,
    fractionFormat: draft.fractionFormat,
    capitals: draft.capitals,
    hyphenate: draft.hyphenate,
  });

  return (
    <section className="settings form">
      <h2>Amount in words</h2>
      <div className="row">
        <label>
          Style
          <select value={draft.wordsStyle} onChange={e => set('wordsStyle', e.target.value as PrintSettings['wordsStyle'])}>
            <option value="uk">UK — One Hundred and Twenty</option>
            <option value="us">US — One Hundred Twenty</option>
          </select>
        </label>
        <label>
          Fils written as
          <select value={draft.fractionFormat} onChange={e => set('fractionFormat', e.target.value as PrintSettings['fractionFormat'])}>
            <option value="words">Words — and Fils Fifty</option>
            <option value="numeric">Number — and 50/100</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label>Prefix<input value={draft.wordsPrefix} onChange={e => set('wordsPrefix', e.target.value)} /></label>
        <label>Suffix<input value={draft.wordsSuffix} onChange={e => set('wordsSuffix', e.target.value)} /></label>
        <label>Minor unit<input value={draft.minorUnit} onChange={e => set('minorUnit', e.target.value)} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={draft.hyphenate} onChange={e => set('hyphenate', e.target.checked)} /> Use hyphens (Twenty-Three instead of Twenty Three)</label>
      <p className="example">Example: {example}</p>

      <h2>Amount and text</h2>
      <div className="row">
        <label>Amount prefix<input value={draft.amountPrefix} onChange={e => set('amountPrefix', e.target.value)} placeholder="e.g. **" /></label>
        <label>Amount suffix<input value={draft.amountSuffix} onChange={e => set('amountSuffix', e.target.value)} placeholder="e.g. /-" /></label>
        <label>
          Date format (written date lines)
          <select value={draft.dateFormat} onChange={e => set('dateFormat', e.target.value as PrintSettings['dateFormat'])}>
            <option value="DD/MM/YYYY">19/10/2026</option>
            <option value="DD-MM-YYYY">19-10-2026</option>
            <option value="DD.MM.YYYY">19.10.2026</option>
            <option value="DD MMM YYYY">19 Oct 2026</option>
            <option value="DD/MM/YY">19/10/26</option>
          </select>
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={draft.capitals} onChange={e => set('capitals', e.target.checked)} /> Print in capital letters</label>
      <label className="check"><input type="checkbox" checked={draft.hideZeroFraction} onChange={e => set('hideZeroFraction', e.target.checked)} /> Hide ".00" when there are no fils</label>
      <div className="row">
        <label>
          Text size
          <select value={draft.textSize} onChange={e => set('textSize', Number(e.target.value))}>
            {TEXT_SIZES.map(s => <option key={s} value={s}>{s} pt{s === DEFAULT_SETTINGS.textSize ? ' (default)' : ''}</option>)}
          </select>
        </label>
        <FontPicker value={draft.fontFamily} onChange={v => set('fontFamily', v)} />
      </div>

      <h2>Printer</h2>
      <label>
        Printer
        <select value={draft.printerName} onChange={e => set('printerName', e.target.value)}>
          <option value="">Ask every time</option>
          {printers.map(p => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
        </select>
      </label>

      <label>
        How does the cheque go into the printer?
        <select value={draft.feedRotation} onChange={e => set('feedRotation', Number(e.target.value) as PrintSettings['feedRotation'])}>
          <option value={0}>Long edge first (cheque lies sideways, normal)</option>
          <option value={90}>Short edge first (vertical) – text turned clockwise</option>
          <option value={270}>Short edge first (vertical) – text turned anti-clockwise</option>
          <option value={180}>Long edge first, upside down</option>
        </select>
      </label>
      <p className="hint">For vertical feeding, pick one of the "short edge first" options and do a test print on plain paper. If the text comes out upside down, choose the other one. Then calibrate with the cheque fed the same way.</p>

      <PrinterCalibration
        settings={draft}
        onApply={async next => {
          setDraft(next);
          await onSave(next);
          setSaved(true);
        }}
      />

      <details className="advanced">
        <summary>Advanced paper settings</summary>
        <div className="row">
          <label>
            Paper
            <select value={draft.paper} onChange={e => set('paper', e.target.value as PrintSettings['paper'])}>
              <option value="a4-portrait">A4 portrait, cheque fed at top</option>
              <option value="a4-landscape">A4 landscape, cheque fed at top</option>
              <option value="cheque">Cheque-sized page (only if the printer driver supports it)</option>
            </select>
          </label>
          <label>
            Cheque position in tray
            <select value={draft.feedAlign} disabled={draft.paper === 'cheque'} onChange={e => set('feedAlign', e.target.value as PrintSettings['feedAlign'])}>
              <option value="left">Left edge</option>
              <option value="center">Centre</option>
              <option value="right">Right edge</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label>Shift right (mm)<input type="number" step="0.5" value={draft.offsetX} onChange={e => set('offsetX', Number(e.target.value))} /></label>
          <label>Shift down (mm)<input type="number" step="0.5" value={draft.offsetY} onChange={e => set('offsetY', Number(e.target.value))} /></label>
        </div>
        <p className="hint">Calibration fills these in. Shifts apply to every account; each account also has its own fine-tuning.</p>
      </details>

      <h2>Your data</h2>
      <p className="hint">Back up your cheque books, payees, history and settings to a file, for example before changing computers.</p>
      <DataBackup />

      <div className="actions">
        <button className="primary" onClick={async () => { await onSave(draft); setSaved(true); }}>Save settings</button>
        {saved && <span className="success">Saved.</span>}
      </div>
    </section>
  );
}
