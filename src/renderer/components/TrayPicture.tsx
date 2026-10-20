import { useRef, type PointerEvent } from 'react';
import { A4_PAGE, footprint, type TrayKind, type TrayView } from '../../shared/print';
import type { ChequeLayout, FeedRotation } from '../../shared/types';

interface Props {
  layout: ChequeLayout;
  image: string | null;
  tray: TrayKind;
  view: TrayView;
  onChange: (view: TrayView) => void;
  /** Screen pixels per millimetre. */
  scale?: number;
}

const snap = (v: number) => Math.round(v * 2) / 2;

function turnTransform(turn: FeedRotation, w: number, h: number): string {
  switch (turn) {
    case 90: return `translate(${h}px, 0) rotate(90deg)`;
    case 180: return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270: return `translate(0, ${w}px) rotate(-90deg)`;
    default: return 'none';
  }
}

/**
 * The paper tray as you see it standing in front of the printer, with an A4 sheet in it.
 * The user drags and turns the cheque until the picture matches how the cheque really sits.
 */
export function TrayPicture({ layout, image, tray, view, onChange, scale = 1.25 }: Props) {
  const drag = useRef<{ x: number; y: number; u: number; v: number } | null>(null);
  const [footW, footH] = footprint(layout, view.turn);
  const W = A4_PAGE.width;
  const H = A4_PAGE.height;
  const px = (mm: number) => mm * scale;
  const clampU = (u: number) => Math.min(Math.max(snap(u), 0), W - footW);
  const clampV = (v: number) => Math.min(Math.max(snap(v), 0), H - footH);

  const down = (e: PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no pointer to capture
    }
    drag.current = { x: e.clientX, y: e.clientY, u: view.u, v: view.v };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onChange({ ...view, u: clampU(d.u + (e.clientX - d.x) / scale), v: clampV(d.v + (e.clientY - d.y) / scale) });
  };

  const inEdge = tray === 'rear' ? 'bottom' : 'top';
  return (
    <div className={`tray tray-${tray}`}>
      {tray === 'front' && <div className="tray-arrow">▲ goes into the printer ▲</div>}
      <div className="tray-sheet" style={{ width: px(W), height: px(H) }}>
        <div
          className="tray-cheque"
          style={{ left: px(view.u), top: px(view.v), width: px(footW), height: px(footH), transform: tray === 'front' ? 'scaleX(-1)' : undefined }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          title="Drag the cheque to where it sits in the tray"
        >
          <div
            className="tray-cheque-image"
            style={{
              width: px(layout.chequeWidth),
              height: px(layout.chequeHeight),
              backgroundImage: image ? `url(${image})` : undefined,
              transform: turnTransform(view.turn, px(layout.chequeWidth), px(layout.chequeHeight)),
            }}
          >
            {!image && <span>CHEQUE · logo end ←</span>}
          </div>
        </div>
        <span className={`tray-edge tray-edge-${inEdge}`} />
      </div>
      {tray === 'rear' && <div className="tray-arrow">▼ goes into the printer ▼</div>}
      <p className="hint tray-caption">
        {tray === 'rear'
          ? 'Back tray, seen from the front of the printer. The cheque faces you.'
          : 'Front drawer, seen from above. The printed side faces down, so the picture shows it as if the paper were glass.'}
      </p>
    </div>
  );
}
