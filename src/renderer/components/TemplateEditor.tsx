import { useMemo, useRef, useState } from 'react';
import { parseAmountToFils } from '../../shared/amountInWords';
import { renderCheque } from '../../shared/chequeRender';
import type { DetectionResult } from '../../shared/detect/detectCheque';
import { blankLayout, scaleLayout } from '../../shared/layoutDefaults';
import { editableFields, toggleDateMode, updateField, type FieldKey } from '../../shared/layoutFields';
import type { ChequeLayout, ChequeTemplate, CrossingOption, PrintSettings } from '../../shared/types';
import { createMeasure } from '../measure';
import { chequeImageDataUrl, detectAsync, loadUpload, type LoadedUpload } from '../upload';
import { ChequeCanvas } from './ChequeCanvas';

export interface Draft {
  id?: number;
  name: string;
  layout: ChequeLayout;
  image: string | null;
}

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
      setDraft(d => ({ ...d, layout: result.layout, image: chequeImageDataUrl(loaded, result) }));
    } catch (e) {
      setError(`Could not read this file: ${String(e)}`);
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
      setError(`Could not open this file: ${String(e)}`);
    }
  };

  const applyWidth = () => {
    const width = Number(widthInput);
    if (!(width > 50 && width < 400)) {
      setError('Enter the cheque width in millimetres, for example 158.');
      return;
    }
    setError('');
    setDraft(d => ({ ...d, layout: scaleLayout(d.layout, width / d.layout.chequeWidth) }));
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
            <span>PDF, JPG or PNG. A full A4 scan or a cropped cheque both work. For exact sizes, scan at 300 DPI.</span>
          </div>
        )}
        {busy && <div className="busy">{busy}</div>}
        {error && <p className="error">{error}</p>}

        {detection && (
          <div className="detect-summary">
            <span className="chip ok">Size {draft.layout.chequeWidth.toFixed(1)} × {draft.layout.chequeHeight.toFixed(1)} mm{detection.sizeKnown ? '' : ' (estimated)'}</span>
            {detection.croppedUpload ? <span className="chip">Cropped upload</span> : <span className="chip">Found cheque on page</span>}
            {detection.transform.flip && <span className="chip">Turned the right way up</span>}
            {Math.abs(detection.transform.skewDeg) >= 0.1 && <span className="chip">Straightened {Math.abs(detection.transform.skewDeg).toFixed(1)}°</span>}
            {detection.found.map(f => <span key={f} className="chip ok">✓ {FIELD_NAMES[f] ?? f}</span>)}
            {detection.guessed.map(f => <span key={f} className="chip warn">? {FIELD_NAMES[f] ?? f} — please check</span>)}
          </div>
        )}
        {detection && !detection.sizeKnown && (
          <div className="width-prompt">
            <span>This file has no scan resolution. Measure the cheque with a ruler and enter its width:</span>
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

          <h3>Selected field</h3>
          {!field && <p className="hint">Click a box on the cheque to adjust it.</p>}
          {field && (
            <>
              <strong>{field.label}</strong>
              <label>Top (mm)<input type="number" step="0.1" value={field.box.y} onChange={e => setBox('y', Number(e.target.value))} /></label>
              <div className="row">
                <label>Line starts at (mm)<input type="number" step="0.1" value={field.box.x} onChange={e => setBox('x', Number(e.target.value))} /></label>
                <label>Line ends at (mm)<input type="number" step="0.1" value={Math.round((field.box.x + field.box.width) * 10) / 10} onChange={e => setBox('width', Number(e.target.value) - field.box.x)} /></label>
              </div>
              <p className="hint">Text wraps to the next line at "Line ends at". Set it to where the printed line ends on the cheque.</p>
              <div className="row">
                <label>Width (mm)<input type="number" step="0.1" value={field.box.width} onChange={e => setBox('width', Number(e.target.value))} /></label>
                <label>Height (mm)<input type="number" step="0.1" value={field.box.height} onChange={e => setBox('height', Number(e.target.value))} /></label>
              </div>
              <p className="hint">Text size and font are set once for all cheques in Settings.</p>
            </>
          )}

          <h3>Layout options</h3>
          <button onClick={() => { setSelected(null); setLayout(toggleDateMode(draft.layout)); }}>
            {draft.layout.date.mode === 'line' ? 'Date has 8 digit boxes' : 'Date is written on a line'}
          </button>
        </aside>
      )}
    </section>
  );
}
