import {
  DayExpenseGroup,
  ExpenseItem,
  hasDateRange,
  isOneOffBudget,
  PeriodConfig,
  PeriodWindow,
} from '../types/expense';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Returns the number of calendar days in a given (year, monthIndex 0..11).
 */
export function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Clamps a desired day-of-month (1..31) to the actual number of days in (year, monthIndex).
 */
export function getClampedMonthDate(
  year: number,
  monthIndex: number,
  desiredDay: number,
): Date {
  const safeDesired = Math.max(1, Math.min(31, Math.floor(desiredDay || 1)));
  const maxDay = getDaysInMonth(year, monthIndex);
  const actualDay = Math.min(safeDesired, maxDay);
  return new Date(year, monthIndex, actualDay, 0, 0, 0, 0);
}

export function getOrdinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatHourLabel(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h === 0) return 'Midnight (12:00 AM)';
  if (h === 12) return 'Noon (12:00 PM)';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

function formatShortDate(d: Date, includeYear = false): string {
  const base = `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  return includeYear ? `${base}, ${d.getFullYear()}` : base;
}

/** Open-ended upper bound for undated one-off budgets (the maximum JS date). */
export const ONE_OFF_OPEN_END_MS = 8_640_000_000_000_000;

/**
 * Parses a local `YYYY-MM-DD` calendar date into local midnight.
 * Built with `new Date(y, m - 1, d)` so the result never shifts by a UTC offset.
 */
function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatCountdown(now: Date, end: Date, offset: number): string {
  if (offset < 0) {
    return offset === -1 ? 'Previous cycle' : `${Math.abs(offset)} cycles ago`;
  }
  if (offset > 0) {
    return 'Upcoming cycle';
  }
  const diffMs = Math.max(0, end.getTime() - now.getTime());
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);

  if (days >= 2) {
    return `Resets in ${days} days`;
  }
  if (days === 1) {
    const remHours = totalHours % 24;
    return remHours > 0 ? `Resets in 1d ${remHours}h` : 'Resets tomorrow';
  }
  if (totalHours >= 1) {
    const remMins = totalMinutes % 60;
    return `Resets in ${totalHours}h ${remMins}m`;
  }
  return `Resets in ${Math.max(1, totalMinutes)}m`;
}

/**
 * Calculates the exact [start, end) window for the user's budget cadence and cycleOffset.
 *
 * - offset = 0: active cycle containing `now`
 * - offset < 0: past cycles (-1 = immediately preceding cycle, etc.)
 */
export function calculatePeriodWindow(
  settings: PeriodConfig,
  now: Date = new Date(),
  cycleOffset = 0,
): PeriodWindow {
  const { cadence } = settings;

  if (isOneOffBudget(settings)) {
    // One-off budgets never reset: cadence and cycleOffset have no effect.
    if (hasDateRange(settings)) {
      const start = parseLocalDate(settings.startDate!);
      const lastDay = parseLocalDate(settings.endDate!);
      const end = new Date(
        lastDay.getFullYear(),
        lastDay.getMonth(),
        lastDay.getDate() + 1,
      );

      const includeYear =
        start.getFullYear() !== now.getFullYear() ||
        lastDay.getFullYear() !== now.getFullYear();
      const isSingleDay = start.getTime() === lastDay.getTime();
      const label = isSingleDay
        ? formatShortDate(start, start.getFullYear() !== now.getFullYear())
        : `${formatShortDate(start)} – ${formatShortDate(lastDay, includeYear)}`;

      const nowDay = localDayNumber(now);
      const startDay = localDayNumber(start);
      const lastDayNumber = localDayNumber(lastDay);

      let status: 'upcoming' | 'active' | 'ended';
      let countdownLabel: string;
      if (now.getTime() < start.getTime()) {
        status = 'upcoming';
        const daysUntil = startDay - nowDay;
        countdownLabel =
          daysUntil === 1 ? 'Starts tomorrow' : `Starts in ${daysUntil} days`;
      } else if (now.getTime() >= end.getTime()) {
        status = 'ended';
        countdownLabel = 'Ended';
      } else {
        status = 'active';
        const daysLeft = lastDayNumber - nowDay + 1;
        countdownLabel = daysLeft === 1 ? 'Last day' : `${daysLeft} days left`;
      }

      return {
        start,
        end,
        label,
        countdownLabel,
        cadenceLabel: 'One-off',
        isCurrent: true,
        offset: 0,
        oneOff: { dated: true, status },
      };
    }

    return {
      start: new Date(0),
      end: new Date(ONE_OFF_OPEN_END_MS),
      label: 'No end date',
      countdownLabel: 'Ongoing',
      cadenceLabel: 'One-off',
      isCurrent: true,
      offset: 0,
      oneOff: { dated: false, status: 'active' },
    };
  }

  if (cadence === 'daily') {
    const cutoffHour = Math.max(
      0,
      Math.min(23, Math.floor(settings.periodStartDay ?? 0)),
    );
    const todayCutoff = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      cutoffHour,
      0,
      0,
      0,
    );

    const activeStart =
      now.getTime() >= todayCutoff.getTime()
        ? todayCutoff
        : new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 1,
            cutoffHour,
            0,
            0,
            0,
          );

    const start = new Date(
      activeStart.getFullYear(),
      activeStart.getMonth(),
      activeStart.getDate() + cycleOffset,
      cutoffHour,
      0,
      0,
      0,
    );
    const end = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 1,
      cutoffHour,
      0,
      0,
      0,
    );

    const isSameYear = start.getFullYear() === now.getFullYear();
    const label =
      cutoffHour === 0
        ? `${WEEKDAY_SHORT[start.getDay()]}, ${formatShortDate(start, !isSameYear)}`
        : `${formatShortDate(start)} – ${formatShortDate(end)}`;

    return {
      start,
      end,
      label,
      countdownLabel: formatCountdown(now, end, cycleOffset),
      cadenceLabel:
        cutoffHour === 0 ? 'Daily' : `Daily (${formatHourLabel(cutoffHour)})`,
      isCurrent: cycleOffset === 0,
      offset: cycleOffset,
    };
  }

  if (cadence === 'weekly') {
    const startDayOfWeek = Math.max(
      0,
      Math.min(6, Math.floor(settings.periodStartDay ?? 1)),
    );
    const currentDayOfWeek = now.getDay();
    const daysSinceStart = (currentDayOfWeek - startDayOfWeek + 7) % 7;

    const activeStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysSinceStart,
      0,
      0,
      0,
      0,
    );

    const start = new Date(
      activeStart.getFullYear(),
      activeStart.getMonth(),
      activeStart.getDate() + cycleOffset * 7,
      0,
      0,
      0,
      0,
    );
    const end = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 7,
      0,
      0,
      0,
      0,
    );

    const inclusiveEnd = new Date(end.getTime() - 1);
    const includeYear = start.getFullYear() !== now.getFullYear();
    const label = `${formatShortDate(start)} – ${formatShortDate(inclusiveEnd, includeYear)}`;

    return {
      start,
      end,
      label,
      countdownLabel: formatCountdown(now, end, cycleOffset),
      cadenceLabel: `Weekly (${WEEKDAY_SHORT[startDayOfWeek]})`,
      isCurrent: cycleOffset === 0,
      offset: cycleOffset,
    };
  }

  // Default: 'monthly'
  const desiredDay = Math.max(
    1,
    Math.min(31, Math.floor(settings.periodStartDay || 1)),
  );
  const thisMonthAnchor = getClampedMonthDate(
    now.getFullYear(),
    now.getMonth(),
    desiredDay,
  );

  // Determine the (year, month) of the active cycle's start
  let activeYear = now.getFullYear();
  let activeMonth = now.getMonth();

  if (now.getTime() < thisMonthAnchor.getTime()) {
    activeMonth -= 1;
    if (activeMonth < 0) {
      activeMonth = 11;
      activeYear -= 1;
    }
  }

  const targetMonthTotal = activeYear * 12 + activeMonth + cycleOffset;
  const startYear = Math.floor(targetMonthTotal / 12);
  const startMonth = ((targetMonthTotal % 12) + 12) % 12;

  const endMonthTotal = targetMonthTotal + 1;
  const endYear = Math.floor(endMonthTotal / 12);
  const endMonth = ((endMonthTotal % 12) + 12) % 12;

  const start = getClampedMonthDate(startYear, startMonth, desiredDay);
  const end = getClampedMonthDate(endYear, endMonth, desiredDay);

  const inclusiveEnd = new Date(end.getTime() - 1);
  const includeYear =
    start.getFullYear() !== now.getFullYear() ||
    inclusiveEnd.getFullYear() !== now.getFullYear();
  const label = `${formatShortDate(start)} – ${formatShortDate(inclusiveEnd, includeYear)}`;

  return {
    start,
    end,
    label,
    countdownLabel: formatCountdown(now, end, cycleOffset),
    cadenceLabel: `Monthly (${getOrdinalSuffix(desiredDay)})`,
    isCurrent: cycleOffset === 0,
    offset: cycleOffset,
  };
}

/**
 * Returns the range of expenses that count toward a budget.
 *
 * One-off budgets count every expense logged to them, regardless of date, so the
 * range is open-ended. Recurring budgets use the calculated period window.
 */
export function getExpenseQueryRange(
  settings: PeriodConfig,
  window: PeriodWindow,
): { start: Date; end: Date } {
  if (isOneOffBudget(settings)) {
    return { start: new Date(0), end: new Date(ONE_OFF_OPEN_END_MS) };
  }
  return { start: window.start, end: window.end };
}

/**
 * Formats a numeric value in the user's selected currency with tabular precision.
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    const isZeroDecimal = currency === 'JPY';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(safeAmount);
  } catch {
    return `$${safeAmount.toFixed(2)}`;
  }
}

/**
 * Groups expenses by local calendar day (newest day first), computing daily subtotals.
 */
export function groupExpensesByDay(
  expenses: ExpenseItem[],
  now: Date = new Date(),
): DayExpenseGroup[] {
  const sorted = [...expenses].sort((a, b) => b.timestamp - a.timestamp);
  const groupsMap = new Map<string, DayExpenseGroup>();

  const todayStr = toLocalDateKey(now);
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );
  const yesterdayStr = toLocalDateKey(yesterday);

  for (const item of sorted) {
    const d = new Date(item.timestamp);
    const key = toLocalDateKey(d);
    let group = groupsMap.get(key);

    if (!group) {
      let label: string;
      if (key === todayStr) {
        label = 'Today';
      } else if (key === yesterdayStr) {
        label = 'Yesterday';
      } else {
        label = `${WEEKDAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
      }
      group = {
        dateKey: key,
        label,
        subtotal: 0,
        items: [],
      };
      groupsMap.set(key, group);
    }

    group.items.push(item);
    group.subtotal = Math.round((group.subtotal + item.amount) * 100) / 100;
  }

  return Array.from(groupsMap.values());
}

