/**
 * Pure reminder-planning helpers for the scheduled push sender.
 *
 * This module must stay free of firebase imports: it runs in unit tests as well
 * as inside the Cloud Function, and all of its functions are deterministic given
 * their arguments (plus the ambient `process.env.TZ`, which `withTimeZone` makes
 * explicit for the duration of a call).
 */
import type {
  BudgetCadence,
  BudgetReminders,
  ExpenseItem,
} from '../../src/types/expense';
import {
  buildReminderMessage,
  computeNextReminderAt,
  formatCycleLastDayLabel,
  isValidTimeZone,
  normalizeReminderTimes,
} from '../../src/utils/reminders';
import {
  calculatePeriodWindow,
  getDailyAllowanceSummary,
} from '../../src/utils/periodCalculator';

/** A budget's reminder-relevant fields, parsed defensively from Firestore. */
export interface ParsedBudgetForReminder {
  name: string;
  amount: number;
  cadence: BudgetCadence;
  periodStartDay: number;
  currency: string;
  dailyTracking: boolean;
  reminders: BudgetReminders;
  nextReminderAt: number;
}

/** Expense ranges the sender must aggregate for one due budget. */
export type ReminderRanges =
  | {
      kind: 'daily';
      cycleStart: number;
      todayStart: number;
      cycleEnd: number;
    }
  | {
      kind: 'cycle';
      cycleStart: number;
      cycleEnd: number;
    };

/** Pre-computed spending sums for one due budget. */
export interface ReminderSums {
  /** Daily kind: spending in `[cycleStart, todayStart)`. */
  spentBefore?: number;
  /** Daily kind: spending in `[todayStart, cycleEnd)`. */
  spentToday?: number;
  /** Cycle kind: spending in `[cycleStart, cycleEnd)`. */
  spentInCycle?: number;
}

export interface ReminderPlan {
  /** True when the stored slot is more than an hour in the past. */
  stale: boolean;
  nextReminderAt: number | null;
  ranges: ReminderRanges;
}

const VALID_CADENCES: readonly BudgetCadence[] = ['daily', 'weekly', 'monthly'];
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/** Rounds a value to whole cents. */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Runs `fn` with `process.env.TZ` set to `timeZone`, restoring the previous
 * value afterwards. Node re-reads `TZ` when `process.env.TZ` is assigned, so
 * the date helpers in `src/utils` (which use the process-local time zone)
 * operate in the requested zone for the duration of the call.
 */
export function withTimeZone<T>(timeZone: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }
}

function readCadence(value: unknown): BudgetCadence {
  return VALID_CADENCES.includes(value as BudgetCadence)
    ? (value as BudgetCadence)
    : 'monthly';
}

/**
 * Parses one `users/{uid}/budgets/{budgetId}` document into the subset needed
 * to plan a reminder. Returns `null` when the document cannot produce a
 * reminder: reminders missing/disabled, an unusable time zone, no valid
 * reminder time or no numeric `nextReminderAt`.
 */
export function parseBudgetForReminder(
  data: Record<string, unknown>,
): ParsedBudgetForReminder | null {
  const rawReminders = data.reminders;
  if (!rawReminders || typeof rawReminders !== 'object') return null;

  const remindersInput = rawReminders as Record<string, unknown>;
  if (remindersInput.enabled !== true) return null;
  if (!isValidTimeZone(remindersInput.timeZone)) return null;

  const times = normalizeReminderTimes(remindersInput.times);
  if (times.length === 0) return null;

  if (typeof data.nextReminderAt !== 'number' || !Number.isFinite(data.nextReminderAt)) {
    return null;
  }

  const cadence = readCadence(data.cadence);
  const amount = data.amount;
  const periodStartDay = data.periodStartDay;
  const currency = data.currency;

  return {
    name: typeof data.name === 'string' && data.name.length > 0 ? data.name : 'Budget',
    amount: typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : 0,
    cadence,
    periodStartDay:
      typeof periodStartDay === 'number' && Number.isFinite(periodStartDay)
        ? Math.floor(periodStartDay)
        : cadence === 'daily'
          ? 0
          : 1,
    currency: typeof currency === 'string' && currency.length > 0 ? currency : 'USD',
    dailyTracking: data.dailyTracking === true,
    reminders: {
      enabled: true,
      times,
      timeZone: remindersInput.timeZone,
    },
    nextReminderAt: data.nextReminderAt,
  };
}

