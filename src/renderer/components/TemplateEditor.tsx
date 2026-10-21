import { useMemo, useRef, useState } from 'react';
import { parseAmountToFils } from '../../shared/amountInWords';
import { renderCheque } from '../../shared/chequeRender';
import type { DetectionResult } from '../../shared/detect/detectCheque';
import { applyBank, matchBank, type BankTemplate } from '../../shared/banks';
import { blankLayout, scaleLayout } from '../../shared/layoutDefaults';
import { editableFields, moveDate, toggleDateMode, updateField, type FieldKey } from '../../shared/layoutFields';
import { graphStart, withGraphStart, type GraphPoint } from '../../shared/graph';
import { CROSSING_LABELS, type ChequeLayout, type ChequeTemplate, type CrossingOption, type PrintSettings } from '../../shared/types';
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

const FIELD_NAMES: Record<string, string> = {
  payee: 'payee line', words1: 'first words line', words2: 'second words line',
  amount: 'amount box', date: 'date', bearer: '"or bearer" text',
};

interface EditorProps {
  initial: Draft;
  settings: PrintSettings;
  onCancel: () => void;
  onSaved: (template: ChequeTemplate) => Promise<void>;
  /** Label of the save button, e.g. "Next: cheque book details". */
  saveLabel?: string;
}

