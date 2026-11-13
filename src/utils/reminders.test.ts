import { describe, expect, it } from 'vitest';
import {
  REMINDER_TIME_OPTIONS,
  buildReminderMessage,
  computeNextReminderAt,
  formatCycleLastDayLabel,
  formatReminderTime,
  getTimeZoneOffsetMinutes,
  isValidReminderTime,
  isValidTimeZone,
  normalizeReminderTimes,
  zonedWallTimeToEpoch,
} from './reminders';
import { formatCurrency } from './periodCalculator';
import type { BudgetReminders } from '../types/expense';

const SINGAPORE = 'Asia/Singapore';
const NEW_YORK = 'America/New_York';

function reminders(
  times: string[],
  timeZone = SINGAPORE,
  enabled = true,
): BudgetReminders {
  return { enabled, times, timeZone };
}

describe('REMINDER_TIME_OPTIONS', () => {
  it('contains all 96 quarter-hour times in order', () => {
    expect(REMINDER_TIME_OPTIONS).toHaveLength(96);
    expect(REMINDER_TIME_OPTIONS[0]).toBe('00:00');
    expect(REMINDER_TIME_OPTIONS[95]).toBe('23:45');
    expect(REMINDER_TIME_OPTIONS[1]).toBe('00:15');
  });
});

describe('isValidReminderTime', () => {
  it('accepts quarter-hour wall-clock strings', () => {
    expect(isValidReminderTime('00:00')).toBe(true);
    expect(isValidReminderTime('09:15')).toBe(true);
    expect(isValidReminderTime('23:45')).toBe(true);
  });

  it('rejects malformed or off-step values', () => {
    expect(isValidReminderTime('20:10')).toBe(false);
    expect(isValidReminderTime('24:00')).toBe(false);
    expect(isValidReminderTime('9:00')).toBe(false);
    expect(isValidReminderTime('00:60')).toBe(false);
    expect(isValidReminderTime('-1:00')).toBe(false);
    expect(isValidReminderTime('abc')).toBe(false);
    expect(isValidReminderTime(900)).toBe(false);
    expect(isValidReminderTime(null)).toBe(false);
    expect(isValidReminderTime(undefined)).toBe(false);
  });
});

describe('normalizeReminderTimes', () => {
  it('keeps valid entries, dedupes and sorts ascending', () => {
    expect(normalizeReminderTimes(['20:00', '09:15', '20:00', 'bad', '20:10'])).toEqual([
      '09:15',
      '20:00',
    ]);
  });

  it('caps at four entries keeping the earliest', () => {
    expect(
      normalizeReminderTimes(['21:00', '08:00', '12:00', '18:00', '23:45', '00:30']),
    ).toEqual(['00:30', '08:00', '12:00', '18:00']);
  });

  it('returns an empty array for non-arrays', () => {
    expect(normalizeReminderTimes(undefined)).toEqual([]);
    expect(normalizeReminderTimes(null)).toEqual([]);
    expect(normalizeReminderTimes('20:00')).toEqual([]);
    expect(normalizeReminderTimes({})).toEqual([]);
  });
});

