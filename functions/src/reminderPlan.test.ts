import { describe, expect, it } from 'vitest';
import {
  buildMessageFromSums,
  parseBudgetForReminder,
  planBudgetReminder,
  tokenErrorShouldDelete,
  withTimeZone,
  type ParsedBudgetForReminder,
} from './reminderPlan';
import { formatCurrency, ONE_OFF_OPEN_END_MS } from '../../src/utils/periodCalculator';

const SINGAPORE = 'Asia/Singapore';

/** Wed Nov 11 2026, 10:00 in Singapore (02:00 UTC). */
const NOW = Date.UTC(2026, 10, 11, 2, 0);
/** Mon Nov 9 2026, 00:00 in Singapore, as a UTC epoch. */
const WEEK_START = Date.UTC(2026, 10, 8, 16, 0);
/** Mon Nov 16 2026, 00:00 in Singapore, as a UTC epoch. */
const WEEK_END = Date.UTC(2026, 10, 15, 16, 0);
/** Wed Nov 11 2026, 00:00 in Singapore, as a UTC epoch. */
const TODAY_START = Date.UTC(2026, 10, 10, 16, 0);

function budget(
  overrides: Partial<ParsedBudgetForReminder> = {},
): ParsedBudgetForReminder {
  return {
    name: 'Groceries',
    amount: 70,
    cadence: 'weekly',
    periodStartDay: 1,
    currency: 'SGD',
    kind: 'recurring',
    dailyTracking: false,
    reminders: {
      enabled: true,
      times: ['13:00', '20:00'],
      timeZone: SINGAPORE,
    },
    nextReminderAt: NOW,
    ...overrides,
  };
}

describe('withTimeZone', () => {
  it('runs the callback in the requested zone and restores the previous TZ', () => {
    const saved = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Singapore';
      const seen = withTimeZone('America/New_York', () => process.env.TZ);
      expect(seen).toBe('America/New_York');
      expect(process.env.TZ).toBe('Asia/Singapore');

      delete process.env.TZ;
      const deleted = withTimeZone('Europe/London', () => process.env.TZ);
      expect(deleted).toBe('Europe/London');
      expect(process.env.TZ).toBeUndefined();
    } finally {
      if (saved === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = saved;
      }
    }
  });

  it('restores the zone even when the callback throws', () => {
    const saved = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Singapore';
      expect(() =>
        withTimeZone('America/New_York', () => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(process.env.TZ).toBe('Asia/Singapore');
    } finally {
      if (saved === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = saved;
      }
    }
  });
});

