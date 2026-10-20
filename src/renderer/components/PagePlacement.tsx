import { useRef, type PointerEvent } from 'react';
import { A4_PAGE, footprint } from '../../shared/print';
import type { ChequeLayout, FeedRotation } from '../../shared/types';

interface Props {
  layout: ChequeLayout;
  image: string | null;
  rotation: FeedRotation;
  x: number;
  y: number;
  /** Called with the leaf's new top-left on the page, in mm. */
  onMove: (x: number, y: number) => void;
  /** Screen pixels per millimetre. */
  scale?: number;
}

const STEP_MM = 0.5;
const snap = (v: number) => Math.round(v / STEP_MM) * STEP_MM;

/** CSS transform (in px) that turns a cheque-sized box into its footprint, matching the print page. */
function leafTransform(rotation: FeedRotation, w: number, h: number): string {
  switch (rotation) {
    case 90: return `translate(${h}px, 0) rotate(90deg)`;
    case 180: return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270: return `translate(0, ${w}px) rotate(-90deg)`;
    default: return 'none';
  }
}

/** An A4 page as the printer sees it, with the cheque leaf turned and placed where it sits in the tray. */
export function PagePlacement({ layout, image, rotation, x, y, onMove, scale = 1.6 }: Props) {
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const [footW, footH] = footprint(layout, rotation);
  const px = (mm: number) => mm * scale;
  const clampX = (v: number) => Math.min(Math.max(snap(v), -5), A4_PAGE.width - footW + 5);
  const clampY = (v: number) => Math.min(Math.max(snap(v), -5), A4_PAGE.height - footH);

  const down = (e: PointerEvent) => {
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no pointer to capture
    }
    drag.current = { startX: e.clientX, startY: e.clientY, x, y };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onMove(clampX(d.x + (e.clientX - d.startX) / scale), clampY(d.y + (e.clientY - d.startY) / scale));
  };

  return (
    <div className="a4-page" style={{ width: px(A4_PAGE.width), height: px(A4_PAGE.height) }}>
      <span className="a4-feed">▼ goes into the printer first</span>
      <div
        className="a4-leaf"
        style={{ left: px(x), top: px(y), width: px(footW), height: px(footH) }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        title="Drag to where the cheque sits in the tray"
      >
        <div
          className="a4-leaf-image"
          style={{
            width: px(layout.chequeWidth),
            height: px(layout.chequeHeight),
            backgroundImage: image ? `url(${image})` : undefined,
            transform: leafTransform(rotation, px(layout.chequeWidth), px(layout.chequeHeight)),
          }}
        />
      </div>
      <span className="a4-label">A4 page as the printer sees it · leaf at {x.toFixed(1)} mm from left, {y.toFixed(1)} mm from top</span>
    </div>
  );
}