describe('formatReminderTime', () => {
  it('formats 24-hour times as 12-hour labels', () => {
    expect(formatReminderTime('20:00')).toBe('8:00 PM');
    expect(formatReminderTime('00:15')).toBe('12:15 AM');
    expect(formatReminderTime('12:00')).toBe('12:00 PM');
    expect(formatReminderTime('09:45')).toBe('9:45 AM');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimeZone('Asia/Singapore')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('America/' + 'x'.repeat(60))).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('getTimeZoneOffsetMinutes', () => {
  it('reports the Singapore offset', () => {
    expect(getTimeZoneOffsetMinutes(Date.UTC(2026, 10, 12, 12, 0), SINGAPORE)).toBe(480);
  });

  it('tracks New York standard and daylight offsets', () => {
    expect(getTimeZoneOffsetMinutes(Date.UTC(2026, 0, 15, 12, 0), NEW_YORK)).toBe(-300);
    expect(getTimeZoneOffsetMinutes(Date.UTC(2026, 6, 15, 12, 0), NEW_YORK)).toBe(-240);
  });

  it('reports zero for UTC', () => {
    expect(getTimeZoneOffsetMinutes(Date.UTC(2026, 10, 12, 12, 0), 'UTC')).toBe(0);
  });
});

describe('zonedWallTimeToEpoch', () => {
  it('converts Singapore wall time to UTC', () => {
    expect(zonedWallTimeToEpoch(2026, 11, 12, 20, 0, SINGAPORE)).toBe(
      Date.UTC(2026, 10, 12, 12, 0),
    );
  });

  it('converts New York summer wall time to UTC', () => {
    expect(zonedWallTimeToEpoch(2026, 7, 1, 9, 0, NEW_YORK)).toBe(
      Date.UTC(2026, 6, 1, 13, 0),
    );
  });

  it('shifts a spring-forward gap time one offset change later', () => {
    expect(zonedWallTimeToEpoch(2026, 3, 8, 2, 30, NEW_YORK)).toBe(
      Date.UTC(2026, 2, 8, 7, 30),
    );
  });

  it('returns the earlier instant for an ambiguous fall-back time', () => {
    expect(zonedWallTimeToEpoch(2026, 11, 1, 1, 30, NEW_YORK)).toBe(
      Date.UTC(2026, 10, 1, 5, 30),
    );
  });
});

describe('computeNextReminderAt', () => {
  it('returns null when reminders are missing, disabled, empty or have a bad zone', () => {
    expect(computeNextReminderAt(undefined, Date.UTC(2026, 10, 12, 2, 0))).toBeNull();
    expect(computeNextReminderAt(null, Date.UTC(2026, 10, 12, 2, 0))).toBeNull();
    expect(
      computeNextReminderAt(
        reminders(['13:00'], SINGAPORE, false),
        Date.UTC(2026, 10, 12, 2, 0),
      ),
    ).toBeNull();
    expect(computeNextReminderAt(reminders([]), Date.UTC(2026, 10, 12, 2, 0))).toBeNull();
    expect(
      computeNextReminderAt(
        reminders(['13:00'], 'Not/AZone'),
        Date.UTC(2026, 10, 12, 2, 0),
      ),
    ).toBeNull();
  });

  it('picks the next Singapore time later the same day', () => {
    const reminder = reminders(['13:00', '20:00']);
    const after10am = Date.UTC(2026, 10, 12, 2, 0); // 10:00 local
    expect(computeNextReminderAt(reminder, after10am)).toBe(Date.UTC(2026, 10, 12, 5, 0));
  });

  it('is strictly greater than afterMs at an exact reminder time', () => {
    const reminder = reminders(['13:00', '20:00']);
    const exactly1pm = Date.UTC(2026, 10, 12, 5, 0); // 13:00 local
    expect(computeNextReminderAt(reminder, exactly1pm)).toBe(Date.UTC(2026, 10, 12, 12, 0));
  });

  it('rolls over to the next local day after the last reminder', () => {
    const reminder = reminders(['13:00', '20:00']);
    const after9pm = Date.UTC(2026, 10, 12, 13, 0); // 21:00 local
    expect(computeNextReminderAt(reminder, after9pm)).toBe(Date.UTC(2026, 10, 13, 5, 0));
  });

  it('keeps a New York daily 20:00 reminder at 20:00 across the DST change', () => {
    const reminder = reminders(['20:00'], NEW_YORK);
    const beforeFirst = Date.UTC(2026, 9, 31, 23, 0); // Oct 31 19:00 EDT
    const first = computeNextReminderAt(reminder, beforeFirst);
    expect(first).toBe(Date.UTC(2026, 10, 1, 0, 0)); // Oct 31 20:00 EDT (UTC-4)

    const second = computeNextReminderAt(reminder, first as number);
    expect(second).toBe(Date.UTC(2026, 10, 2, 1, 0)); // Nov 1 20:00 EST (UTC-5)
  });
});

describe('buildReminderMessage', () => {
  it('builds the under-budget today message', () => {
    const money = formatCurrency(12.5, 'SGD');
    expect(
      buildReminderMessage({
        budgetName: 'Groceries',
        currency: 'SGD',
        kind: 'today',
        remaining: 12.5,
      }),
    ).toEqual({
      title: 'Groceries budget reminder',
      body: `You have ${money} remaining in your budget today. Anything to log?`,
    });
  });

  it('builds the over-budget today message with an absolute amount', () => {
    const money = formatCurrency(3.25, 'USD');
    expect(
      buildReminderMessage({
        budgetName: 'Fun',
        currency: 'USD',
        kind: 'today',
        remaining: -3.25,
      }),
    ).toEqual({
      title: 'Fun budget reminder',
      body: `You spent ${money} over today's budget. Anything to log?`,
    });
  });

  it('builds the under-budget cycle message with a last-day label', () => {
    const money = formatCurrency(40, 'USD');
    expect(
      buildReminderMessage({
        budgetName: 'Travel',
        currency: 'USD',
        kind: 'cycle',
        remaining: 40,
        cycleLastDayLabel: 'Nov 30',
      }),
    ).toEqual({
      title: 'Travel budget reminder',
      body: `${money} left until Nov 30. Anything to log?`,
    });
  });

  it('falls back to this-cycle wording without a label', () => {
    const money = formatCurrency(40, 'USD');
    expect(
      buildReminderMessage({
        budgetName: 'Travel',
        currency: 'USD',
        kind: 'cycle',
        remaining: 40,
      }),
    ).toEqual({
      title: 'Travel budget reminder',
      body: `${money} left this cycle. Anything to log?`,
    });
  });

  it('builds the over-budget cycle message', () => {
    const money = formatCurrency(7, 'USD');
    expect(
      buildReminderMessage({
        budgetName: 'Travel',
        currency: 'USD',
        kind: 'cycle',
        remaining: -7,
        cycleLastDayLabel: 'Nov 30',
      }),
    ).toEqual({
      title: 'Travel budget reminder',
      body: `${money} over budget this cycle. Anything to log?`,
    });
  });

  it('treats near-zero remaining as zero', () => {
    const money = formatCurrency(0, 'USD');
    expect(
      buildReminderMessage({
        budgetName: 'Tiny',
        currency: 'USD',
        kind: 'today',
        remaining: 0.001,
      }).body,
    ).toBe(`You have ${money} remaining in your budget today. Anything to log?`);
    expect(
      buildReminderMessage({
        budgetName: 'Tiny',
        currency: 'USD',
        kind: 'today',
        remaining: -0.001,
      }).body,
    ).toBe(`You have ${money} remaining in your budget today. Anything to log?`);
  });
});

describe('formatCycleLastDayLabel', () => {
  it('labels the last day of a Singapore cycle', () => {
    const endExclusive = zonedWallTimeToEpoch(2026, 12, 1, 0, 0, SINGAPORE);
    expect(formatCycleLastDayLabel(endExclusive, SINGAPORE)).toBe('Nov 30');
  });
});