export function TemplateEditor({ initial, settings, onCancel, onSaved, saveLabel = 'Save cheque design' }: EditorProps) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [upload, setUpload] = useState<LoadedUpload | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<FieldKey | null>(null);
  const [widthInput, setWidthInput] = useState('');
  /** A recognised bank and the layout detection found, to go back to it. */
  const [bank, setBank] = useState<{ bank: BankTemplate; detected: ChequeLayout } | null>(null);
  const [libraryApplied, setLibraryApplied] = useState(false);
  const [sample, setSample] = useState({ payee: 'Sample Trading LLC', amount: '12,345.50', date: new Date().toLocaleDateString('en-CA'), crossing: 'ac-payee-bearer' as CrossingOption });
  const fileInput = useRef<HTMLInputElement>(null);
  const measure = useMemo(() => createMeasure(settings.fontFamily), [settings.fontFamily]);
  const isNew = draft.id === undefined;
  const hasLeaf = draft.image !== null || !isNew;

  const rendered = useMemo(() => {
    try {
      return renderCheque(draft.layout, { payee: sample.payee, amountFils: parseAmountToFils(sample.amount) ?? 0, date: sample.date, crossing: sample.crossing }, settings, measure);
    } catch {
      return { items: [], warnings: ['Enter a valid sample date.'] };
    }
  }, [draft.layout, sample, settings, measure]);

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

  const save = async () => {
    if (!draft.name.trim()) {
      setError('Give the cheque book a name, for example "FAB current account".');
      return;
    }
    if (detection && !detection.sizeKnown) {
      setError('Enter the real cheque width first, so the printout is the right size.');
      return;
    }
    try {
      const saved = await window.chequeApi.saveTemplate({ id: draft.id, name: draft.name, layout: draft.layout, image: draft.image });
      await onSaved(saved);
    } catch (e) {
      setError(String(e));
    }
  };

  const setLayout = (layout: ChequeLayout) => setDraft(d => ({ ...d, layout }));
  /** A typed X, Y or length from the graph table. */
  const setGraph = (key: FieldKey, next: Partial<GraphPoint & { length: number }>) => {
    if (Object.values(next).some(v => !Number.isFinite(v))) return;
    const L = draft.layout;
    if (key === 'date' && L.date.mode === 'digits') {
      const now = graphRows(L)[0].start;
      setLayout(moveDate(L, (next.x ?? now.x) - now.x, -((next.y ?? now.y) - now.y)));
      return;
    }
    const box = editableFields(L).find(f => f.key === key)?.box;
    if (box) setLayout(updateField(L, key, withGraphStart(box, L.chequeHeight, next)));
  };
  // An existing FAB or RAKBANK design can take the bank library's measured writing spaces in one click.
  const libraryMatch = !detection && !isNew && !libraryApplied ? matchBank(draft.layout) : null;
  const field = selected ? editableFields(draft.layout).find(f => f.key === selected) : undefined;
  const setBox = (key: 'x' | 'y' | 'width' | 'height', value: number) =>
    field && Number.isFinite(value) && setLayout(updateField(draft.layout, field.key, { ...field.box, [key]: value }));

  return (
    <section className="template-editor">
      <div className="editor-main">
        <div className="editor-toolbar">
          <button onClick={onCancel}>← Back</button>
          <input className="name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Cheque book name, e.g. FAB current account" />
          <button onClick={() => fileInput.current?.click()} disabled={!!busy}>{hasLeaf ? 'Upload a different leaf' : 'Choose file'}</button>
          {upload && <button onClick={() => runDetection(upload, !detection?.transform.flip)} disabled={!!busy}>Turn upside down</button>}
          {upload && <button onClick={() => runDetection(upload, detection?.transform.flip)} disabled={!!busy}>Detect again</button>}
          <button className="primary" onClick={save} disabled={!!busy || !hasLeaf}>{saveLabel}</button>
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
            <span>PDF, JPG or PNG. A full A4 scan or a cropped cheque both work. For exact sizes, scan at 300 DPI. With a phone, lay the cheque on the <button type="button" className="link" onClick={e => { e.stopPropagation(); window.chequeApi.printRulerSheet(settings.printerName); }}>ruler sheet</button> and take the photo from above.</span>
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
            <button type="button" className="primary" onClick={() => { setLayout(applyBank(libraryMatch, draft.layout)); setLibraryApplied(true); }}>Use the {libraryMatch.name} layout from the bank library</button>
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
            <div className="canvas-wrap">
              <ChequeCanvas
                layout={draft.layout}
                items={rendered.items}
                fontFamily={settings.fontFamily}
                image={draft.image}
                editable
                selected={selected}
                onSelect={setSelected}
                onChange={setLayout}
                graph
              />
            </div>
            <p className="hint">Drag a box to move it, drag its corner to resize. Arrow keys move the selected box 0.5 mm (Shift: 0.1 mm). The cheque image is never printed.</p>
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

          <h3>Where each field starts</h3>
          <p className="hint">In mm from the cheque's bottom-left corner (0, 0): X across, Y up to the writing line. Length is where the line ends; longer text moves to the next line or gets smaller.</p>
          <table className="graph-table">
            <thead><tr><th>Field</th><th>X</th><th>Y</th><th>Length</th></tr></thead>
            <tbody>
              {graphRows(draft.layout).map(row => (
                <tr key={row.key} className={selected === row.key ? 'selected' : ''}>
                  <td className="name" onClick={() => setSelected(row.key)}>{row.label}</td>
                  <td><input type="number" step="0.5" value={row.start.x} onFocus={() => setSelected(row.key)} onChange={e => setGraph(row.key, { x: Number(e.target.value) })} /></td>
                  <td><input type="number" step="0.5" value={row.start.y} onFocus={() => setSelected(row.key)} onChange={e => setGraph(row.key, { y: Number(e.target.value) })} /></td>
                  <td>{row.fixedLength ? <span className="hint">{row.start.length}</span> : <input type="number" step="0.5" value={row.start.length} onFocus={() => setSelected(row.key)} onChange={e => setGraph(row.key, { length: Number(e.target.value) })} />}</td>
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
            <select value={draft.layout.defaultCrossing ?? 'ac-payee-bearer'} onChange={e => setLayout({ ...draft.layout, defaultCrossing: e.target.value as CrossingOption })}>
              {Object.entries(CROSSING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <p className="hint">If the cheque already has A/C PAYEE printed on it, choose the "Or Bearer" strike only, so it is not printed twice.</p>
          <button onClick={() => { setSelected(null); setLayout(toggleDateMode(draft.layout)); }}>
            {draft.layout.date.mode === 'line' ? 'Date has 8 digit boxes' : 'Date is written on a line'}
          </button>
        </aside>
      )}
    </section>
  );
}
