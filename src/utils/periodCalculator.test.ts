import { describe, expect, it } from 'vitest';
import {
  calculatePeriodWindow,
  formatCurrency,
  fromDateAndTimeInputs,
  fromDateTimeLocalValue,
  groupExpensesByDay,
  toDateInputValue,
  toDateTimeLocalValue,
  toTimeInputValue,
} from './periodCalculator';
import { UserSettings } from '../types/expense';

describe('Budget Period Calculator (periodCalculator.ts)', () => {
  describe('Daily cadence', () => {
    it('calculates midnight-to-midnight window when periodStartDay = 0', () => {
      const settings: UserSettings = {
        budget: 50,
        cadence: 'daily',
        periodStartDay: 0,
        currency: 'USD',
      };
      const now = new Date(2026, 9, 14, 10, 30, 0); // Oct 14, 2026 10:30 AM
      const window = calculatePeriodWindow(settings, now, 0);

      expect(window.start).toEqual(new Date(2026, 9, 14, 0, 0, 0, 0));
      expect(window.end).toEqual(new Date(2026, 9, 15, 0, 0, 0, 0));
      expect(window.isCurrent).toBe(true);
      expect(window.label).toContain('Oct 14');
    });

    it('anchors to yesterday when current time is before custom daily cutoff hour (e.g. 4 AM)', () => {
      const settings: UserSettings = {
        budget: 50,
        cadence: 'daily',
        periodStartDay: 4, // 4:00 AM cutoff
        currency: 'USD',
      };
      const now = new Date(2026, 9, 14, 2, 15, 0); // Oct 14, 2026 2:15 AM
      const window = calculatePeriodWindow(settings, now, 0);

      expect(window.start).toEqual(new Date(2026, 9, 13, 4, 0, 0, 0));
      expect(window.end).toEqual(new Date(2026, 9, 14, 4, 0, 0, 0));
    });
  });

  describe('Weekly cadence', () => {
    it('calculates Monday-to-Monday 7-day cycle when periodStartDay = 1', () => {
      const settings: UserSettings = {
        budget: 200,
        cadence: 'weekly',
        periodStartDay: 1, // Monday
        currency: 'USD',
      };
      // Oct 14, 2026 is a Wednesday
      const now = new Date(2026, 9, 14, 14, 0, 0);
      const window = calculatePeriodWindow(settings, now, 0);

      expect(window.start).toEqual(new Date(2026, 9, 12, 0, 0, 0, 0)); // Mon Oct 12
      expect(window.end).toEqual(new Date(2026, 9, 19, 0, 0, 0, 0)); // Mon Oct 19
      expect(window.label).toBe('Oct 12 – Oct 18');
    });

    it('calculates Sunday-to-Sunday 7-day cycle when periodStartDay = 0', () => {
      const settings: UserSettings = {
        budget: 200,
        cadence: 'weekly',
        periodStartDay: 0, // Sunday
        currency: 'USD',
      };
      const now = new Date(2026, 9, 14, 14, 0, 0); // Wed Oct 14, 2026
      const window = calculatePeriodWindow(settings, now, 0);

      expect(window.start).toEqual(new Date(2026, 9, 11, 0, 0, 0, 0)); // Sun Oct 11
      expect(window.end).toEqual(new Date(2026, 9, 18, 0, 0, 0, 0)); // Sun Oct 18
      expect(window.label).toBe('Oct 11 – Oct 17');
    });
  });

  describe('Monthly cadence', () => {
    it('calculates 1st-to-1st full calendar month when periodStartDay = 1', () => {
      const settings: UserSettings = {
        budget: 1500,
        cadence: 'monthly',
        periodStartDay: 1,
        currency: 'USD',
      };
      const now = new Date(2026, 9, 14, 10, 0, 0); // Oct 14, 2026
      const window = calculatePeriodWindow(settings, now, 0);

      expect(window.start).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
      expect(window.end).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0));
      expect(window.label).toBe('Oct 1 – Oct 31');
    });

    it('starts in previous month when today is before periodStartDay (e.g. 15th on Oct 14)', () => {
      const settings: UserSettings = {
        budget: 1500,
        cadence: 'monthly',
        periodStartDay: 15,
        currency: 'USD',
      };
      const now = new Date(2026, 9, 14, 10, 0, 0); // Oct 14, 2026 (before Oct 15)
      const window = calculatePeriodWindow(settings, now, 0);

      expect(window.start).toEqual(new Date(2026, 8, 15, 0, 0, 0, 0)); // Sep 15
      expect(window.end).toEqual(new Date(2026, 9, 15, 0, 0, 0, 0)); // Oct 15
      expect(window.label).toBe('Sep 15 – Oct 14');
    });

    it('clamps periodStartDay = 31 safely across February in non-leap and leap years', () => {
      const settings: UserSettings = {
        budget: 1000,
        cadence: 'monthly',
        periodStartDay: 31,
        currency: 'USD',
      };
      // Feb 10, 2026 (between Jan 31 and Feb 28)
      const nowNonLeap = new Date(2026, 1, 10, 12, 0, 0);
      const winNonLeap = calculatePeriodWindow(settings, nowNonLeap, 0);
      expect(winNonLeap.start).toEqual(new Date(2026, 0, 31, 0, 0, 0, 0)); // Jan 31
      expect(winNonLeap.end).toEqual(new Date(2026, 1, 28, 0, 0, 0, 0)); // Feb 28

      // Feb 10, 2028 (leap year: Feb has 29 days)
      const nowLeap = new Date(2028, 1, 10, 12, 0, 0);
      const winLeap = calculatePeriodWindow(settings, nowLeap, 0);
      expect(winLeap.start).toEqual(new Date(2028, 0, 31, 0, 0, 0, 0)); // Jan 31
      expect(winLeap.end).toEqual(new Date(2028, 1, 29, 0, 0, 0, 0)); // Feb 29
    });

    it('navigates backward cleanly with negative cycleOffset (-1, -2)', () => {
      const settings: UserSettings = {
        budget: 1500,
        cadence: 'monthly',
        periodStartDay: 1,
        currency: 'USD',
      };
      const now = new Date(2026, 9, 14, 10, 0, 0); // Oct 2026
      const prevCycle = calculatePeriodWindow(settings, now, -1);

      expect(prevCycle.start).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0)); // Sep 1
      expect(prevCycle.end).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0)); // Oct 1
      expect(prevCycle.isCurrent).toBe(false);
      expect(prevCycle.label).toBe('Sep 1 – Sep 30');
    });
  });

  describe('Formatting & grouping helpers', () => {
    it('formats USD and zero-decimal JPY currencies accurately', () => {
      expect(formatCurrency(150, 'USD')).toBe('$150.00');
      expect(formatCurrency(1250, 'JPY')).toBe('¥1,250');
    });

    it('groups expenses into Today and Yesterday with accurate subtotals', () => {
      const now = new Date(2026, 9, 14, 15, 0, 0);
      const expenses = [
        {
          id: '1',
          title: 'Coffee',
          amount: 5.5,
          timestamp: new Date(2026, 9, 14, 9, 0, 0).getTime(),
          createdAt: 1,
        },
        {
          id: '2',
          title: 'Lunch',
          amount: 14.25,
          timestamp: new Date(2026, 9, 14, 12, 30, 0).getTime(),
          createdAt: 2,
        },
        {
          id: '3',
          title: 'Groceries',
          amount: 42.1,
          timestamp: new Date(2026, 9, 13, 18, 0, 0).getTime(),
          createdAt: 3,
        },
      ];

      const groups = groupExpensesByDay(expenses, now);
      expect(groups).toHaveLength(2);
      expect(groups[0].label).toBe('Today');
      expect(groups[0].subtotal).toBe(19.75);
      expect(groups[0].items.map((i) => i.id)).toEqual(['2', '1']);
      expect(groups[1].label).toBe('Yesterday');
      expect(groups[1].subtotal).toBe(42.1);
    });

    it('round-trips datetime-local strings cleanly', () => {
      const sample = new Date(2026, 9, 14, 13, 45, 0, 0).getTime();
      const str = toDateTimeLocalValue(sample);
      expect(str).toBe('2026-10-14T13:45');
      expect(fromDateTimeLocalValue(str)).toBe(sample);
    });

    it('defaults whole-day manual dates to 12:00 PM when time is omitted and preserves explicit times', () => {
      const wholeDayMs = fromDateAndTimeInputs('2026-10-14', '');
      expect(wholeDayMs).toBe(new Date(2026, 9, 14, 12, 0, 0, 0).getTime());
      expect(toDateInputValue(wholeDayMs)).toBe('2026-10-14');

      const withTimeMs = fromDateAndTimeInputs('2026-10-14', '18:30');
      expect(withTimeMs).toBe(new Date(2026, 9, 14, 18, 30, 0, 0).getTime());
      expect(toTimeInputValue(withTimeMs)).toBe('18:30');
    });
  });
});
