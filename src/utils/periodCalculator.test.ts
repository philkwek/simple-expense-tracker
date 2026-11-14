import { describe, expect, it } from 'vitest';
import {
  calculatePeriodWindow,
  computeDailyAllowances,
  formatCurrency,
  fromDateAndTimeInputs,
  fromDateTimeLocalValue,
  getCycleDayCount,
  getDailyAllowanceSummary,
  getExpenseQueryRange,
  groupExpensesByDay,
  ONE_OFF_OPEN_END_MS,
  toDateInputValue,
  toDateTimeLocalValue,
  toLocalDateKey,
  toTimeInputValue,
} from './periodCalculator';
import { ExpenseItem, PeriodConfig, UserSettings } from '../types/expense';

function makeExpense(amount: number, date: Date): ExpenseItem {
  return {
    id: `${date.getTime()}-${amount}`,
    budgetId: 'default',
    title: 'Sample',
    amount,
    timestamp: date.getTime(),
    createdAt: 1,
  };
}

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
          budgetId: 'default',
          title: 'Coffee',
          amount: 5.5,
          timestamp: new Date(2026, 9, 14, 9, 0, 0).getTime(),
          createdAt: 1,
        },
        {
          id: '2',
          budgetId: 'default',
          title: 'Lunch',
          amount: 14.25,
          timestamp: new Date(2026, 9, 14, 12, 30, 0).getTime(),
          createdAt: 2,
        },
        {
          id: '3',
          budgetId: 'default',
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

  describe('Rolling daily allowance', () => {
    const weeklySettings: UserSettings = {
      budget: 70,
      cadence: 'weekly',
      periodStartDay: 1, // Monday
      currency: 'USD',
    };
    const monthlySettings: UserSettings = {
      budget: 280,
      cadence: 'monthly',
      periodStartDay: 1,
      currency: 'USD',
    };

    describe('getCycleDayCount', () => {
      it('counts 7 calendar days for a weekly window', () => {
        const window = calculatePeriodWindow(
          weeklySettings,
          new Date(2026, 9, 14, 10, 0, 0),
          0,
        );
        expect(window.start).toEqual(new Date(2026, 9, 12, 0, 0, 0, 0)); // Mon Oct 12
        expect(getCycleDayCount(window)).toBe(7);
      });

      it('counts 28 or 29 days for February in non-leap and leap years', () => {
        const nonLeap = calculatePeriodWindow(
          monthlySettings,
          new Date(2026, 1, 10, 12, 0, 0),
          0,
        );
        expect(nonLeap.start).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
        expect(nonLeap.end).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
        expect(getCycleDayCount(nonLeap)).toBe(28);

        const leap = calculatePeriodWindow(
          monthlySettings,
          new Date(2028, 1, 10, 12, 0, 0),
          0,
        );
        expect(leap.start).toEqual(new Date(2028, 1, 1, 0, 0, 0, 0));
        expect(leap.end).toEqual(new Date(2028, 2, 1, 0, 0, 0, 0));
        expect(getCycleDayCount(leap)).toBe(29);
      });

      it('counts the clamped day span when periodStartDay = 31 lands in a 30-day month', () => {
        const clampedSettings: UserSettings = {
          ...monthlySettings,
          periodStartDay: 31,
        };
        // Apr 10, 2026 is before Apr 31 (clamped to Apr 30), so the active
        // cycle is Mar 31 -> Apr 30: 30 calendar days.
        const window = calculatePeriodWindow(
          clampedSettings,
          new Date(2026, 3, 10, 12, 0, 0),
          0,
        );
        expect(window.start).toEqual(new Date(2026, 2, 31, 0, 0, 0, 0)); // Mar 31
        expect(window.end).toEqual(new Date(2026, 3, 30, 0, 0, 0, 0)); // Apr 30
        expect(getCycleDayCount(window)).toBe(30);
      });

      it('counts 7 calendar days for a weekly window spanning a DST transition', () => {
        // US DST starts Sun Mar 8, 2026 and ends Sun Nov 1, 2026.
        const springForward = calculatePeriodWindow(
          weeklySettings,
          new Date(2026, 2, 4, 12, 0, 0), // Wed Mar 4
          0,
        );
        expect(springForward.start).toEqual(new Date(2026, 2, 2, 0, 0, 0, 0)); // Mon Mar 2
        expect(springForward.end).toEqual(new Date(2026, 2, 9, 0, 0, 0, 0)); // Mon Mar 9
        expect(getCycleDayCount(springForward)).toBe(7);

        const fallBack = calculatePeriodWindow(
          { ...weeklySettings, periodStartDay: 0 }, // Sunday
          new Date(2026, 10, 4, 12, 0, 0), // Wed Nov 4
          0,
        );
        expect(fallBack.start).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0)); // Sun Nov 1
        expect(fallBack.end).toEqual(new Date(2026, 10, 8, 0, 0, 0, 0)); // Sun Nov 8
        expect(getCycleDayCount(fallBack)).toBe(7);
      });
    });

    describe('computeDailyAllowances', () => {
      const window = calculatePeriodWindow(
        weeklySettings,
        new Date(2026, 9, 14, 10, 0, 0),
        0,
      ); // Mon Oct 12 -> Mon Oct 19, amount 70

      it('rolls the untouched amount forward across the cycle when there are no expenses', () => {
        const allowances = computeDailyAllowances(70, window, []);

        expect(allowances.size).toBe(7);
        expect(Array.from(allowances.keys())).toEqual([
          '2026-10-12',
          '2026-10-13',
          '2026-10-14',
          '2026-10-15',
          '2026-10-16',
          '2026-10-17',
          '2026-10-18',
        ]);
        // Day 1 is the even split (70 / 7); each later day divides the untouched
        // amount by the shrinking number of days left, including that day.
        expect(Array.from(allowances.values())).toEqual([
          10, 11.67, 14, 17.5, 23.33, 35, 70,
        ]);
      });

      it('does not let same-day spending change that day, only later days', () => {
        const expenses = [
          makeExpense(35, new Date(2026, 9, 12, 9, 0, 0)), // day 1
          makeExpense(20, new Date(2026, 9, 14, 9, 0, 0)), // day 3
        ];
        const allowances = computeDailyAllowances(70, window, expenses);

        expect(allowances.get('2026-10-12')).toBe(10); // unchanged by its own 35
        // 35 spent before day 2, 6 days left: (70 - 35) / 6 = 5.833...
        expect(allowances.get('2026-10-13')).toBe(5.83);
        // 55 spent before day 4, 4 days left: (70 - 55) / 4 = 3.75
        expect(allowances.get('2026-10-15')).toBe(3.75);
      });

      it('rounds allowances to cents', () => {
        const allowances = computeDailyAllowances(100, window, []);
        // 100 / 7 = 14.2857... -> 14.29 on day 1, 100 / 1 = 100 on day 7.
        expect(allowances.get('2026-10-12')).toBe(14.29);
        expect(allowances.get('2026-10-13')).toBe(16.67); // 100 / 6
        expect(allowances.get('2026-10-18')).toBe(100);
      });

      it('returns 0 once spending before a day reaches the amount', () => {
        const expenses = [makeExpense(70, new Date(2026, 9, 12, 9, 0, 0))];
        const allowances = computeDailyAllowances(70, window, expenses);

        expect(allowances.get('2026-10-12')).toBe(10);
        expect(allowances.get('2026-10-13')).toBe(0);
        expect(allowances.get('2026-10-18')).toBe(0);
      });

      it('ignores expenses outside the window and treats bad amounts as 0', () => {
        const outside = [
          makeExpense(100, new Date(2026, 9, 11, 23, 59, 0)), // before start
          makeExpense(100, new Date(2026, 9, 19, 0, 0, 0)), // exactly at end (exclusive)
        ];
        const allowances = computeDailyAllowances(70, window, outside);
        const baseline = computeDailyAllowances(70, window, []);
        expect(Array.from(allowances.entries())).toEqual(Array.from(baseline.entries()));

        const negative = computeDailyAllowances(-70, window, []);
        for (const value of negative.values()) {
          expect(value).toBe(0);
        }

        const notANumber = computeDailyAllowances(Number.NaN, window, []);
        for (const value of notANumber.values()) {
          expect(value).toBe(0);
        }
      });

      it('exports local date keys that match groupExpensesByDay', () => {
        expect(toLocalDateKey(new Date(2026, 1, 1, 23, 30, 0))).toBe('2026-02-01');
        const groups = groupExpensesByDay(
          [makeExpense(5, new Date(2026, 1, 1, 9, 0, 0))],
          new Date(2026, 1, 2, 9, 0, 0),
        );
        expect(groups[0].dateKey).toBe('2026-02-01');
      });
    });

    describe('getDailyAllowanceSummary', () => {
      const window = calculatePeriodWindow(
        monthlySettings,
        new Date(2026, 1, 10, 12, 0, 0),
        0,
      ); // Feb 1 -> Mar 1, 2026 (28 days)

      const expenses = [
        makeExpense(20, new Date(2026, 1, 1, 9, 0, 0)),
        makeExpense(30, new Date(2026, 1, 10, 9, 0, 0)),
        makeExpense(99, new Date(2026, 2, 1, 0, 0, 0)), // outside (end exclusive)
      ];

      it('returns null when now is outside the window', () => {
        expect(
          getDailyAllowanceSummary(280, window, expenses, new Date(2026, 0, 31, 23, 59, 0)),
        ).toBeNull();
        expect(
          getDailyAllowanceSummary(280, window, expenses, new Date(2026, 2, 1, 0, 0, 0)),
        ).toBeNull();
      });

      it('reports the allowance, today spending and cycle remainder', () => {
        const now = new Date(2026, 1, 10, 12, 0, 0); // Feb 10 -> day index 9, 19 days left
        const summary = getDailyAllowanceSummary(280, window, expenses, now);

        expect(summary).not.toBeNull();
        expect(summary!.allowance).toBe(13.68); // (280 - 20) / 19 = 13.684...
        expect(summary!.spentToday).toBe(30);
        expect(summary!.remainingToday).toBe(-16.32); // 13.68 - 30
        expect(summary!.cycleRemaining).toBe(230); // 280 - 20 - 30

        const allowances = computeDailyAllowances(280, window, expenses);
        expect(summary!.allowance).toBe(allowances.get('2026-02-10'));
      });

      it('gives the full even split on the first day of the cycle', () => {
        const summary = getDailyAllowanceSummary(
          280,
          window,
          expenses,
          new Date(2026, 1, 1, 0, 0, 0),
        );

        expect(summary).not.toBeNull();
        expect(summary!.allowance).toBe(10); // 280 / 28 on day 1
        expect(summary!.spentToday).toBe(20);
        expect(summary!.remainingToday).toBe(-10);
        expect(summary!.cycleRemaining).toBe(230); // 280 - 20 (Feb 1) - 30 (Feb 10)
      });
    });
  });

  describe('One-off budgets', () => {
    const trip: PeriodConfig = {
      cadence: 'monthly',
      periodStartDay: 1,
      kind: 'oneOff',
      startDate: '2026-12-20',
      endDate: '2026-12-28',
    };

    const shortTrip: PeriodConfig = {
      ...trip,
      endDate: '2026-12-22',
    };

    describe('calculatePeriodWindow', () => {
      it('builds a dated window and reports an upcoming countdown', () => {
        const window = calculatePeriodWindow(trip, new Date(2026, 11, 18, 9, 0, 0));

        expect(window.start).toEqual(new Date(2026, 11, 20, 0, 0, 0, 0));
        expect(window.end).toEqual(new Date(2026, 11, 29, 0, 0, 0, 0));
        expect(window.label).toBe('Dec 20 – Dec 28');
        expect(window.countdownLabel).toBe('Starts in 2 days');
        expect(window.cadenceLabel).toBe('One-off');
        expect(window.oneOff).toEqual({ dated: true, status: 'upcoming' });
        expect(window.isCurrent).toBe(true);
        expect(window.offset).toBe(0);

        const tomorrow = calculatePeriodWindow(trip, new Date(2026, 11, 19, 9, 0, 0));
        expect(tomorrow.countdownLabel).toBe('Starts tomorrow');
      });

      it('reports active countdowns including the last day', () => {
        const firstDay = calculatePeriodWindow(trip, new Date(2026, 11, 20, 0, 0, 0));
        expect(firstDay.oneOff).toEqual({ dated: true, status: 'active' });
        expect(firstDay.countdownLabel).toBe('9 days left');

        const middle = calculatePeriodWindow(trip, new Date(2026, 11, 24, 12, 0, 0));
        expect(middle.oneOff).toEqual({ dated: true, status: 'active' });
        expect(middle.countdownLabel).toBe('5 days left');

        const lastDay = calculatePeriodWindow(trip, new Date(2026, 11, 28, 18, 0, 0));
        expect(lastDay.oneOff).toEqual({ dated: true, status: 'active' });
        expect(lastDay.countdownLabel).toBe('Last day');
      });

      it('reports ended once the end date is over', () => {
        const window = calculatePeriodWindow(trip, new Date(2026, 11, 29, 0, 0, 0));
        expect(window.countdownLabel).toBe('Ended');
        expect(window.oneOff).toEqual({ dated: true, status: 'ended' });
      });

      it('labels a single-day budget without a range', () => {
        const window = calculatePeriodWindow(
          { ...trip, endDate: '2026-12-20' },
          new Date(2026, 11, 20, 12, 0, 0),
        );
        expect(window.start).toEqual(new Date(2026, 11, 20, 0, 0, 0, 0));
        expect(window.end).toEqual(new Date(2026, 11, 21, 0, 0, 0, 0));
        expect(window.label).toBe('Dec 20');
        expect(window.countdownLabel).toBe('Last day');
        expect(getCycleDayCount(window)).toBe(1);
      });

      it('includes the end year when the range crosses into another year', () => {
        const window = calculatePeriodWindow(
          { ...trip, startDate: '2026-12-28', endDate: '2027-01-03' },
          new Date(2026, 11, 15, 12, 0, 0),
        );
        expect(window.start).toEqual(new Date(2026, 11, 28, 0, 0, 0, 0));
        expect(window.end).toEqual(new Date(2027, 0, 4, 0, 0, 0, 0));
        expect(window.label).toBe('Dec 28 – Jan 3, 2027');
      });

      it('counts calendar days correctly across DST transitions', () => {
        const springForward = calculatePeriodWindow(
          { ...trip, startDate: '2026-03-07', endDate: '2026-03-10' },
          new Date(2026, 2, 7, 12, 0, 0),
        );
        expect(getCycleDayCount(springForward)).toBe(4);

        const fallBack = calculatePeriodWindow(
          { ...trip, startDate: '2026-10-31', endDate: '2026-11-03' },
          new Date(2026, 9, 31, 12, 0, 0),
        );
        expect(getCycleDayCount(fallBack)).toBe(4);
      });

      it('treats an undated one-off budget as one open-ended running total', () => {
        const window = calculatePeriodWindow(
          { cadence: 'daily', periodStartDay: 0, kind: 'oneOff' },
          new Date(2026, 9, 14, 10, 0, 0),
        );
        expect(window.start).toEqual(new Date(0));
        expect(window.end).toEqual(new Date(ONE_OFF_OPEN_END_MS));
        expect(window.label).toBe('No end date');
        expect(window.countdownLabel).toBe('Ongoing');
        expect(window.cadenceLabel).toBe('One-off');
        expect(window.oneOff).toEqual({ dated: false, status: 'active' });
        expect(window.isCurrent).toBe(true);
        expect(window.offset).toBe(0);
      });

      it('ignores cycleOffset for one-off budgets', () => {
        const now = new Date(2026, 11, 24, 12, 0, 0);
        const current = calculatePeriodWindow(trip, now, 0);
        const shifted = calculatePeriodWindow(trip, now, -3);

        expect(shifted.start).toEqual(current.start);
        expect(shifted.end).toEqual(current.end);
        expect(shifted.label).toBe(current.label);
        expect(shifted.isCurrent).toBe(true);
        expect(shifted.offset).toBe(0);
        expect(shifted.oneOff).toEqual({ dated: true, status: 'active' });
      });

      it('keeps recurring behaviour unchanged when kind is explicitly recurring', () => {
        const recurring: PeriodConfig = {
          cadence: 'monthly',
          periodStartDay: 1,
          kind: 'recurring',
        };
        const window = calculatePeriodWindow(recurring, new Date(2026, 9, 14, 10, 0, 0));

        expect(window.start).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
        expect(window.end).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0));
        expect(window.label).toBe('Oct 1 – Oct 31');
        expect(window.oneOff).toBeUndefined();
      });
    });

    describe('getExpenseQueryRange', () => {
      it('returns an open range for one-off budgets and the window for recurring ones', () => {
        const now = new Date(2026, 11, 24, 12, 0, 0);
        const oneOffWindow = calculatePeriodWindow(trip, now);
        expect(getExpenseQueryRange(trip, oneOffWindow)).toEqual({
          start: new Date(0),
          end: new Date(ONE_OFF_OPEN_END_MS),
        });

        const undated: PeriodConfig = {
          cadence: 'weekly',
          periodStartDay: 1,
          kind: 'oneOff',
        };
        expect(getExpenseQueryRange(undated, calculatePeriodWindow(undated, now))).toEqual({
          start: new Date(0),
          end: new Date(ONE_OFF_OPEN_END_MS),
        });

        const recurring: PeriodConfig = {
          cadence: 'weekly',
          periodStartDay: 1,
          kind: 'recurring',
        };
        const recurringWindow = calculatePeriodWindow(
          recurring,
          new Date(2026, 9, 14, 10, 0, 0),
        );
        expect(getExpenseQueryRange(recurring, recurringWindow)).toEqual({
          start: recurringWindow.start,
          end: recurringWindow.end,
        });
      });
    });

    describe('countEarlierSpending', () => {
      const expenses = [
        makeExpense(100, new Date(2026, 9, 1, 9, 0, 0)), // before the trip
        makeExpense(30, new Date(2026, 11, 20, 9, 0, 0)), // day 1
        makeExpense(20, new Date(2026, 11, 21, 9, 0, 0)), // day 2
        makeExpense(999, new Date(2026, 11, 23, 9, 0, 0)), // at/after end
      ];
      const window = calculatePeriodWindow(shortTrip, new Date(2026, 11, 20, 12, 0, 0));

      it('ignores spending before the window by default', () => {
        const allowances = computeDailyAllowances(300, window, expenses);

        expect(allowances.get('2026-12-20')).toBe(100); // 300 / 3
        expect(allowances.get('2026-12-21')).toBe(135); // (300 - 30) / 2
        expect(allowances.get('2026-12-22')).toBe(250); // (300 - 50) / 1
      });

      it('counts earlier spending as already spent before day 1 when requested', () => {
        const allowances = computeDailyAllowances(300, window, expenses, {
          countEarlierSpending: true,
        });

        expect(allowances.get('2026-12-20')).toBe(66.67); // (300 - 100) / 3
        expect(allowances.get('2026-12-21')).toBe(85); // (300 - 130) / 2
        expect(allowances.get('2026-12-22')).toBe(150); // 300 - 150
      });

      it('mirrors the option in getDailyAllowanceSummary cycle remaining', () => {
        const now = new Date(2026, 11, 21, 12, 0, 0);

        const withoutEarlier = getDailyAllowanceSummary(300, window, expenses, now);
        expect(withoutEarlier!.allowance).toBe(135);
        expect(withoutEarlier!.spentToday).toBe(20);
        expect(withoutEarlier!.remainingToday).toBe(115);
        expect(withoutEarlier!.cycleRemaining).toBe(250); // 300 - 30 - 20

        const withEarlier = getDailyAllowanceSummary(300, window, expenses, now, {
          countEarlierSpending: true,
        });
        expect(withEarlier!.allowance).toBe(85);
        expect(withEarlier!.spentToday).toBe(20);
        expect(withEarlier!.remainingToday).toBe(65);
        expect(withEarlier!.cycleRemaining).toBe(150); // 300 - 100 - 30 - 20
      });
    });
  });
});
