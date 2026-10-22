// How to put the cheque into the printer: the usual tray for a printer, plain-words steps and jam warnings.
import { footprint, LEADING_EDGE, sheetFor, type TrayKind, type TrayView } from './print';
import type { ChequeLayout, FeedRotation } from './types';

interface TrayRule {
  pattern: RegExp;
  tray: TrayKind;
  reason: string;
}

// Order matters: Brother inkjets (DCP-T, MFC-J) are checked before the general laser names.
const TRAY_RULES: TrayRule[] = [
  { pattern: /\b(dcp|mfc)-[tj]\d/i, tray: 'manual', reason: 'Brother ink printers take a single cheque best through the manual feed slot at the back' },
  { pattern: /laserjet|laser|\bhl-|\b(dcp|mfc)-l\d|\blbp|imageclass|i-sensys|kyocera|ecosys|ricoh|xerox|lexmark|pantum|samsung/i, tray: 'manual', reason: 'laser printers take small paper best through the manual feed or bypass slot' },
  { pattern: /epson|ecotank|\bet-\d|\bl\d{3,4}\b|canon g\d|\bg\d{4}\b|pixma|smart tank|ink ?tank|deskjet|ink advantage/i, tray: 'rear', reason: 'ink tank printers load single sheets in the back tray' },
];

/** The tray most printers of this kind use for a single cheque, or null when the name says nothing useful. */
export function guessTray(printerName: string): { tray: TrayKind; reason: string } | null {
  const rule = TRAY_RULES.find(r => r.pattern.test(printerName));
  return rule ? { tray: rule.tray, reason: rule.reason } : null;
}

/** Closer than this (mm) to a side of the tray counts as touching that side. */
const TOUCH_MM = 1;

/** Which side of the tray the cheque rests against, as seen on the tray picture. */
export function guideSide(layout: ChequeLayout, view: TrayView): 'left' | 'right' | 'middle' | 'full' {
  const room = sheetFor(layout, view.turn).width - footprint(layout, view.turn)[0];
  if (room <= TOUCH_MM) return 'full';
  if (view.u <= TOUCH_MM) return 'left';
  if (view.u >= room - TOUCH_MM) return 'right';
  return 'middle';
}

const endName = (rotation: FeedRotation) => LEADING_EDGE[rotation].replace(/ goes in first$/, '').toLowerCase();

/** Step-by-step instructions for loading this cheque the way the saved position expects. */
export function loadingSteps(layout: ChequeLayout, tray: TrayKind, view: TrayView, rotation: FeedRotation): string[] {
  const end = endName(rotation);
  const side = guideSide(layout, view);
  const where = { left: 'against the left side', right: 'against the right side', middle: 'in the middle', full: 'so it fills the tray from side to side' }[side];
  const guide =
    side === 'middle'
      ? 'Close both guides until they just touch the cheque. It must not be loose or bend the cheque.'
      : side === 'full'
        ? 'Check the guides touch the cheque on both sides without bending it.'
        : 'Slide the guide in until it just touches the cheque. It must not be loose or bend the cheque.';
  if (tray === 'rear') {
    return [
      'Slide the paper guide all the way open and take out any other paper.',
      `Hold the cheque printed side facing you, ${end} down.`,
      `Stand it in the back tray ${where}.`,
      guide,
      'Let it rest on the bottom of the tray. Do not push it in; the printer pulls it in.',
    ];
  }
  if (tray === 'front') {
    return [
      'Pull out the paper drawer, slide its guides fully open and take out any other paper.',
      `Hold the cheque printed side up, with the ${end} towards the printer.`,
      `Turn it over sideways, like turning a page, so the printed side faces down. The ${end} still points to the printer.`,
      `Lay it flat ${where}, pushed fully in.`,
      `${guide} Close the drawer gently.`,
    ];
  }
  return [
    'Open the manual feed slot and slide its guides fully open.',
    `Hold the cheque printed side up, with the ${end} towards the printer.`,
    `Lay it in the slot ${where}.`,
    guide,
    'Push it in gently until the printer takes hold of it.',
  ];
}

/** Shorter than this (mm) in the direction it feeds, a cheque may slip between the printer's rollers. */
export const SHORT_FEED_MM = 100;

/** Warnings about how the cheque feeds, e.g. paper that is short in the feed direction can jam. */
export function feedNotes(layout: ChequeLayout, rotation: FeedRotation): string[] {
  const feedLength = footprint(layout, rotation)[1];
  if (feedLength >= SHORT_FEED_MM) return [];
  return [
    `Fed this way the cheque is only ${Math.round(feedLength)} mm long in the direction it moves. Some printers jam on paper this short. If it jams, feed it date end first or logo end first instead.`,
  ];
}
