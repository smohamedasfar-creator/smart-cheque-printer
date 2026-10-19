import type { MeasureText } from '../shared/types';

const MM_PER_PX = 25.4 / 96;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;

/** Measures text with the real font so preview and print wrap identically. */
export function createMeasure(fontFamily: string): MeasureText {
  return (text, fontPt) => {
    ctx.font = `${fontPt}pt "${fontFamily}", Arial, sans-serif`;
    return ctx.measureText(text).width * MM_PER_PX;
  };
}
