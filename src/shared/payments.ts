// Payments: reminders before a cheque's date and how much has to be paid in a month.
import type { ChequeRecord } from './types';

/** Days before a cheque's date when the app reminds you, unless changed in Settings (any number of reminders). */
export const DEFAULT_REMINDER_DAYS = [15, 7] as const;

/** The furthest ahead a reminder can be set. */
export const MAX_REMINDER_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today as yyyy-mm-dd in local time. */
export const todayIso = (now = new Date()) => now.toLocaleDateString('en-CA');

/** Whole days from `today` to `date` (both yyyy-mm-dd): 0 the same day, negative when the date has passed. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** A cheque still to be paid: printed, not yet cleared and not void. */
export const isOpen = (c: ChequeRecord) => c.status === 'printed';

export interface Reminder {
  cheque: ChequeRecord;
  daysLeft: number;
  /** The reminder reached: the date has passed, it is today, or the largest number of days set that it is within. */
  level: 'overdue' | 'today' | number;
}

/**
 * Open cheques that need a reminder: within the largest number of reminder days, due today, or past their date and
 * not yet marked cleared. Soonest first.
 */
export function dueReminders(cheques: readonly ChequeRecord[], today: string, days: readonly number[] = DEFAULT_REMINDER_DAYS): Reminder[] {
  const steps = [...new Set(days.filter(d => Number.isFinite(d) && d > 0))].sort((a, b) => a - b);
  const window = steps.length ? steps[steps.length - 1] : 0;
  return cheques
    .filter(isOpen)
    .map(cheque => ({ cheque, daysLeft: daysUntil(cheque.date, today) }))
    .filter(r => r.daysLeft <= window)
    .map(r => ({ ...r, level: r.daysLeft < 0 ? ('overdue' as const) : r.daysLeft === 0 ? ('today' as const) : steps.find(d => r.daysLeft <= d)! }))
    .sort((a, b) => a.daysLeft - b.daysLeft || a.cheque.amountFils - b.cheque.amountFils);
}

/** A reminder in words, e.g. "in 3 days", "today", "2 days ago, not marked cleared". */
export function whenText(daysLeft: number): string {
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  if (daysLeft > 0) return `in ${daysLeft} days`;
  return `${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago, not marked cleared`;
}

export interface MonthReport {
  /** yyyy-mm */
  month: string;
  /** Cheques dated in the month, not void, by date. */
  cheques: ChequeRecord[];
  /** Total of the month's cheques (not void). */
  totalFils: number;
  /** Still to be paid: printed, not yet cleared. */
  toPayFils: number;
  /** Already cleared. */
  clearedFils: number;
  /** Totals per cheque book, largest first. */
  byAccount: Array<{ accountId: number; totalFils: number; toPayFils: number; count: number }>;
}

/** What is paid by cheque in a month (yyyy-mm), by the cheque's date. */
export function monthReport(cheques: readonly ChequeRecord[], month: string): MonthReport {
  const list = cheques.filter(c => c.status !== 'void' && c.date.startsWith(`${month}-`)).sort((a, b) => a.date.localeCompare(b.date) || a.chequeNo.localeCompare(b.chequeNo));
  const sum = (rows: readonly ChequeRecord[]) => rows.reduce((s, c) => s + c.amountFils, 0);
  const accounts = new Map<number, ChequeRecord[]>();
  for (const c of list) accounts.set(c.accountId, [...(accounts.get(c.accountId) ?? []), c]);
  return {
    month,
    cheques: list,
    totalFils: sum(list),
    toPayFils: sum(list.filter(isOpen)),
    clearedFils: sum(list.filter(c => c.status === 'cleared')),
    byAccount: [...accounts.entries()]
      .map(([accountId, rows]) => ({ accountId, totalFils: sum(rows), toPayFils: sum(rows.filter(isOpen)), count: rows.length }))
      .sort((a, b) => b.totalFils - a.totalFils),
  };
}

/** The month (yyyy-mm) `offset` months after `month`. */
export function addMonths(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "October 2026" for 2026-10. */
export const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * The reminders not yet shown as a notification, given the keys of those already shown. A cheque is notified again
 * when it reaches the next reminder (e.g. 15 days, then 7, then the day itself).
 */
export function newReminders(reminders: readonly Reminder[], shown: ReadonlySet<string>): Reminder[] {
  return reminders.filter(r => !shown.has(reminderKey(r)));
}

export const reminderKey = (r: Reminder) => `${r.cheque.id}:${r.level}`;