describe('parseBudgetForReminder', () => {
  it('returns null when reminders are unusable', () => {
    expect(parseBudgetForReminder({ nextReminderAt: NOW })).toBeNull();
    expect(
      parseBudgetForReminder({
        reminders: { enabled: false, times: ['13:00'], timeZone: SINGAPORE },
        nextReminderAt: NOW,
      }),
    ).toBeNull();
    expect(
      parseBudgetForReminder({
        reminders: { enabled: true, times: ['13:00'], timeZone: 'Not/AZone' },
        nextReminderAt: NOW,
      }),
    ).toBeNull();
    expect(
      parseBudgetForReminder({
        reminders: { enabled: true, times: [], timeZone: SINGAPORE },
        nextReminderAt: NOW,
      }),
    ).toBeNull();
    expect(
      parseBudgetForReminder({
        reminders: { enabled: true, times: ['13:00'], timeZone: SINGAPORE },
        nextReminderAt: 'soon',
      }),
    ).toBeNull();
  });

  it('fills defensive defaults and normalizes times', () => {
    const parsed = parseBudgetForReminder({
      reminders: {
        enabled: true,
        times: ['20:00', '13:00', '20:00'],
        timeZone: SINGAPORE,
      },
      nextReminderAt: NOW,
    });

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      name: 'Budget',
      amount: 0,
      cadence: 'monthly',
      periodStartDay: 1,
      currency: 'USD',
      kind: 'recurring',
      dailyTracking: false,
      nextReminderAt: NOW,
    });
    expect(parsed?.reminders.times).toEqual(['13:00', '20:00']);
    expect(parsed?.startDate).toBeUndefined();
    expect(parsed?.endDate).toBeUndefined();
  });

  it('parses a dated one-off budget', () => {
    const parsed = parseBudgetForReminder({
      kind: 'oneOff',
      startDate: '2026-11-10',
      endDate: '2026-11-20',
      reminders: { enabled: true, times: ['13:00'], timeZone: SINGAPORE },
      nextReminderAt: NOW,
    });

    expect(parsed).toMatchObject({
      kind: 'oneOff',
      startDate: '2026-11-10',
      endDate: '2026-11-20',
    });
  });

  it('returns null for an undated one-off budget', () => {
    expect(
      parseBudgetForReminder({
        kind: 'oneOff',
        reminders: { enabled: true, times: ['13:00'], timeZone: SINGAPORE },
        nextReminderAt: NOW,
      }),
    ).toBeNull();
  });

  it('returns null when a one-off budget has malformed or partial dates', () => {
    const base = {
      kind: 'oneOff',
      reminders: { enabled: true, times: ['13:00'], timeZone: SINGAPORE },
      nextReminderAt: NOW,
    };
    expect(
      parseBudgetForReminder({
        ...base,
        startDate: '2026-13-01',
        endDate: '2026-11-20',
      }),
    ).toBeNull();
    expect(
      parseBudgetForReminder({ ...base, startDate: '2026-11-10' }),
    ).toBeNull();
    expect(
      parseBudgetForReminder({
        ...base,
        startDate: 'not-a-date',
        endDate: '2026-11-20',
      }),
    ).toBeNull();
    expect(
      parseBudgetForReminder({
        ...base,
        startDate: '2026-02-30',
        endDate: '2026-11-20',
      }),
    ).toBeNull();
  });

  it('ignores dates on recurring budgets', () => {
    const parsed = parseBudgetForReminder({
      kind: 'recurring',
      startDate: '2026-11-10',
      endDate: '2026-11-20',
      reminders: { enabled: true, times: ['13:00'], timeZone: SINGAPORE },
      nextReminderAt: NOW,
    });

    expect(parsed?.kind).toBe('recurring');
    expect(parsed?.startDate).toBeUndefined();
    expect(parsed?.endDate).toBeUndefined();
  });

  it('keeps valid values and defaults a daily cutoff to midnight', () => {
    const parsed = parseBudgetForReminder({
      name: 'Coffee',
      amount: 40,
      cadence: 'daily',
      currency: 'SGD',
      dailyTracking: true,
      reminders: { enabled: true, times: ['09:00'], timeZone: SINGAPORE },
      nextReminderAt: NOW,
    });

    expect(parsed).toMatchObject({
      name: 'Coffee',
      amount: 40,
      cadence: 'daily',
      periodStartDay: 0,
      currency: 'SGD',
      dailyTracking: true,
    });
  });
});

describe('planBudgetReminder', () => {
  it('flags a stored slot stale only after more than an hour', () => {
    const hour = 60 * 60 * 1000;
    expect(
      planBudgetReminder(budget({ nextReminderAt: NOW - hour - 1 }), NOW).stale,
    ).toBe(true);
    expect(
      planBudgetReminder(budget({ nextReminderAt: NOW - hour }), NOW).stale,
    ).toBe(false);
    expect(
      planBudgetReminder(budget({ nextReminderAt: NOW - 30 * 60 * 1000 }), NOW)
        .stale,
    ).toBe(false);
  });

  it('advances strictly past the stored slot to the next local time', () => {
    // Stored slot is 20:00 Singapore; "now" is 21:00 Singapore the same day.
    const slot = Date.UTC(2026, 10, 11, 12, 0);
    const now = Date.UTC(2026, 10, 11, 13, 0);
    const plan = planBudgetReminder(budget({ nextReminderAt: slot }), now);

    expect(plan.nextReminderAt).toBe(Date.UTC(2026, 10, 12, 5, 0)); // next day 13:00
    expect(plan.nextReminderAt).not.toBeNull();
    expect(plan.nextReminderAt as number).toBeGreaterThan(slot);
    expect(plan.nextReminderAt as number).toBeGreaterThan(now);
  });

  it('uses Singapore midnight as todayStart for a daily-tracking budget', () => {
    const plan = planBudgetReminder(budget({ dailyTracking: true }), NOW);

    expect(plan.ranges.kind).toBe('daily');
    if (plan.ranges.kind !== 'daily') throw new Error('expected daily ranges');
    expect(plan.ranges.cycleStart).toBe(WEEK_START);
    expect(plan.ranges.todayStart).toBe(TODAY_START);
    expect(plan.ranges.cycleEnd).toBe(WEEK_END);
  });

  it('uses whole-cycle ranges when daily tracking is off', () => {
    const plan = planBudgetReminder(budget({ dailyTracking: false }), NOW);

    expect(plan.ranges.kind).toBe('cycle');
    if (plan.ranges.kind !== 'cycle') throw new Error('expected cycle ranges');
    expect(plan.ranges.cycleStart).toBe(WEEK_START);
    expect(plan.ranges.cycleEnd).toBe(WEEK_END);
  });
});

