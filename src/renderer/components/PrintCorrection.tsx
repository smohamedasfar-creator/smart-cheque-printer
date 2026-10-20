import { useRef, useState, type PointerEvent } from 'react';
import { correctPlacement, flipPlacement, type Placement } from '../../shared/print';
import type { ChequeLayout, RenderItem } from '../../shared/types';
import { ChequeCanvas } from './ChequeCanvas';

interface Props {
  layout: ChequeLayout;
  image: string | null;
  items: RenderItem[];
  fontFamily: string;
  placement: Placement;
  onApply: (next: Placement, what: string) => void;
  scale?: number;
}

const STEP = 0.5;

function shift(items: RenderItem[], dx: number, dy: number): RenderItem[] {
  return items.map(i => (i.kind === 'line' ? { ...i, x1: i.x1 + dx, x2: i.x2 + dx, y1: i.y1 + dy, y2: i.y2 + dy } : { ...i, x: i.x + dx, y: i.y + dy }));
}

/**
 * After a test print the user drags the printed text on the preview to where it really landed on the cheque.
 * The app turns that into a correction for this print position. No numbers to type.
 */
export function PrintCorrection({ layout, image, items, fontFamily, placement, onApply, scale = 3.2 }: Props) {
  const [d, setD] = useState({ x: 0, y: 0 });
  const drag = useRef<{ cx: number; cy: number; x: number; y: number } | null>(null);
  const round = (v: number) => Math.round(v / STEP) * STEP;

  const down = (e: PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no pointer to capture
    }
    drag.current = { cx: e.clientX, cy: e.clientY, x: d.x, y: d.y };
  };
  const move = (e: PointerEvent) => {
    const g = drag.current;
    if (g) setD({ x: round(g.x + (e.clientX - g.cx) / scale), y: round(g.y + (e.clientY - g.cy) / scale) });
  };
  const nudge = (x: number, y: number) => setD(v => ({ x: v.x + x, y: v.y + y }));
  const moved = d.x !== 0 || d.y !== 0;
  const describe = () =>
    [d.x && `${Math.abs(d.x)} mm ${d.x > 0 ? 'right' : 'left'}`, d.y && `${Math.abs(d.y)} mm ${d.y > 0 ? 'down' : 'up'}`].filter(Boolean).join(' and ');

  return (
    <div className="correction">
      <div className="correction-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} title="Drag the text to where it printed">
        <ChequeCanvas layout={layout} items={shift(items, d.x, d.y)} fontFamily={fontFamily} image={image} scale={scale} />
      </div>
      <div className="correction-tools">
        <div className="nudge">
          <span />
          <button type="button" onClick={() => nudge(0, -STEP)} aria-label="Move up">▲</button>
          <span />
          <button type="button" onClick={() => nudge(-STEP, 0)} aria-label="Move left">◀</button>
          <button type="button" onClick={() => setD({ x: 0, y: 0 })} aria-label="Reset">●</button>
          <button type="button" onClick={() => nudge(STEP, 0)} aria-label="Move right">▶</button>
          <span />
          <button type="button" onClick={() => nudge(0, STEP)} aria-label="Move down">▼</button>
          <span />
        </div>
        <div className="correction-actions">
          <button
            type="button"
            className="primary"
            disabled={!moved}
            onClick={() => {
              onApply(correctPlacement(layout, placement, d.x, d.y), `Corrected: the text printed ${describe()}; next print moves it back.`);
              setD({ x: 0, y: 0 });
            }}
          >
            Fix position
          </button>
          <button type="button" onClick={() => onApply(flipPlacement(placement), 'Turned round: the next print will be the right way up.')}>
            Text printed upside down
          </button>
          <span className="hint">{moved ? `Printed ${describe()} from the right place.` : 'Drag the text (or use the arrows) to where it printed on your test.'}</span>
        </div>
      </div>
    </div>
  );
}
