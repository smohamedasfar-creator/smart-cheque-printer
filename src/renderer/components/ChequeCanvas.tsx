import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { editableFields, updateField, type FieldKey } from '../../shared/layoutFields';
import type { ChequeLayout, FieldBox, RenderItem } from '../../shared/types';

interface Props {
  layout: ChequeLayout;
  items: RenderItem[];
  fontFamily: string;
  /** Uploaded blank leaf, drawn behind the text. Never printed. */
  image?: string | null;
  /** Screen pixels per millimetre. */
  scale?: number;
  editable?: boolean;
  selected?: FieldKey | null;
  onSelect?: (key: FieldKey | null) => void;
  onChange?: (layout: ChequeLayout) => void;
  /** Shows graph paper over the cheque, counted in mm from its bottom-left corner. */
  graph?: boolean;
}

const PT_TO_MM = 0.3528;
const NUDGE_MM = 0.5;
const FINE_NUDGE_MM = 0.1;

interface Drag {
  key: FieldKey;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  box: FieldBox;
}

/** The cheque as it will print: the uploaded leaf with live text on top, optionally editable. */
export function ChequeCanvas({ layout, items, fontFamily, image, scale = 5, editable = false, selected = null, onSelect, onChange, graph = false }: Props) {
  const drag = useRef<Drag | null>(null);
  const mm = (v: number) => `${v * scale}px`;

  const begin = (e: PointerEvent, key: FieldKey, box: FieldBox, mode: Drag['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    // Keeps the drag going when the pointer leaves the box; not available for synthetic events.
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // no active pointer
    }
    drag.current = { key, mode, startX: e.clientX, startY: e.clientY, box };
    onSelect?.(key);
  };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !onChange) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const next = d.mode === 'move' ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy } : { ...d.box, width: d.box.width + dx, height: d.box.height + dy };
    onChange(updateField(layout, d.key, next));
  };

  const end = () => {
    drag.current = null;
  };

  const onKey = (e: KeyboardEvent) => {
    if (!editable || !selected || !onChange) return;
    const step = e.shiftKey ? FINE_NUDGE_MM : NUDGE_MM;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = delta[e.key];
    const field = editableFields(layout).find(f => f.key === selected);
    if (!d || !field) return;
    e.preventDefault();
    onChange(updateField(layout, selected, { ...field.box, x: field.box.x + d[0], y: field.box.y + d[1] }));
  };

  return (
    <div
      className={`cheque${image ? ' with-image' : ''}${editable ? ' editable' : ''}`}
      style={{ width: mm(layout.chequeWidth), height: mm(layout.chequeHeight), fontFamily, backgroundImage: image ? `url(${image})` : undefined }}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={onKey}
      onPointerDown={() => editable && onSelect?.(null)}
    >
      <svg className="cheque-svg" width={mm(layout.chequeWidth)} height={mm(layout.chequeHeight)} viewBox={`0 0 ${layout.chequeWidth} ${layout.chequeHeight}`}>
        {items.map((item, i) =>
          item.kind === 'line' ? <line key={i} x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="#0b2a6b" strokeWidth={0.3} /> : null,
        )}
      </svg>

      {graph && <GraphOverlay width={layout.chequeWidth} height={layout.chequeHeight} scale={scale} />}

      {items.map((item, i) =>
        item.kind === 'text' ? (
          <div
            key={i}
            className="cheque-text"
            style={{
              left: mm(item.x),
              top: mm(item.y),
              width: mm(item.width),
              height: mm(item.height),
              fontSize: `${item.fontPt * PT_TO_MM * scale}px`,
              justifyContent: item.rotation || item.align === 'center' ? 'center' : item.align === 'right' ? 'flex-end' : 'flex-start',
              transform: item.rotation ? `rotate(-${item.rotation}deg)` : undefined,
              flexDirection: item.rotation ? 'column' : 'row',
            }}
          >
            {item.text}
          </div>
        ) : null,
      )}

      {editable &&
        editableFields(layout).map(f => (
          <div
            key={f.key}
            className={`field-handle${selected === f.key ? ' selected' : ''}`}
            title={f.label}
            style={{ left: mm(f.box.x), top: mm(f.box.y), width: mm(f.box.width), height: mm(f.box.height) }}
            onPointerDown={e => begin(e, f.key, f.box, 'move')}
            onPointerMove={move}
            onPointerUp={end}
          >
            {selected === f.key && <span className="field-label">{f.label}</span>}
            <span className="resize" onPointerDown={e => begin(e, f.key, f.box, 'resize')} onPointerMove={move} onPointerUp={end} />
          </div>
        ))}
    </div>
  );
}

/** Graph paper over the cheque: (0, 0) is the bottom-left corner, numbers every 10 mm along the bottom (X) and left (Y). */
function GraphOverlay({ width, height, scale }: { width: number; height: number; scale: number }) {
  const weight = (v: number) => (v % 10 === 0 ? 'cm' : v % 5 === 0 ? 'half' : 'mm');
  const lines = [];
  for (let x = 0; x <= width; x++) lines.push(<line key={`x${x}`} className={weight(x)} x1={x} y1={0} x2={x} y2={height} />);
  for (let y = 0; y <= height; y++) lines.push(<line key={`y${y}`} className={weight(y)} x1={0} y1={height - y} x2={width} y2={height - y} />);
  const labels = [];
  for (let x = 10; x < width; x += 10) labels.push(<text key={`lx${x}`} className="gx" x={x + 0.4} y={height - 0.8}>{x}</text>);
  for (let y = 10; y < height; y += 10) labels.push(<text key={`ly${y}`} className="gy" x={0.6} y={height - y - 0.6}>{y}</text>);
  return (
    <svg className="graph-overlay" width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {lines}
      {labels}
      <text className="g0" x={0.6} y={height - 0.8}>0,0</text>
    </svg>
  );
}
