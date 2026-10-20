import { useEffect, useState } from 'react';

/**
 * Screen pixels per millimetre that fit a cheque of `widthMm` into the element, never above `max`.
 * Attach `ref` to the element whose width the cheque should fill.
 */
export function useFitScale(widthMm: number, max: number): { ref: (el: HTMLElement | null) => void; scale: number } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [scale, setScale] = useState(max);
  useEffect(() => {
    if (!el) return;
    const fit = () => setScale(Math.min(max, Math.max(1, el.clientWidth / widthMm)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, widthMm, max]);
  return { ref: setEl, scale };
}