/**
 * Formats a Date as a `YYYY-MM-DD` key in local time.
 * Matches `DayExpenseGroup.dateKey` from {@link groupExpensesByDay}.
 */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Rounds a value to whole cents. */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Coerces a budget amount to a usable non-negative number (NaN/infinity/negatives -> 0). */
function sanitizeBudgetAmount(amount: number): number {
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * Returns a timezone-independent day number for the local Y/M/D of a Date.
 * Built from `Date.UTC` so DST transitions never shift the result by a fraction of a day.
 */
function localDayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}

/**
 * Counts the local calendar days in a period window's `[start, end)` range.
 *
 * Uses calendar arithmetic (UTC-normalized local Y/M/D components) rather than
 * dividing elapsed milliseconds by 86,400,000, so a week spanning a DST change
 * still counts as 7 days. Always returns at least 1.
 */
export function getCycleDayCount(window: PeriodWindow): number {
  const daySpan = Math.round(localDayNumber(window.end) - localDayNumber(window.start));
  return Math.max(1, daySpan);
}

/**
 * Computes the rolling daily allowance for every calendar day of a period window.
 *
 * For a day D: `max(0, amount - spentBefore(D)) / daysLeft(D)`, where
 * `spentBefore(D)` is the total spent in the window before local midnight of D
 * (spending on D itself does not reduce D's allowance) and `daysLeft(D)` counts D
 * and every later day of the window. Values are rounded to cents.
 *
 * Expenses outside `[start, end)` are ignored. Runs in O(days + expenses).
 * Negative or non-finite amounts are treated as 0.
 *
 * With `countEarlierSpending`, expenses timestamped before `window.start` count as
 * already spent on day 1 (e.g. pre-booked flights for a dated one-off budget).
 */