describe('planBudgetReminder for one-off budgets', () => {
  it('steps to the next slot while inside the date range', () => {
    const b = budget({
      kind: 'oneOff',
      startDate: '2026-11-09',
      endDate: '2026-11-11',
      nextReminderAt: NOW, // Wed Nov 11 10:00 Singapore
    });
    const plan = planBudgetReminder(b, NOW);
    expect(plan.nextReminderAt).toBe(Date.UTC(2026, 10, 11, 5, 0)); // Nov 11 13:00
  });

  it('returns null after the last slot on the end date', () => {
    const b = budget({
      kind: 'oneOff',
      startDate: '2026-11-09',
      endDate: '2026-11-11',
      nextReminderAt: Date.UTC(2026, 10, 11, 12, 0), // Nov 11 20:00
    });
    const plan = planBudgetReminder(b, Date.UTC(2026, 10, 11, 12, 30));
    expect(plan.nextReminderAt).toBeNull();
  });

  it('starts on the start date when the stored slot is weeks earlier', () => {
    const b = budget({
      kind: 'oneOff',
      startDate: '2026-11-20',
      endDate: '2026-11-25',
      nextReminderAt: NOW, // Wed Nov 11
    });
    const plan = planBudgetReminder(b, NOW);
    expect(plan.nextReminderAt).toBe(Date.UTC(2026, 10, 20, 5, 0)); // Nov 20 13:00
  });

  it('starts spending at 0 and keeps the window end as the label bound', () => {
    const b = budget({
      kind: 'oneOff',
      startDate: '2026-11-10',
      endDate: '2026-11-20',
      name: 'Trip',
      amount: 300,
    });
    const plan = planBudgetReminder(b, NOW);

    expect(plan.ranges.kind).toBe('cycle');
    if (plan.ranges.kind !== 'cycle') throw new Error('expected cycle ranges');
    expect(plan.ranges.cycleStart).toBe(0);
    expect(plan.ranges.cycleEnd).toBe(Date.UTC(2026, 10, 20, 16, 0)); // Nov 21 00:00
    expect(plan.ranges.sumEnd).toBe(ONE_OFF_OPEN_END_MS);
  });

  it('uses today midnight and the full sum range for a daily-tracking one-off', () => {
    const b = budget({
      kind: 'oneOff',
      startDate: '2026-11-10',
      endDate: '2026-11-20',
      dailyTracking: true,
    });
    const plan = planBudgetReminder(b, NOW);

    expect(plan.ranges.kind).toBe('daily');
    if (plan.ranges.kind !== 'daily') throw new Error('expected daily ranges');
    expect(plan.ranges.cycleStart).toBe(0);
    expect(plan.ranges.todayStart).toBe(TODAY_START);
    expect(plan.ranges.sumEnd).toBe(ONE_OFF_OPEN_END_MS);
  });
});

