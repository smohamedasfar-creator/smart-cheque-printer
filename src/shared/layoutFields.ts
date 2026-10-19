import type { ChequeLayout, FieldBox } from './types';

export type FieldKey = 'payee' | 'payee2' | 'words1' | 'words2' | 'amount' | 'date' | 'bearer' | 'acPayee' | `digit${number}`;

export interface EditableField {
  key: FieldKey;
  label: string;
  box: FieldBox;
}

const DIGIT_LABELS = ['Day 1', 'Day 2', 'Month 1', 'Month 2', 'Year 1', 'Year 2', 'Year 3', 'Year 4'];

/** Every field the user can move or resize, in display order. */
export function editableFields(layout: ChequeLayout): EditableField[] {
  const fields: EditableField[] = [];
  if (layout.date.mode === 'line') fields.push({ key: 'date', label: 'Date', box: layout.date.box });
  else layout.date.boxes.forEach((box, i) => fields.push({ key: `digit${i}`, label: `Date: ${DIGIT_LABELS[i]}`, box }));
  fields.push({ key: 'payee', label: 'Payee', box: layout.payee });
  fields.push(
    { key: 'words1', label: 'Amount in words (line 1)', box: layout.words1 },
    { key: 'words2', label: 'Amount in words (line 2)', box: layout.words2 },
    { key: 'amount', label: 'Amount', box: layout.amount },
    { key: 'bearer', label: '"Or bearer" strike', box: layout.bearerStrike },
    { key: 'acPayee', label: 'A/C Payee crossing', box: layout.acPayee },
  );
  return fields;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Returns a new layout with one field replaced. Moving the crossing text moves its lines with it. */
export function updateField(layout: ChequeLayout, key: FieldKey, next: FieldBox): ChequeLayout {
  const box = { ...next, x: round(next.x), y: round(next.y), width: Math.max(1, round(next.width)), height: Math.max(1, round(next.height)) };
  switch (key) {
    case 'payee': return { ...layout, payee: box };
    case 'payee2': return { ...layout, payee2: box };
    case 'words1': return { ...layout, words1: box };
    case 'words2': return { ...layout, words2: box };
    case 'amount': return { ...layout, amount: box };
    case 'bearer': return { ...layout, bearerStrike: { ...box, text: layout.bearerStrike.text } };
    case 'date': return layout.date.mode === 'line' ? { ...layout, date: { mode: 'line', box } } : layout;
    case 'acPayee': {
      const dx = box.x - layout.acPayee.x;
      const dy = box.y - layout.acPayee.y;
      return {
        ...layout,
        acPayee: box,
        crossingLines: layout.crossingLines.map(l => ({ x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy })),
      };
    }
    default: {
      const index = Number(key.slice('digit'.length));
      if (layout.date.mode !== 'digits' || !(index in layout.date.boxes)) return layout;
      const boxes = layout.date.boxes.map((b, i) => (i === index ? box : b));
      return { ...layout, date: { mode: 'digits', boxes } };
    }
  }
}

/** Switches between a written date line and eight digit boxes covering the same area. */
export function toggleDateMode(layout: ChequeLayout): ChequeLayout {
  if (layout.date.mode === 'line') {
    const b = layout.date.box;
    const cell = b.width / 8;
    const boxes = Array.from({ length: 8 }, (_, i) => ({ x: round(b.x + i * cell), y: b.y, width: round(cell), height: b.height, fontPt: b.fontPt, align: 'center' as const }));
    return { ...layout, date: { mode: 'digits', boxes } };
  }
  const boxes = layout.date.boxes;
  const x = Math.min(...boxes.map(b => b.x));
  const right = Math.max(...boxes.map(b => b.x + b.width));
  return { ...layout, date: { mode: 'line', box: { x, y: boxes[0].y, width: round(right - x), height: boxes[0].height, fontPt: boxes[0].fontPt } } };
}

/** Moves the whole date (line or every digit box) by an offset. */
export function moveDate(layout: ChequeLayout, dx: number, dy: number): ChequeLayout {
  if (layout.date.mode === 'line') return updateField(layout, 'date', { ...layout.date.box, x: layout.date.box.x + dx, y: layout.date.box.y + dy });
  return { ...layout, date: { mode: 'digits', boxes: layout.date.boxes.map(b => ({ ...b, x: round(b.x + dx), y: round(b.y + dy) })) } };
}