export function computeDailyAllowances(
  amount: number,
  window: PeriodWindow,
  expenses: ExpenseItem[],
  options?: { countEarlierSpending?: boolean },
): Map<string, number> {
  const safeAmount = sanitizeBudgetAmount(amount);
  const dayCount = getCycleDayCount(window);
  const startTime = window.start.getTime();
  const endTime = window.end.getTime();
  const countEarlierSpending = options?.countEarlierSpending === true;

  const spentByDayKey = new Map<string, number>();
  let spentBeforeStart = 0;
  for (const expense of expenses) {
    if (!Number.isFinite(expense.timestamp) || !Number.isFinite(expense.amount)) {
      continue;
    }
    if (expense.timestamp >= endTime) {
      continue;
    }
    if (expense.timestamp < startTime) {
      if (countEarlierSpending) spentBeforeStart += expense.amount;
      continue;
    }
    const key = toLocalDateKey(new Date(expense.timestamp));
    spentByDayKey.set(key, (spentByDayKey.get(key) ?? 0) + expense.amount);
  }

  const allowances = new Map<string, number>();
  const startYear = window.start.getFullYear();
  const startMonth = window.start.getMonth();
  const startDate = window.start.getDate();
  let spentBefore = spentBeforeStart;

  for (let i = 0; i < dayCount; i += 1) {
    const day = new Date(startYear, startMonth, startDate + i);
    const key = toLocalDateKey(day);
    const daysLeft = dayCount - i;
    allowances.set(key, roundToCents(Math.max(0, safeAmount - spentBefore) / daysLeft));
    spentBefore += spentByDayKey.get(key) ?? 0;
  }

  return allowances;
}

