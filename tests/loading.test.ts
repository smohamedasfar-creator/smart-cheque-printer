import { describe, expect, test } from 'vitest';
import { feedNotes, guessTray, guideSide, loadingSteps } from '../src/shared/loading';
import { alignTrayView, defaultTrayView, TRAY_KINDS, trayToPage, type TrayKind } from '../src/shared/print';
import { blankLayout } from '../src/shared/layoutDefaults';
import type { FeedRotation } from '../src/shared/types';

const rak = blankLayout(205.74, 87.21);
const fab = blankLayout(157.65, 79.93);

function placed(tray: TrayKind, rotation: FeedRotation, side: 'left' | 'centre' | 'right', layout = rak) {
  const view = alignTrayView(layout, tray, defaultTrayView(layout, tray, TRAY_KINDS[tray].turnFor(rotation)), side);
  return { view, placement: trayToPage(layout, tray, view) };
}

describe('guessTray', () => {
  test.each([
    ['EPSON L3250 Series', 'rear'],
    ['Epson ET-2850', 'rear'],
    ['Canon G3010 series', 'rear'],
    ['HP Smart Tank 580-590 series', 'rear'],
    ['HP LaserJet Pro M404dn', 'manual'],
    ['Brother HL-L2350DW series', 'manual'],
    ['Brother DCP-T420W', 'manual'],
    ['Canon LBP6030', 'manual'],
    ['Kyocera ECOSYS P2040dn', 'manual'],
  ])('%s usually takes cheques in the %s tray', (name, tray) => {
    expect(guessTray(name)?.tray).toBe(tray);
  });

  test('makes no guess for unknown or virtual printers', () => {
    expect(guessTray('Microsoft Print to PDF')).toBeNull();
    expect(guessTray('')).toBeNull();
    expect(guessTray('Office printer 2')).toBeNull();
  });
});

describe('guideSide', () => {
  test('tells which side the cheque touches, so the guide closes from the other side', () => {
    for (const tray of ['rear', 'front', 'manual'] as TrayKind[]) {
      expect(guideSide(rak, placed(tray, 270, 'left').view)).toBe('left');
      expect(guideSide(rak, placed(tray, 270, 'right').view)).toBe('right');
      expect(guideSide(rak, placed(tray, 270, 'centre').view)).toBe('middle');
    }
  });
});

describe('loadingSteps', () => {
  test('back tray: open the guide, hold printed side facing you, stand it against the side, close the guide', () => {
    const steps = loadingSteps(rak, 'rear', placed('rear', 270, 'right').view, 270).join(' ');
    expect(steps).toMatch(/guide/i);
    expect(steps).toMatch(/printed side facing you/i);
    expect(steps).toMatch(/date end down/i);
    expect(steps).toMatch(/against the right side/i);
    expect(steps).toMatch(/touches the cheque/i);
  });

  test('front drawer: face up with the chosen end towards the printer, then turned over sideways', () => {
    const steps = loadingSteps(fab, 'front', placed('front', 0, 'centre', fab).view, 0).join(' ');
    expect(steps).toMatch(/printed side up, with the top edge towards the printer/i);
    expect(steps).toMatch(/turn it over sideways/i);
    expect(steps).toMatch(/printed side faces down/i);
    expect(steps).toMatch(/top edge towards the printer/i);
    expect(steps).toMatch(/both guides/i);
    expect(steps).toMatch(/drawer/i);
  });

  test('manual slot: printed side up, push until the printer takes it', () => {
    const steps = loadingSteps(fab, 'manual', placed('manual', 90, 'left', fab).view, 90).join(' ');
    expect(steps).toMatch(/printed side up/i);
    expect(steps).toMatch(/logo end towards the printer/i);
    expect(steps).toMatch(/takes hold/i);
  });

  test('every tray, direction and side gets complete steps that always mention the guide', () => {
    for (const tray of ['rear', 'front', 'manual'] as TrayKind[]) {
      for (const r of [0, 90, 180, 270] as FeedRotation[]) {
        for (const side of ['left', 'centre', 'right'] as const) {
          const steps = loadingSteps(rak, tray, placed(tray, r, side).view, r);
          expect(steps.length).toBeGreaterThanOrEqual(4);
          expect(steps.some(s => /guide/i.test(s))).toBe(true);
          expect(steps.every(s => s.trim().endsWith('.'))).toBe(true);
        }
      }
    }
  });
});

describe('feedNotes', () => {
  test('warns that a cheque fed sideways is short in the feed direction and may jam', () => {
    expect(feedNotes(fab, 0).join(' ')).toMatch(/jam/i);
    expect(feedNotes(fab, 180).join(' ')).toMatch(/date end first/i);
  });

  test('no jam note when the cheque is fed lengthways', () => {
    expect(feedNotes(fab, 270)).toEqual([]);
    expect(feedNotes(rak, 90)).toEqual([]);
  });
});