/** Builds the expense window for `nowMs` in the budget's time zone. */
function computeRanges(
  budget: ParsedBudgetForReminder,
  nowMs: number,
): ReminderRanges {
  return withTimeZone(budget.reminders.timeZone, () => {
    const window = calculatePeriodWindow(
      { cadence: budget.cadence, periodStartDay: budget.periodStartDay },
      new Date(nowMs),
    );
    const cycleStart = window.start.getTime();
    const cycleEnd = window.end.getTime();

    if (budget.dailyTracking && budget.cadence !== 'daily') {
      const now = new Date(nowMs);
      const localMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).getTime();
      return {
        kind: 'daily' as const,
        cycleStart,
        todayStart: Math.max(localMidnight, cycleStart),
        cycleEnd,
      };
    }

    return { kind: 'cycle' as const, cycleStart, cycleEnd };
  });
}

/**
 * Plans one due reminder: whether the stored slot is stale, when the following
 * slot is, and which expense ranges the caller must aggregate for the message.
 */
export function planBudgetReminder(
  budget: ParsedBudgetForReminder,
  nowMs: number,
): ReminderPlan {
  const stale = nowMs - budget.nextReminderAt > STALE_THRESHOLD_MS;
  const nextReminderAt = computeNextReminderAt(
    budget.reminders,
    Math.max(nowMs, budget.nextReminderAt),
  );

  return {
    stale,
    nextReminderAt,
    ranges: computeRanges(budget, nowMs),
  };
}

/** Builds the cycle-style message (also used for a daily budget). */
function buildCycleMessage(
  budget: ParsedBudgetForReminder,
  cycleEnd: number,
  remaining: number,
): { title: string; body: string } {
  if (budget.cadence === 'daily') {
    return buildReminderMessage({
      budgetName: budget.name,
      currency: budget.currency,
      kind: 'today',
      remaining,
    });
  }

  return buildReminderMessage({
    budgetName: budget.name,
    currency: budget.currency,
    kind: 'cycle',
    remaining,
    cycleLastDayLabel: formatCycleLastDayLabel(
      cycleEnd,
      budget.reminders.timeZone,
    ),
  });
}

function syntheticExpense(
  id: string,
  amount: number,
  timestamp: number,
): ExpenseItem {
  return {
    id,
    budgetId: '',
    title: id,
    amount,
    timestamp,
    createdAt: timestamp,
  };
}

/**
 * Builds the notification title/body from pre-aggregated spending sums.
 *
 * For a daily-tracking budget the rolling allowance is recomputed with the
 * real `getDailyAllowanceSummary` helper (using synthetic expenses), so the
 * wording matches what the app shows. If that summary is unavailable the
 * message falls back to whole-cycle wording.
 */
export function buildMessageFromSums(
  budget: ParsedBudgetForReminder,
  ranges: ReminderRanges,
  sums: ReminderSums,
  nowMs: number,
): { title: string; body: string } {
  if (ranges.kind === 'daily') {
    const spentBefore = sums.spentBefore ?? 0;
    const spentToday = sums.spentToday ?? 0;

    const expenses: ExpenseItem[] = [];
    if (spentBefore > 0) {
      expenses.push(syntheticExpense('spent-before', spentBefore, ranges.cycleStart));
    }
    if (spentToday > 0) {
      expenses.push(syntheticExpense('spent-today', spentToday, ranges.todayStart));
    }

    const summary = withTimeZone(budget.reminders.timeZone, () => {
      const window = calculatePeriodWindow(
        { cadence: budget.cadence, periodStartDay: budget.periodStartDay },
        new Date(nowMs),
      );
      return getDailyAllowanceSummary(
        budget.amount,
        window,
        expenses,
        new Date(nowMs),
      );
    });

    if (summary) {
      return buildReminderMessage({
        budgetName: budget.name,
        currency: budget.currency,
        kind: 'today',
        remaining: summary.remainingToday,
      });
    }

    return buildCycleMessage(
      budget,
      ranges.cycleEnd,
      roundToCents(budget.amount - spentBefore - spentToday),
    );
  }

  return buildCycleMessage(
    budget,
    ranges.cycleEnd,
    roundToCents(budget.amount - (sums.spentInCycle ?? 0)),
  );
}

const DELETABLE_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** True when a messaging error means the stored token will never work again. */
export function tokenErrorShouldDelete(code: string | undefined): boolean {
  return typeof code === 'string' && DELETABLE_TOKEN_ERRORS.has(code);
}