/**
 * Summarizes the rolling daily allowance for `now`.
 *
 * Returns `null` when `now` falls outside `[start, end)`. Otherwise reports today's
 * allowance (from {@link computeDailyAllowances}), today's spending, what is left of
 * today's allowance (may be negative), and what is left of the whole cycle (may be negative).
 *
 * `options.countEarlierSpending` mirrors {@link computeDailyAllowances}: spending before
 * `window.start` also reduces `cycleRemaining`.
 */
export function getDailyAllowanceSummary(
  amount: number,
  window: PeriodWindow,
  expenses: ExpenseItem[],
  now: Date = new Date(),
  options?: { countEarlierSpending?: boolean },
): {
  allowance: number;
  spentToday: number;
  remainingToday: number;
  cycleRemaining: number;
} | null {
  const nowTime = now.getTime();
  const startTime = window.start.getTime();
  const endTime = window.end.getTime();

  if (nowTime < startTime || nowTime >= endTime) {
    return null;
  }

  const safeAmount = sanitizeBudgetAmount(amount);
  const allowances = computeDailyAllowances(amount, window, expenses, options);
  const todayKey = toLocalDateKey(now);
  const allowance = allowances.get(todayKey) ?? 0;
  const countEarlierSpending = options?.countEarlierSpending === true;

  let spentToday = 0;
  let spentInWindow = 0;
  for (const expense of expenses) {
    if (!Number.isFinite(expense.timestamp) || !Number.isFinite(expense.amount)) {
      continue;
    }
    if (expense.timestamp >= endTime) {
      continue;
    }
    if (expense.timestamp < startTime) {
      if (countEarlierSpending) spentInWindow += expense.amount;
      continue;
    }
    spentInWindow += expense.amount;
    if (toLocalDateKey(new Date(expense.timestamp)) === todayKey) {
      spentToday += expense.amount;
    }
  }

  return {
    allowance,
    spentToday: roundToCents(spentToday),
    remainingToday: roundToCents(allowance - spentToday),
    cycleRemaining: roundToCents(safeAmount - spentInWindow),
  };
}

/**
 * Converts epoch milliseconds to an HTML `<input type="datetime-local">` value string.
 */
export function toDateTimeLocalValue(timestampMs: number): string {
  const d = new Date(timestampMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Converts epoch milliseconds to an HTML `<input type="date">` value string (`YYYY-MM-DD`).
 */
export function toDateInputValue(timestampMs: number): string {
  const d = new Date(timestampMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts epoch milliseconds to an HTML `<input type="time">` value string (`HH:mm`).
 */
export function toTimeInputValue(timestampMs: number): string {
  const d = new Date(timestampMs);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Combines a `YYYY-MM-DD` date input and an optional `HH:mm` time input into epoch milliseconds.
 * When `timeValue` is omitted/empty (whole-day entry), defaults to 12:00 PM local time on that date
 * so the purchase sits safely inside that calendar day regardless of daily cutoff hours.
 */
export function fromDateAndTimeInputs(
  dateValue: string,
  timeValue?: string,
  fallback = Date.now(),
): number {
  if (!dateValue) return fallback;
  const cleanTime = timeValue && timeValue.trim() ? timeValue.trim() : '12:00';
  const parsed = new Date(`${dateValue}T${cleanTime}`).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parses an HTML `<input type="datetime-local">` string back into epoch milliseconds.
 */
export function fromDateTimeLocalValue(value: string, fallback = Date.now()): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}
