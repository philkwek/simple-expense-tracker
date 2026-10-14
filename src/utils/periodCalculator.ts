import {
  DayExpenseGroup,
  ExpenseItem,
  PeriodWindow,
  UserSettings,
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
  settings: UserSettings,
  now: Date = new Date(),
  cycleOffset = 0,
): PeriodWindow {
  const { cadence } = settings;

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

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
 * Parses an HTML `<input type="datetime-local">` string back into epoch milliseconds.
 */
export function fromDateTimeLocalValue(value: string, fallback = Date.now()): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}
