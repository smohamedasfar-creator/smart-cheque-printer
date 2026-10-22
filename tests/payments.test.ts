import { describe, expect, test } from 'vitest';
import { addMonths, daysUntil, dueReminders, monthName, monthReport, newReminders, reminderKey, whenText } from '../src/shared/payments';
import type { ChequeRecord } from '../src/shared/types';

let next = 1;
const cheque = (date: string, amount: number, status: ChequeRecord['status'] = 'printed', accountId = 1): ChequeRecord => ({
  id: next++, accountId, chequeNo: String(100 + next), date, payee: 'Payee', amountFils: amount * 100, crossing: 'ac-payee-bearer', remark: '', status, createdAt: '2026-10-01',
});

describe('reminders before a cheque date', () => {
  const today = '2026-10-22';
  const list = [
    cheque('2026-10-22', 500), // today
    cheque('2026-10-25', 1000), // 3 days: 7-day reminder
    cheque('2026-11-05', 2000), // 14 days: 15-day reminder
    cheque('2026-11-20', 3000), // 29 days: no reminder yet
    cheque('2026-10-20', 400), // 2 days ago, not cleared
    cheque('2026-10-24', 9000, 'cleared'), // cleared: no reminder
    cheque('2026-10-23', 8000, 'void'), // void: no reminder
  ];

  test('days between dates', () => {
    expect(daysUntil('2026-11-05', today)).toBe(14);
    expect(daysUntil('2026-10-20', today)).toBe(-2);
    expect(daysUntil('2027-03-01', '2027-02-27')).toBe(2);
  });

  test('15 and 7 days before, on the day, and past the date until cleared', () => {
    const r = dueReminders(list, today);
    expect(r.map(x => [x.cheque.amountFils / 100, x.daysLeft, x.level])).toEqual([
      [400, -2, 'overdue'],
      [500, 0, 'today'],
      [1000, 3, 7],
      [2000, 14, 15],
    ]);
  });

  test('the reminder days come from Settings', () => {
    expect(dueReminders(list, today, [30]).map(x => x.cheque.amountFils / 100)).toEqual([400, 500, 1000, 2000, 3000]);
    expect(dueReminders(list, today, [3]).map(x => x.level)).toEqual(['overdue', 'today', 3]);
  });

  test('each reminder is notified once, again at the next step', () => {
    const first = dueReminders(list, today);
    const shown = new Set(first.map(reminderKey));
    expect(newReminders(first, shown)).toEqual([]);
    // A week later the 14-day cheque reaches its 7-day reminder.
    const later = dueReminders(list, '2026-10-30').filter(r => r.cheque.amountFils === 200000);
    expect(later[0].level).toBe(7);
    expect(newReminders(later, shown)).toHaveLength(1);
  });

  test('in words', () => {
    expect([whenText(0), whenText(1), whenText(5), whenText(-1), whenText(-3)]).toEqual(['today', 'tomorrow', 'in 5 days', '1 day ago, not marked cleared', '3 days ago, not marked cleared']);
  });
});

describe('monthly payment report', () => {
  const list = [
    cheque('2026-10-05', 1000, 'cleared', 1),
    cheque('2026-10-28', 2500, 'printed', 1),
    cheque('2026-10-30', 700, 'printed', 2),
    cheque('2026-10-12', 999, 'void', 2),
    cheque('2026-11-02', 4000, 'printed', 1),
  ];

  test('how much to pay this month, what is cleared, per cheque book', () => {
    const r = monthReport(list, '2026-10');
    expect(r.cheques.map(c => c.date)).toEqual(['2026-10-05', '2026-10-28', '2026-10-30']);
    expect([r.totalFils, r.toPayFils, r.clearedFils].map(f => f / 100)).toEqual([4200, 3200, 1000]);
    expect(r.byAccount.map(a => [a.accountId, a.totalFils / 100, a.toPayFils / 100, a.count])).toEqual([[1, 3500, 2500, 2], [2, 700, 700, 1]]);
  });

  test('next months', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthReport(list, addMonths('2026-10', 1)).toPayFils / 100).toBe(4000);
    expect(monthName('2026-10')).toBe('October 2026');
  });
});
