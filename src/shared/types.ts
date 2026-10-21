// Shared domain types. All positions and sizes are millimetres from the cheque's top-left corner.

export type CrossingOption =
  | 'ac-payee-bearer'
  | 'ac-payee-not-negotiable-bearer'
  | 'ac-payee'
  | 'cross-only'
  | 'none';

export const CROSSING_LABELS: Record<CrossingOption, string> = {
  'ac-payee-bearer': 'Cross A/C Payee + Strike "Or Bearer"',
  'ac-payee-not-negotiable-bearer': 'Cross A/C Payee + Not Negotiable + Strike "Or Bearer"',
  'ac-payee': 'Cross A/C Payee',
  'cross-only': 'Cross Only',
  none: 'No Crossing',
};

export type HAlign = 'left' | 'center' | 'right';

export interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
  fontPt: number;
  align?: HAlign;
  rotation?: number;
}

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type DateField =
  | { mode: 'line'; box: FieldBox }
  /** Eight boxes in DDMMYYYY order. */
  | { mode: 'digits'; boxes: FieldBox[] };

/** Where each item prints on one cheque design, in millimetres from the cheque's top-left corner. */
export interface ChequeLayout {
  chequeWidth: number;
  chequeHeight: number;
  payee: FieldBox;
  /** No longer printed (payee names shrink to fit one line); kept so older saved layouts still load. */
  payee2: FieldBox | null;
  amount: FieldBox;
  words1: FieldBox;
  words2: FieldBox;
  date: DateField;
  acPayee: FieldBox;
  bearerStrike: FieldBox & { text: string };
  crossingLines: LineSegment[];
}

export interface ChequeTemplate {
  id: number;
  name: string;
  layout: ChequeLayout;
  /** JPEG data URL of the blank leaf, shown behind the preview. Never printed. */
  image: string | null;
  createdAt: string;
}

export type NewTemplate = Omit<ChequeTemplate, 'id' | 'createdAt'>;

export interface ChequeData {
  /** ISO yyyy-mm-dd */
  date: string;
  payee: string;
  amountFils: number;
  crossing: CrossingOption;
  /** Index of the first amount-in-words word to print on line 2; null or omitted = automatic. */
  wordsBreakAt?: number | null;
}

export type DateFormat = 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'DD.MM.YYYY' | 'DD MMM YYYY' | 'DD/MM/YY';

export type FeedRotation = 0 | 90 | 180 | 270;

export type WordsStyle = 'uk' | 'us';
export type FractionFormat = 'words' | 'numeric';

export interface PrintSettings {
  offsetX: number;
  offsetY: number;
  capitals: boolean;
  wordsStyle: WordsStyle;
  /** "Twenty-Three" (true) or "Twenty Three" (false). */
  hyphenate: boolean;
  wordsPrefix: string;
  wordsSuffix: string;
  minorUnit: string;
  fractionFormat: FractionFormat;
  hideZeroFraction: boolean;
  amountPrefix: string;
  amountSuffix: string;
  /** Text size in points for payee, amount, amount in words and a written date. */
  textSize: number;
  fontFamily: string;
  dateFormat: DateFormat;
  /** cheque: page is exactly the cheque size. a4-*: cheque is fed into an A4 page at the top edge. */
  paper: 'cheque' | 'a4-portrait' | 'a4-landscape';
  /** The tray guide the cheque is pushed against. */
  feedAlign: 'left' | 'center' | 'right';
  /** Ruler reading (mm from the page's left) of that guide edge, from calibration. Null = the page edge (or centre). */
  feedEdgeMm: number | null;
  /** How the cheque goes into the printer: 0 = long edge first; 90 / 270 = short edge first (text turned clockwise / anti-clockwise); 180 = upside down. */
  feedRotation: FeedRotation;
  printerName: string;
  /** Set once the user has measured where the printer places the cheque with the ruler page. */
  calibrated: boolean;
}

export const DEFAULT_SETTINGS: PrintSettings = {
  offsetX: 0,
  offsetY: 0,
  capitals: false,
  wordsStyle: 'uk',
  hyphenate: false,
  wordsPrefix: 'Dirhams',
  wordsSuffix: 'Only',
  minorUnit: 'Fils',
  fractionFormat: 'words',
  hideZeroFraction: false,
  amountPrefix: '',
  amountSuffix: '',
  textSize: 12,
  fontFamily: 'Arial',
  dateFormat: 'DD/MM/YYYY',
  // Every printer driver supports A4; many reject a custom cheque-sized page and silently fall back to A4.
  paper: 'a4-portrait',
  feedAlign: 'center',
  feedEdgeMm: null,
  feedRotation: 0,
  printerName: '',
  calibrated: false,
};

export type TextRole = 'payee' | 'amount' | 'words' | 'date' | 'ac-payee' | 'bearer';

export interface TextItem {
  kind: 'text';
  role: TextRole;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontPt: number;
  align: HAlign;
  rotation: number;
}

export interface LineItem extends LineSegment {
  kind: 'line';
}

export type RenderItem = TextItem | LineItem;

/** Returns the rendered width in millimetres of text at the given point size. */
export type MeasureText = (text: string, fontPt: number) => number;

export interface Account {
  id: number;
  name: string;
  accountNo: string;
  templateId: number | null;
  currency: string;
  lastChequeNo: string;
  offsetX: number;
  offsetY: number;
  /** How this cheque book's leaves go into the printer; null = the Settings default. */
  feedRotation: FeedRotation | null;
  /** Top-left of the leaf on the A4 page in mm, as placed in the page preview; null = the printer calibration. */
  pageX: number | null;
  pageY: number | null;
  /** Saved ways of loading this cheque book (tray, direction, position). The active one is copied to feedRotation/pageX/pageY. */
  positions: PrintPosition[];
}

/** One saved way of loading a cheque book into a printer, e.g. "Rear tray · date end first". */
export interface PrintPosition {
  name: string;
  /** Back tray (paper stands up, printed side facing you), front drawer (lies flat, printed side down) or manual feed slot (lies flat, printed side up). */
  tray?: 'rear' | 'front' | 'manual';
  /** Set when a scanned test print confirmed where the cheque sits in the printer. */
  calibrated?: boolean;
  rotation: FeedRotation;
  /** Top-left of the leaf's footprint on the A4 page, in mm. */
  x: number;
  y: number;
}

/** Where and how a cheque leaf sits on the printed page, overriding the Settings defaults. */
export interface PagePlacement {
  rotation: FeedRotation | null;
  x: number | null;
  y: number | null;
}

export interface ChequeRecord {
  id: number;
  accountId: number;
  chequeNo: string;
  date: string;
  payee: string;
  amountFils: number;
  crossing: CrossingOption;
  remark: string;
  status: 'printed' | 'void' | 'cleared';
  createdAt: string;
}

export type NewAccount = Omit<Account, 'id'>;
export type NewCheque = Omit<ChequeRecord, 'id' | 'createdAt' | 'status'>;
