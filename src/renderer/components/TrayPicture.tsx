import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { feedNotes, guideSide, loadingSteps } from '../../shared/loading';
import { alignTrayView, footprint, LEADING_EDGE, leafTransform, sheetFor, TRAY_KINDS, type TrayGeometry, type TrayView } from '../../shared/print';
import type { ChequeLayout, FeedRotation } from '../../shared/types';

interface Props {
  layout: ChequeLayout;
  image: string | null;
  /** The tray as this printer handles it (a front drawer may print on the side facing up). */
  tray: TrayGeometry;
  view: TrayView;
  onChange?: (view: TrayView) => void;
  /** Screen pixels per millimetre. */
  scale?: number;
  /** Lets the user slide the cheque and line it up with a guide. Off for the reminder on Write Cheque. */
  interactive?: boolean;
}

const snap = (v: number) => Math.round(v * 2) / 2;
const GUIDE_PX = 7;
const START_GAP_PX = 8;

const CAPTIONS: Record<TrayGeometry, string> = {
  rear: 'Back tray, seen from the front of the printer. The cheque faces you.',
  front: 'Front drawer, seen from above. The cheque lies printed side down, so you see its back.',
  manual: 'Manual feed slot, seen from above. The printed side faces up.',
  'front-up': 'Front drawer, seen from above. This printer prints on the side facing up, so the cheque lies printed side up.',
};

/**
 * The paper tray as you see it standing in front of the printer, with the cheque in it, and a short animation of
 * loading it: open the guide, turn the cheque, put it in, close the guide. The steps below play along with it.
 */
export function TrayPicture({ layout, image, tray, view, onChange, scale = 1.25, interactive = true }: Props) {
  const drag = useRef<{ x: number; u: number } | null>(null);
  const [run, setRun] = useState(0);
  const [footW, footH] = footprint(layout, view.turn);
  const sheet = sheetFor(layout, view.turn);
  const px = (mm: number) => mm * scale;
  const clampU = (u: number) => Math.min(Math.max(snap(u), 0), Math.max(0, sheet.width - footW));
  const model = TRAY_KINDS[tray];
  const inAtBottom = model.flipY;
  const rotation = (model.flipY ? (view.turn + 180) % 360 : view.turn) as FeedRotation;
  const side = guideSide(layout, view);
  const steps = loadingSteps(layout, tray, view, rotation);
  const notes = feedNotes(layout, rotation);

  const down = (e: PointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no pointer to capture
    }
    drag.current = { x: e.clientX, u: view.u };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (d && onChange) onChange({ ...view, u: clampU(d.u + (e.clientX - d.x) / scale) });
  };
  const align = (where: 'left' | 'centre' | 'right') => onChange?.(alignTrayView(layout, tray, view, where));

  // Where the animation starts and ends, as CSS variables, so it always matches the saved position.
  const motion = {
    // The cheque starts inside the picture, at the end away from the printer, so its turn is visible.
    '--from-y': `${inAtBottom ? START_GAP_PX - px(view.v) : px(sheet.height - footH - view.v) - START_GAP_PX}px`,
    '--turn-from': `${-view.turn}deg`,
  } as CSSProperties;
  // A guide closes from each side the cheque does not rest against.
  const guides: Array<{ from: number; to: number }> = [];
  if (side === 'right' || side === 'middle') guides.push({ from: 0, to: px(view.u) - GUIDE_PX });
  if (side === 'left' || side === 'middle') guides.push({ from: px(sheet.width) - GUIDE_PX, to: px(view.u + footW) });

  return (
    <div className={`tray tray-${tray}`}>
      {!inAtBottom && <div className="tray-arrow">▲ goes into the printer ▲</div>}
      <div className="tray-sheet tray-animate" key={`${run}-${tray}-${view.turn}`} style={{ width: px(sheet.width), height: px(sheet.height), ...motion }}>
        {guides.map((g, i) => (
          <span key={i} className="tray-guide" style={{ '--g-from': `${g.from}px`, '--g-to': `${g.to}px`, width: GUIDE_PX } as CSSProperties} aria-hidden="true" />
        ))}
        <div
          className={interactive ? 'tray-cheque' : 'tray-cheque still'}
          style={{ left: px(view.u), top: px(view.v), width: px(footW), height: px(footH) }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          title={interactive ? 'Slide the cheque sideways to where it sits in the tray' : undefined}
        >
          {/* Printed side down: the cheque is shown face up the right way round, then turned over to show its back. */}
          <div className={model.mirrored ? 'tray-cheque-turn turn-over' : 'tray-cheque-turn'}>
            <div className="tray-face tray-face-front">
              <div
                className="tray-cheque-image"
                style={{
                  width: px(layout.chequeWidth),
                  height: px(layout.chequeHeight),
                  backgroundImage: image ? `url(${image})` : undefined,
                  transform: leafTransform(view.turn, px(layout.chequeWidth), px(layout.chequeHeight), 'px'),
                }}
              >
                {!image && <span>CHEQUE · logo end ←</span>}
              </div>
            </div>
            {model.mirrored && (
              <div className="tray-face tray-face-back">
                <span className="tray-back-end">▲ {LEADING_EDGE[rotation].replace(/ goes in first$/, '')} towards the printer</span>
                <span>Back of the cheque · printed side down</span>
              </div>
            )}
          </div>
        </div>
        <span className={`tray-edge tray-edge-${inAtBottom ? 'bottom' : 'top'}`} />
      </div>
      {inAtBottom && <div className="tray-arrow">▼ goes into the printer ▼</div>}
      <div className="tray-align" role="group" aria-label="Line the cheque up with a guide">
        {interactive && (
          <>
            <button type="button" onClick={() => align('left')}>⇤ Left side</button>
            <button type="button" onClick={() => align('centre')}>Centre</button>
            <button type="button" onClick={() => align('right')}>Right side ⇥</button>
          </>
        )}
        <button type="button" className="tray-replay" onClick={() => setRun(r => r + 1)}>▶ Show me how</button>
      </div>
      <ol className="tray-steps" key={`steps-${run}`}>
        {steps.map((s, i) => <li key={i} style={{ animationDelay: `${i * 1.2}s` }}>{s}</li>)}
      </ol>
      {notes.map(n => <p key={n} className="warning tray-note">{n}</p>)}
      <p className="hint tray-caption">
        {CAPTIONS[tray]}
        {sheet.name !== 'A4' && ` This cheque is wider than A4, so it prints on a ${sheet.name === 'Custom' ? 'page of its own size' : sheet.name} page.`}
      </p>
    </div>
  );
}