describe('buildMessageFromSums', () => {
  it('builds the rolling daily message for a weekly budget with daily tracking', () => {
    const b = budget({ dailyTracking: true });
    const plan = planBudgetReminder(b, NOW);

    // (70 - 20) / 5 days left including today = 10 allowance, minus 3 today = 7.
    const message = buildMessageFromSums(
      b,
      plan.ranges,
      { spentBefore: 20, spentToday: 3 },
      NOW,
    );

    const money = formatCurrency(7, 'SGD');
    expect(message.title).toBe('Groceries budget reminder');
    expect(message.body).toBe(`You have ${money} remaining in your budget today. Anything to log?`);
    expect(message.body.startsWith(`You have ${money} remaining in your budget today`)).toBe(true);
  });

  it('builds the until-last-day message for a monthly budget without tracking', () => {
    const b = budget({
      name: 'Travel',
      amount: 300,
      cadence: 'monthly',
      periodStartDay: 1,
      dailyTracking: false,
    });
    const plan = planBudgetReminder(b, NOW);

    expect(plan.ranges.kind).toBe('cycle');
    const message = buildMessageFromSums(
      b,
      plan.ranges,
      { spentInCycle: 50 },
      NOW,
    );

    expect(message.title).toBe('Travel budget reminder');
    expect(message.body).toBe(
      `${formatCurrency(250, 'SGD')} left until Nov 30. Anything to log?`,
    );
  });

  it('uses today wording for a daily-cadence budget', () => {
    const b = budget({
      name: 'Coffee',
      amount: 50,
      cadence: 'daily',
      periodStartDay: 0,
      dailyTracking: false,
    });
    const plan = planBudgetReminder(b, NOW);

    expect(plan.ranges.kind).toBe('cycle');
    if (plan.ranges.kind !== 'cycle') throw new Error('expected cycle ranges');
    expect(plan.ranges.cycleStart).toBe(TODAY_START);

    const message = buildMessageFromSums(
      b,
      plan.ranges,
      { spentInCycle: 12 },
      NOW,
    );
    expect(message.body).toBe(
      `You have ${formatCurrency(38, 'SGD')} remaining in your budget today. Anything to log?`,
    );
  });

  it('counts pre-start spending for a daily-tracking one-off', () => {
    const b = budget({
      name: 'Trip',
      amount: 100,
      kind: 'oneOff',
      startDate: '2026-11-10',
      endDate: '2026-11-20',
      dailyTracking: true,
    });
    const plan = planBudgetReminder(b, NOW);
    expect(plan.ranges.kind).toBe('daily');

    // 30 spent before today (including before the start date), 5 today.
    // (100 - 30) / 10 days left including today = 7 allowance, minus 5 = 2.
    const message = buildMessageFromSums(
      b,
      plan.ranges,
      { spentBefore: 30, spentToday: 5 },
      NOW,
    );
    expect(message.body).toBe(
      `You have ${formatCurrency(2, 'SGD')} remaining in your budget today. Anything to log?`,
    );
  });

  it('uses the last-day label and one-off over-budget wording', () => {
    const b = budget({
      name: 'Trip',
      amount: 100,
      kind: 'oneOff',
      startDate: '2026-11-10',
      endDate: '2026-11-20',
    });
    const plan = planBudgetReminder(b, NOW);
    expect(plan.ranges.kind).toBe('cycle');

    const under = buildMessageFromSums(
      b,
      plan.ranges,
      { spentInCycle: 40 },
      NOW,
    );
    expect(under.body).toBe(
      `${formatCurrency(60, 'SGD')} left until Nov 20. Anything to log?`,
    );

    const over = buildMessageFromSums(
      b,
      plan.ranges,
      { spentInCycle: 130 },
      NOW,
    );
    expect(over.body).toBe(
      `${formatCurrency(30, 'SGD')} over budget. Anything to log?`,
    );
  });
});

describe('tokenErrorShouldDelete', () => {
  it('recognises permanently invalid tokens', () => {
    expect(
      tokenErrorShouldDelete('messaging/registration-token-not-registered'),
    ).toBe(true);
    expect(tokenErrorShouldDelete('messaging/invalid-registration-token')).toBe(
      true,
    );
    expect(tokenErrorShouldDelete('messaging/invalid-argument')).toBe(true);
  });

  it('keeps tokens for transient or unknown failures', () => {
    expect(tokenErrorShouldDelete('messaging/internal-error')).toBe(false);
    expect(tokenErrorShouldDelete('messaging/server-unavailable')).toBe(false);
    expect(tokenErrorShouldDelete(undefined)).toBe(false);
  });
});
