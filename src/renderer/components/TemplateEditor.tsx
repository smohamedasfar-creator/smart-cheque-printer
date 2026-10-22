import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { parseAmountToFils } from '../../shared/amountInWords';
import { renderCheque } from '../../shared/chequeRender';
import type { DetectionResult } from '../../shared/detect/detectCheque';
import { fieldShift, layoutForPosition, MAIN_POSITION, mapAllPositions, modeOf, READY_POSITIONS, shiftFor, toDefault, toManual, VERTICAL_DIFF_TEXT, withPositionLayout, withShift, type Shift } from '../../shared/positions';
import { applyBank, bankBySize, crossingFor, matchBank, type BankTemplate } from '../../shared/banks';
import { blankLayout, scaleLayout } from '../../shared/layoutDefaults';
import { editableFields, moveDate, toggleDateMode, updateField, type FieldKey } from '../../shared/layoutFields';
import { graphStart, withGraphStart, type GraphPoint } from '../../shared/graph';
import { CROSSING_LABELS, type ChequeLayout, type CrossingOption, type PositionKey, type PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { chequeImageDataUrl, detectAsync, loadUpload, type LoadedUpload } from '../upload';
import { ChequeCanvas } from './ChequeCanvas';

export interface Draft {
  id?: number;
  name: string;
  layout: ChequeLayout;
  image: string | null;
}

interface GraphRow {
  key: FieldKey;
  label: string;
  start: GraphPoint & { length: number };
  /** Digit boxes keep their spacing: only the whole date moves. */
  fixedLength?: boolean;
}

/** One row per field: where it starts on the graph (mm from the bottom-left corner) and how long its line is. */
function graphRows(L: ChequeLayout): GraphRow[] {
  const H = L.chequeHeight;
  const rows: GraphRow[] = [];
  if (L.date.mode === 'line') rows.push({ key: 'date', label: 'Date', start: graphStart(L.date.box, H) });
  else {
    const first = L.date.boxes[0];
    const last = L.date.boxes[L.date.boxes.length - 1];
    rows.push({ key: 'date', label: 'Date (8 boxes)', start: { ...graphStart(first, H), length: tenth(last.x + last.width - first.x) }, fixedLength: true });
  }
  rows.push(
    { key: 'payee', label: 'Payee', start: graphStart(L.payee, H) },
    { key: 'words1', label: 'Words line 1', start: graphStart(L.words1, H) },
    { key: 'words2', label: 'Words line 2', start: graphStart(L.words2, H) },
    { key: 'amount', label: 'Amount', start: graphStart(L.amount, H) },
    { key: 'bearer', label: 'Or bearer strike', start: graphStart(L.bearerStrike, H) },
  );
  return rows;
}

/** Millimetres shown to one decimal, as typed. */
const tenth = (v: number) => Math.round(v * 10) / 10;

const TAB_NAMES: Record<PositionKey, string> = {
  'rear-h': 'Back · Horizontal (main)',
  'rear-v': 'Back · Vertical',
  'front-h': 'Front · Horizontal',
  'front-v': 'Front · Vertical',
};

/** A position's adjustment in short, e.g. "→1 ↑3.5 mm". */
function shiftText(s: Shift): string {
  const parts = [s.x ? `${s.x > 0 ? '→' : '←'}${Math.abs(s.x)}` : '', s.y ? `${s.y > 0 ? '↑' : '↓'}${Math.abs(s.y)}` : ''].filter(Boolean);
  return parts.length ? `${parts.join(' ')} mm` : 'as laid out';
}

const FIELD_NAMES: Record<string, string> = {
  payee: 'payee line', words1: 'first words line', words2: 'second words line',
  amount: 'amount box', date: 'date', bearer: '"or bearer" text',
};

interface EditorProps {
  /** The cheque layout and picture, kept by the cheque book screen (saved together with its details). */
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  settings: PrintSettings;
  /** Why the cheque book cannot be saved yet (e.g. its real size is still unknown), or null. */
  onBlock?: (reason: string | null) => void;
}

/** A typed X, Y or length from the field table, applied to a layout; null when the number is not valid. */
function graphEdit(L: ChequeLayout, key: FieldKey, next: Partial<GraphPoint & { length: number }>): ChequeLayout | null {
  if (Object.values(next).some(v => !Number.isFinite(v))) return null;
  if (key === 'date' && L.date.mode === 'digits') {
    const now = graphRows(L)[0].start;
    return moveDate(L, (next.x ?? now.x) - now.x, -((next.y ?? now.y) - now.y));
  }
  const box = editableFields(L).find(f => f.key === key)?.box;
  return box ? updateField(L, key, withGraphStart(box, L.chequeHeight, next)) : null;
}

export function TemplateEditor({ draft, setDraft, settings, onBlock }: EditorProps) {
  const [upload, setUpload] = useState<LoadedUpload | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<FieldKey | null>(null);
  const [widthInput, setWidthInput] = useState('');
  /** A recognised bank and the layout detection found, to go back to it. */
  const [bank, setBank] = useState<{ bank: BankTemplate; detected: ChequeLayout } | null>(null);
  const [libraryApplied, setLibraryApplied] = useState(false);
  /** The print position whose layout is shown: each prints the fields moved by its own adjustment. */
  const [tab, setTab] = useState<PositionKey>(MAIN_POSITION);
  const [sample, setSample] = useState({ payee: 'Sample Trading LLC', amount: '12,345.50', date: new Date().toLocaleDateString('en-CA'), crossing: 'ac-payee-bearer' as CrossingOption });
  const fileInput = useRef<HTMLInputElement>(null);
  const measure = useMemo(() => createMeasure(settings.fontFamily), [settings.fontFamily]);
  const isNew = draft.id === undefined;
  const hasLeaf = draft.image !== null || !isNew;

  const rendered = useMemo(() => {
    try {
      return renderCheque(layoutForPosition(draft.layout, tab), { payee: sample.payee, amountFils: parseAmountToFils(sample.amount) ?? 0, date: sample.date, crossing: sample.crossing }, settings, measure);
    } catch {
      return { items: [], warnings: ['Enter a valid sample date.'] };
    }
  }, [draft.layout, tab, sample, settings, measure]);

  const runDetection = async (loaded: LoadedUpload, flip?: boolean) => {
    setBusy('Measuring the cheque and finding its fields…');
    setError('');
    try {
      const result = await detectAsync(loaded, flip);
      setDetection(result);
      setSelected(null);
      setWidthInput('');
      // A cheque from the bank library gets that bank's measured writing spaces.
      const known = result.sizeKnown ? matchBank(result.layout, result.found) : null;
      setBank(known ? { bank: known, detected: result.layout } : null);
      const layout = known ? applyBank(known, result.layout) : result.layout;
      setDraft(d => ({ ...d, layout, image: chequeImageDataUrl(loaded, result), name: d.name || (known ? known.name : d.name) }));
    } catch (e) {
      setError(`Could not read this file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('Opening the file…');
    try {
      const loaded = await loadUpload(file);
      setUpload(loaded);
      if (!draft.name) setDraft(d => ({ ...d, name: file.name.replace(/\.[^.]+$/, '') }));
      await runDetection(loaded);
    } catch (e) {
      setBusy('');
      setError(`Could not open this file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const applyWidth = () => {
    const width = Number(widthInput);
    if (!(width > 50 && width < 400)) {
      setError('Enter the cheque width in millimetres, for example 158.');
      return;
    }
    setError('');
    // With the real size known, a cheque from the bank library can now be recognised.
    const scaled = scaleLayout(draft.layout, width / draft.layout.chequeWidth);
    const known = matchBank(scaled, detection?.found);
    setBank(known ? { bank: known, detected: scaled } : null);
    setDraft(d => ({ ...d, layout: known ? applyBank(known, scaled) : scaled }));
    setDetection(r => (r ? { ...r, sizeKnown: true, warnings: r.warnings.filter(w => !w.includes('width')) } : r));
  };

  // The cheque book screen cannot save while the real size of a photo is unknown.
  useEffect(() => onBlock?.(detection && !detection.sizeKnown ? 'Enter the real cheque width first, so the printout is the right size.' : null), [detection?.sizeKnown]);

  const setLayout = (layout: ChequeLayout) => setDraft(d => ({ ...d, layout }));
  // An existing FAB or RAKBANK design can take the bank library's measured writing spaces in one click.
  // Known by its lines, or by its size when the fields were moved by hand (often to make up for where a printer prints).
  const manual = modeOf(draft.layout) === 'manual';
  const libraryMatch = !detection && !isNew && !libraryApplied && !manual ? matchBank(draft.layout) ?? bankBySize(draft.layout) : null;
  // The layout as it prints in the chosen position. Default setting: fields and X / Y are set on the main position and the
  // others keep their difference. Manual setting: every position is changed on its own tab.
  const tabShift = shiftFor(draft.layout, tab);
  const shown = layoutForPosition(draft.layout, tab);
  const onMain = tab === MAIN_POSITION;
  const editable = onMain || manual;
  /** A change made on this tab's layout (as it prints there). */
  const setShown = (L: ChequeLayout | null) => L && setLayout(withPositionLayout(draft.layout, tab, L));
  const setTabShift = (s: Shift) => Number.isFinite(s.x) && Number.isFinite(s.y) && setLayout(withShift(draft.layout, tab, s));
  const setGraph = (key: FieldKey, next: Partial<GraphPoint & { length: number }>) => setShown(graphEdit(shown, key, next));
  /** Puts every field on the bank's cheque lines; the print keeps its place through the main position's adjustment. */
  const useLibrary = (bankTemplate: BankTemplate) => {
    const applied = { ...applyBank(bankTemplate, draft.layout), positionShifts: draft.layout.positionShifts, positionsVersion: draft.layout.positionsVersion };
    const moved = fieldShift(draft.layout, applied);
    const main = shiftFor(draft.layout, MAIN_POSITION);
    setLayout(moved.x || moved.y ? withShift(applied, MAIN_POSITION, { x: main.x - moved.x, y: main.y + moved.y }) : applied);
    setLibraryApplied(true);
  };
  const field = selected ? editableFields(shown).find(f => f.key === selected) : undefined;
  const setBox = (key: 'x' | 'y' | 'width' | 'height', value: number) =>
    field && Number.isFinite(value) && setShown(updateField(shown, field.key, { ...field.box, [key]: value }));
  const setMode = (to: 'default' | 'manual') => {
    if (to === 'default' && manual && !confirm('Back to the default setting? The main position (back tray, horizontal) is kept; the other three go back to the fixed difference and lose their own changes.')) return;
    setLayout(to === 'manual' ? toManual(draft.layout) : toDefault(draft.layout));
  };

  return (
    <section className="template-editor">
      <div className="editor-main">
        <div className="editor-toolbar">
          <input className="name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Cheque book name, e.g. FAB current account" />
          <button onClick={() => fileInput.current?.click()} disabled={!!busy}>{hasLeaf ? 'Upload a different leaf' : 'Choose file'}</button>
          {upload && <button onClick={() => runDetection(upload, !detection?.transform.flip)} disabled={!!busy}>Turn upside down</button>}
          {upload && <button onClick={() => runDetection(upload, detection?.transform.flip)} disabled={!!busy}>Detect again</button>}
          <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        {!hasLeaf && !busy && (
          <div
            className="dropzone"
            onClick={() => fileInput.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
          >
            <strong>Drop a scan of a blank cheque here, or click to choose a file</strong>
            <span>PDF, JPG or PNG. A full A4 scan or a cropped cheque both work. For exact sizes, scan at 300 DPI with a dark sheet behind the cheque (or the lid open) so its edges show. With a phone, lay the cheque on the <button type="button" className="link" onClick={e => { e.stopPropagation(); window.chequeApi.printRulerSheet(settings.printerName); }}>ruler sheet</button> and take the photo from above.</span>
          </div>
        )}
        {busy && <div className="busy">{busy}</div>}
        {error && <p className="error">{error}</p>}

        {detection && (
          <div className="detect-summary">
            <span className="chip ok">Size {draft.layout.chequeWidth.toFixed(1)} × {draft.layout.chequeHeight.toFixed(1)} mm{detection.sizeKnown ? '' : ' (estimated)'}</span>
            {upload?.ruler && <span className="chip ok">✓ Measured with the ruler sheet</span>}
            {bank && <span className="chip ok">✓ Recognised {bank.bank.name}: writing spaces from the bank library</span>}
            {detection.croppedUpload ? <span className="chip">Cropped upload</span> : <span className="chip">Found cheque on page</span>}
            {detection.transform.flip && <span className="chip">Turned the right way up</span>}
            {Math.abs(detection.transform.skewDeg) >= 0.1 && <span className="chip">Straightened {Math.abs(detection.transform.skewDeg).toFixed(1)}°</span>}
            {detection.found.map(f => <span key={f} className="chip ok">✓ {FIELD_NAMES[f] ?? f}</span>)}
            {detection.guessed.map(f => <span key={f} className="chip warn">? {FIELD_NAMES[f] ?? f} — please check</span>)}
          </div>
        )}
        {libraryMatch && (
          <p className="hint">
            This is a {libraryMatch.name} cheque.{' '}
            <button type="button" className="primary" onClick={() => useLibrary(libraryMatch)}>Put every field on the {libraryMatch.name} cheque lines</button>
            <br />The fields go back on the lines of the picture and the print keeps its place: the difference becomes the main position&apos;s setting below.
          </p>
        )}
        {bank && (
          <p className="hint">
            The writing spaces come from the {bank.bank.name} cheque in the bank library.{' '}
            <button type="button" className="link" onClick={() => { setDraft(d => ({ ...d, layout: bank.detected })); setBank(null); }}>Use the detected spaces instead</button>
          </p>
        )}
        {detection && !detection.sizeKnown && (
          <div className="width-prompt">
            <span>This photo has no size information. For the exact size, <button type="button" className="link" onClick={() => window.chequeApi.printRulerSheet(settings.printerName)}>print the ruler sheet</button>, lay the cheque on it and take the photo again. Or measure the cheque and enter its width:</span>
            <input type="number" value={widthInput} onChange={e => setWidthInput(e.target.value)} placeholder="e.g. 158" />
            <span>mm</span>
            <button className="primary" onClick={applyWidth}>Apply</button>
          </div>
        )}

        {hasLeaf && (
          <>
            <div className="position-mode" role="radiogroup" aria-label="Print position setting">
              <span>Print positions:</span>
              <button type="button" role="radio" aria-checked={!manual} className={manual ? '' : 'active'} onClick={() => setMode('default')}>Default</button>
              <button type="button" role="radio" aria-checked={manual} className={manual ? 'active' : ''} onClick={() => setMode('manual')}>Manual</button>
              <span className="hint">
                {manual
                  ? 'Manual: each position has its own fields and its own X / Y. Changing one never changes another.'
                  : `Default: set the fields and X / Y on the main position; the other three follow it. Vertical prints ${VERTICAL_DIFF_TEXT} than horizontal.`}
              </span>
            </div>
            <div className="position-tabs" role="tablist" aria-label="Print position">
              {READY_POSITIONS.map(r => {
                const s = shiftFor(draft.layout, r.key);
                return (
                  <button key={r.key} type="button" role="tab" aria-selected={tab === r.key} className={tab === r.key ? 'active' : ''} onClick={() => { setTab(r.key); setSelected(null); }}>
                    <strong>{TAB_NAMES[r.key]}</strong>
                    <span>{manual ? 'Own setting' : s.auto ? 'Follows main' : 'Main'} · {shiftText(s)}</span>
                  </button>
                );
              })}
            </div>
            <div className="row position-shift">
              <span className="hint">
                {editable ? 'Print adjustment for this position (mm), moves the whole print:' : `Follows the main position${tab.endsWith('-v') ? `, ${VERTICAL_DIFF_TEXT}` : ''}. Change it on the main tab, or switch to Manual.`}
              </span>
              <label>X →<input type="number" step="0.5" readOnly={!editable} value={tabShift.x} onChange={e => setTabShift({ x: Number(e.target.value), y: tabShift.y })} /></label>
              <label>Y ↑<input type="number" step="0.5" readOnly={!editable} value={tabShift.y} onChange={e => setTabShift({ x: tabShift.x, y: Number(e.target.value) })} /></label>
            </div>
            <div className="canvas-wrap">
              <ChequeCanvas
                layout={shown}
                items={rendered.items}
                fontFamily={settings.fontFamily}
                image={draft.image}
                editable={editable}
                selected={selected}
                onSelect={setSelected}
                onChange={setShown}
                graph
              />
            </div>
            <p className="hint">
              {editable
                ? 'Drag a box to move it, drag its corner to resize. Arrow keys move the selected box 0.5 mm (Shift: 0.1 mm). The cheque image is never printed.'
                : 'This is where the text prints in this position. In the default setting the fields are changed on the main tab.'}
            </p>
            {rendered.warnings.map(w => <p key={w} className="warning">{w}</p>)}
          </>
        )}
      </div>

      {hasLeaf && (
        <aside className="inspector form">
          <h3>Try it with sample text</h3>
          <label>Payee<input value={sample.payee} onChange={e => setSample(s => ({ ...s, payee: e.target.value }))} /></label>
          <div className="row">
            <label>Amount<input value={sample.amount} onChange={e => setSample(s => ({ ...s, amount: e.target.value }))} /></label>
            <label>Date<input type="date" value={sample.date} onChange={e => setSample(s => ({ ...s, date: e.target.value }))} /></label>
          </div>

          <h3>Where each field starts · {TAB_NAMES[tab]}</h3>
          <p className="hint">In mm from the cheque's bottom-left corner (0, 0): X across, Y up to the writing line. Length is where the line ends; longer text moves to the next line or gets smaller.</p>
          <table className="graph-table">
            <thead><tr><th>Field</th><th>X</th><th>Y</th><th>Length</th></tr></thead>
            <tbody>
              {graphRows(shown).map(row => (
                <tr key={row.key} className={selected === row.key ? 'selected' : ''}>
                  <td className="name" onClick={() => setSelected(row.key)}>{row.label}</td>
                  <td><input type="number" step="0.5" readOnly={!editable} value={row.start.x} onFocus={() => setSelected(row.key)} onChange={e => setGraph(row.key, { x: Number(e.target.value) })} /></td>
                  <td><input type="number" step="0.5" readOnly={!editable} value={row.start.y} onFocus={() => setSelected(row.key)} onChange={e => setGraph(row.key, { y: Number(e.target.value) })} /></td>
                  <td>{row.fixedLength ? <span className="hint">{row.start.length}</span> : <input type="number" step="0.5" readOnly={!editable} value={row.start.length} onFocus={() => setSelected(row.key)} onChange={e => setGraph(row.key, { length: Number(e.target.value) })} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {field && (
            <label>Height of the {field.label.toLowerCase()} space (mm)<input type="number" step="0.5" value={tenth(field.box.height)} onChange={e => setBox('height', Number(e.target.value))} /></label>
          )}
          <p className="hint">Text size and font are set once for all cheques in Settings.</p>

          <h3>Layout options</h3>
          <label>
            Crossing printed by default
            <select value={crossingFor(draft.layout)} onChange={e => setLayout({ ...draft.layout, defaultCrossing: e.target.value as CrossingOption })}>
              {Object.entries(CROSSING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <p className="hint">If the cheque already has A/C PAYEE printed on it, choose the "Or Bearer" strike only, so it is not printed twice.</p>
          <button onClick={() => { setSelected(null); setLayout(mapAllPositions(draft.layout, toggleDateMode)); }}>
            {draft.layout.date.mode === 'line' ? 'Date has 8 digit boxes' : 'Date is written on a line'}
          </button>
        </aside>
      )}
    </section>
  );
}
