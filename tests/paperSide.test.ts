import { describe, expect, test } from 'vitest';
import { defaultTrayView, footprint, pageToTray, trayToPage } from '../src/shared/print';
import { guessPaperSide, paperSide, placementForPrinter, sideShiftX, viewOnSide, withPaperSide } from '../src/shared/printerCalibration';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { lineDateLayout } from './fixtures';

const rak = { ...lineDateLayout(), chequeWidth: 205.74, chequeHeight: 87.21 };

describe('where a cheque sits in the tray', () => {
  test('guesses the side from the printer model', () => {
    expect(guessPaperSide('HP Smart Tank 580-590 series', 'rear').side).toBe('right');
    expect(guessPaperSide('EPSON L3250 Series', 'rear').side).toBe('centre');
    expect(guessPaperSide('HP LaserJet Pro M404', 'front').side).toBe('centre');
    expect(guessPaperSide('Canon PIXMA MG2540S', 'rear').side).toBe('right');
    expect(guessPaperSide('Some Printer', 'rear')).toEqual({ side: 'centre', reason: null });
  });

  test('the user choice wins over the guess, per printer and tray', () => {
    const hp = { ...DEFAULT_SETTINGS, printerName: 'HP Smart Tank 580-590 series' };
    expect(paperSide(hp, 'rear')).toBe('right');
    const changed = withPaperSide(hp, 'rear', 'centre');
    expect(paperSide(changed, 'rear')).toBe('centre');
    expect(paperSide({ ...changed, printerName: 'EPSON L3250 Series' }, 'rear')).toBe('centre');
  });

  test('HP back tray, vertical: the cheque rests on the page left edge (the tray right side seen from the front)', () => {
    const centred = trayToPage(rak, 'rear', defaultTrayView(rak, 'rear', 90));
    expect(centred).toEqual({ rotation: 270, x: 61.4, y: 0 });
    const hp = { ...DEFAULT_SETTINGS, printerName: 'HP Smart Tank 581' };
    expect(placementForPrinter(rak, centred, 'rear', hp)).toEqual({ rotation: 270, x: 0, y: 0 });
    // The picture shows it against the right side.
    const view = viewOnSide(rak, 'rear', pageToTray(rak, 'rear', centred), 'right');
    expect(view.u).toBeCloseTo(210 - footprint(rak, 90)[0], 5);
  });

  test('HP back tray, horizontal: a 205.7 mm cheque moves only the little room there is', () => {
    const centred = trayToPage(rak, 'rear', defaultTrayView(rak, 'rear', 180));
    expect(sideShiftX(rak, 'rear', centred, 'right')).toBeCloseTo(-(210 - 205.74) / 2, 1);
  });

  test('the side is applied before the fold calibration', () => {
    const settings = { ...DEFAULT_SETTINGS, printerName: 'HP Smart Tank 581', printerOffsets: { 'HP Smart Tank 581': { rear: { x: 2, y: -1.5 } } } };
    expect(placementForPrinter(rak, { rotation: 270, x: 61.4, y: 0 }, 'rear', settings)).toEqual({ rotation: 270, x: -2, y: 1.5 });
  });

  test('Epson centres: nothing moves', () => {
    const epson = { ...DEFAULT_SETTINGS, printerName: 'EPSON L3250 Series' };
    expect(placementForPrinter(rak, { rotation: 270, x: 61.4, y: 0 }, 'rear', epson)).toEqual({ rotation: 270, x: 61.4, y: 0 });
  });

  test('a position the user placed against a side on purpose is not moved again', () => {
    expect(sideShiftX(rak, 'rear', { rotation: 270, x: 0 }, 'right')).toBe(0);
  });

  test('manual slot (printed side up, not turned round): right side is the page right', () => {
    const p = trayToPage(rak, 'manual', defaultTrayView(rak, 'manual', 270));
    expect(sideShiftX(rak, 'manual', p, 'right')).toBeGreaterThan(0);
  });
});

