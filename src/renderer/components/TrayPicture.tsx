import { useRef, type PointerEvent } from 'react';
import { alignTrayView, footprint, leafTransform, sheetFor, TRAY_KINDS, type TrayKind, type TrayView } from '../../shared/print';
import type { ChequeLayout } from '../../shared/types';

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

const CAPTIONS: Record<TrayKind, string> = {
  rear: 'Back tray, seen from the front of the printer. The cheque faces you.',
  front: 'Front drawer, seen from above. The printed side faces down, so the picture shows it as if the paper were glass.',
  manual: 'Manual feed slot, seen from above. The printed side faces up.',
};

/**
 * The paper tray as you see it standing in front of the printer, with a sheet in it.
 * The user slides the cheque sideways (or lines it up with a guide) until the picture matches how it really sits.
 * The cheque is always pushed fully in; small errors up or down are fixed after the test print.
 */
export function TrayPicture({ layout, image, tray, view, onChange, scale = 1.25 }: Props) {
  const drag = useRef<{ x: number; u: number } | null>(null);
  const [footW, footH] = footprint(layout, view.turn);
  const sheet = sheetFor(layout, view.turn);
  const px = (mm: number) => mm * scale;
  const clampU = (u: number) => Math.min(Math.max(snap(u), 0), Math.max(0, sheet.width - footW));
  const mirrored = TRAY_KINDS[tray].mirrored;
  const inAtBottom = TRAY_KINDS[tray].flipY;

  const down = (e: PointerEvent) => {
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
    if (d) onChange({ ...view, u: clampU(d.u + (e.clientX - d.x) / scale) });
  };
  const align = (side: 'left' | 'centre' | 'right') => onChange(alignTrayView(layout, tray, view, side));

  return (
    <div className={`tray tray-${tray}`}>
      {!inAtBottom && <div className="tray-arrow">▲ goes into the printer ▲</div>}
      <div className="tray-sheet" style={{ width: px(sheet.width), height: px(sheet.height) }}>
        <div
          className="tray-cheque"
          style={{ left: px(view.u), top: px(view.v), width: px(footW), height: px(footH), transform: mirrored ? 'scaleX(-1)' : undefined }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          title="Slide the cheque sideways to where it sits in the tray"
        >
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
        <span className={`tray-edge tray-edge-${inAtBottom ? 'bottom' : 'top'}`} />
      </div>
      {inAtBottom && <div className="tray-arrow">▼ goes into the printer ▼</div>}
      <div className="tray-align" role="group" aria-label="Line the cheque up with a guide">
        <button type="button" onClick={() => align('left')}>⇤ Left guide</button>
        <button type="button" onClick={() => align('centre')}>Centre</button>
        <button type="button" onClick={() => align('right')}>Right guide ⇥</button>
      </div>
      <p className="hint tray-caption">
        {CAPTIONS[tray]}
        {sheet.name !== 'A4' && ` This cheque is wider than A4, so it prints on a ${sheet.name === 'Custom' ? 'page of its own size' : sheet.name} page.`}
      </p>
    </div>
  );
}
