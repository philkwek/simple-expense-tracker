import {
  REMINDER_MAX_TIMES,
  REMINDER_STEP_MINUTES,
  type BudgetReminders,
} from '../types/expense';
import { formatCurrency } from './periodCalculator';

/** Every wall-clock time that can be selected for a reminder, in ascending order. */
export const REMINDER_TIME_OPTIONS: readonly string[] = (() => {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += REMINDER_STEP_MINUTES) {
      options.push(
        `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      );
    }
  }
  return options;
})();

const REMINDER_TIME_PATTERN = /^\d{2}:\d{2}$/;
const TIME_ZONE_MAX_LENGTH = 64;

/**
 * Returns true when `t` is a valid reminder time: `"HH:mm"` on a
 * {@link REMINDER_STEP_MINUTES}-minute step, between 00:00 and 23:45.
 */
export function isValidReminderTime(t: unknown): t is string {
  if (typeof t !== 'string' || !REMINDER_TIME_PATTERN.test(t)) return false;
  const hours = Number(t.slice(0, 2));
  const minutes = Number(t.slice(3, 5));
  return (
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes < 60 &&
    minutes % REMINDER_STEP_MINUTES === 0
  );
}

/**
 * Cleans a persisted reminder-time list: drops invalid entries, removes
 * duplicates, sorts ascending and keeps only the earliest
 * {@link REMINDER_MAX_TIMES} entries. Anything that is not an array yields `[]`.
 */
export function normalizeReminderTimes(times: unknown): string[] {
  if (!Array.isArray(times)) return [];
  const unique = new Set<string>();
  for (const entry of times) {
    if (isValidReminderTime(entry)) unique.add(entry);
  }
  return Array.from(unique)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, REMINDER_MAX_TIMES);
}

/**
 * Formats a `"HH:mm"` reminder time as a 12-hour label, e.g. `"20:00"` → `"8:00 PM"`.
 * Invalid input is returned unchanged.
 */
export function formatReminderTime(t: string): string {
  if (!isValidReminderTime(t)) return t;
  const hours = Number(t.slice(0, 2));
  const minutes = t.slice(3, 5);
  const period = hours < 12 ? 'AM' : 'PM';
  const hour12 = ((hours + 11) % 12) + 1;
  return `${hour12}:${minutes} ${period}`;
}

/**
 * Returns true when `tz` is a usable IANA time zone name: a non-empty string of
 * at most 64 characters that `Intl.DateTimeFormat` accepts.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > TIME_ZONE_MAX_LENGTH) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Reads the local wall-clock components of `epochMs` in `timeZone` using `Intl`.
 * Hours are reported in the 0–23 range (ICU can emit "24" for midnight).
 */
function getWallTimeParts(epochMs: number, timeZone: string): WallTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

/**
 * Returns the offset of `timeZone` from UTC at `epochMs`, in minutes
 * (positive east of UTC), e.g. `480` for Asia/Singapore.
 */
export function getTimeZoneOffsetMinutes(epochMs: number, timeZone: string): number {
  const parts = getWallTimeParts(epochMs, timeZone);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((wallAsUtc - epochMs) / 60000);
}

/** True when `epochMs` renders as exactly the supplied wall-clock time in `timeZone`. */
function matchesWallTime(
  epochMs: number,
  year: number,
  month1to12: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): boolean {
  const parts = getWallTimeParts(epochMs, timeZone);
  return (
    parts.year === year &&
    parts.month === month1to12 &&
    parts.day === day &&
    parts.hour === hour &&
    parts.minute === minute
  );
}

/**
 * Converts a local wall-clock time in `timeZone` to a UTC epoch in milliseconds.
 *
 * Uses a two-pass offset correction. For a time that does not exist because of a
 * spring-forward gap, returns the instant one offset change later (e.g. 02:30
 * becomes 03:30 local). For an ambiguous fall-back time, returns the earlier of
 * the two matching instants.
 */
export function zonedWallTimeToEpoch(
  year: number,
  month1to12: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wallAsUtc = Date.UTC(year, month1to12 - 1, day, hour, minute, 0, 0);

  const firstOffset = getTimeZoneOffsetMinutes(wallAsUtc, timeZone);
  const firstCandidate = wallAsUtc - firstOffset * 60000;

  const secondOffset = getTimeZoneOffsetMinutes(firstCandidate, timeZone);
  const secondCandidate = wallAsUtc - secondOffset * 60000;

  const firstMatches = matchesWallTime(
    firstCandidate,
    year,
    month1to12,
    day,
    hour,
    minute,
    timeZone,
  );
  const secondMatches = matchesWallTime(
    secondCandidate,
    year,
    month1to12,
    day,
    hour,
    minute,
    timeZone,
  );

  if (firstMatches && secondMatches) {
    return Math.min(firstCandidate, secondCandidate);
  }
  if (firstMatches) return firstCandidate;
  if (secondMatches) return secondCandidate;
  // The requested wall time falls in a DST gap; both candidates are on either
  // side of the jump. The later instant is the one shifted forward past the gap.
  return Math.max(firstCandidate, secondCandidate);
}

/** Parsed local calendar date, used for one-off reminder bounds. */
interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

/** Parses a strict `"YYYY-MM-DD"` calendar date, returning `null` when invalid. */
function parseLocalDateParts(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** UTC-normalized day number for local Y/M/D parts (DST-safe). */
function localDayNumber(parts: LocalDateParts): number {
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

/** Converts a UTC-normalized day number back to local Y/M/D parts. */
function localDatePartsFromDayNumber(dayNumber: number): LocalDateParts {
  const date = new Date(dayNumber * 86400000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * Computes the next reminder instant strictly after `afterMs` for one budget.
 *
 * Returns `null` when reminders are missing/disabled, contain no valid times, or
 * name an invalid time zone. Calendar days are stepped in the target zone, so the
 * result stays correct across DST changes.
 *
 * With `dateRange`, only reminder instants whose local date in the budget's time
 * zone falls within `[startDate, endDate]` (inclusive, both `"YYYY-MM-DD"`) are
 * returned. The search starts at `startDate` even when `afterMs` is earlier, and
 * returns `null` once no slot remains on or before `endDate`.
 */
export function computeNextReminderAt(
  reminders: BudgetReminders | undefined | null,
  afterMs: number,
  dateRange?: { startDate: string; endDate: string },
): number | null {
  if (!reminders || !reminders.enabled) return null;

  const times = normalizeReminderTimes(reminders.times);
  if (times.length === 0) return null;

  const timeZone = reminders.timeZone;
  if (!isValidTimeZone(timeZone)) return null;

  const start = getWallTimeParts(afterMs, timeZone);
  const startDayNumber = localDayNumber(start);

  if (dateRange) {
    const rangeStart = parseLocalDateParts(dateRange.startDate);
    const rangeEnd = parseLocalDateParts(dateRange.endDate);
    if (!rangeStart || !rangeEnd) return null;

    const rangeStartDay = localDayNumber(rangeStart);
    const rangeEndDay = localDayNumber(rangeEnd);
    if (rangeEndDay < rangeStartDay) return null;

    // Start on the later of "today" and the range start, so a reminder weeks in
    // the future is still found (the recurring 3-day lookahead does not apply).
    const firstDay = Math.max(startDayNumber, rangeStartDay);
    for (let dayNumber = firstDay; dayNumber <= rangeEndDay; dayNumber += 1) {
      const day = localDatePartsFromDayNumber(dayNumber);
      let earliest: number | null = null;
      for (const time of times) {
        const hour = Number(time.slice(0, 2));
        const minute = Number(time.slice(3, 5));
        const candidate = zonedWallTimeToEpoch(
          day.year,
          day.month,
          day.day,
          hour,
          minute,
          timeZone,
        );
        if (candidate <= afterMs) continue;
        // Guard against DST gaps at midnight shifting the instant to another day.
        const candidateDay = localDayNumber(
          getWallTimeParts(candidate, timeZone),
        );
        if (candidateDay < rangeStartDay || candidateDay > rangeEndDay) continue;
        if (earliest === null || candidate < earliest) earliest = candidate;
      }
      if (earliest !== null) return earliest;
    }
    return null;
  }

  let next: number | null = null;
  // Check today plus up to three local days ahead. One day is normally enough,
  // but the extra window is cheap insurance around DST and date-line shifts.
  for (let dayOffset = 0; dayOffset <= 3; dayOffset += 1) {
    const shifted = new Date(
      Date.UTC(start.year, start.month - 1, start.day + dayOffset),
    );
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth() + 1;
    const day = shifted.getUTCDate();

    for (const time of times) {
      const hour = Number(time.slice(0, 2));
      const minute = Number(time.slice(3, 5));
      const candidate = zonedWallTimeToEpoch(year, month, day, hour, minute, timeZone);
      if (candidate > afterMs && (next === null || candidate < next)) {
        next = candidate;
      }
    }
  }

  return next;
}

/**
 * Builds the push-notification title and body for a budget reminder.
 * Negative `remaining` values mean the budget is over; amounts within half a
 * cent of zero are treated as zero. `isOneOff` drops the "this cycle" wording
 * from the over-budget message, since one-off budgets never reset.
 */
export function buildReminderMessage(input: {
  budgetName: string;
  currency: string;
  kind: 'today' | 'cycle';
  remaining: number;
  cycleLastDayLabel?: string;
  isOneOff?: boolean;
}): { title: string; body: string } {
  const { budgetName, currency, kind, remaining, cycleLastDayLabel, isOneOff } = input;
  const absolute = Math.abs(remaining);
  const isZero = absolute < 0.005;
  const effectiveRemaining = isZero ? 0 : remaining;
  const money = formatCurrency(isZero ? 0 : absolute, currency);
  const title = budgetName + " budget reminder";

  if (kind === 'today') {
    const body =
      effectiveRemaining >= 0
        ? `You have ${money} remaining in your budget today. Anything to log?`
        : `You spent ${money} over today's budget. Anything to log?`;
    return { title, body };
  }

  if (effectiveRemaining >= 0) {
    const body = cycleLastDayLabel
      ? `${money} left until ${cycleLastDayLabel}. Anything to log?`
      : `${money} left this cycle. Anything to log?`;
    return { title, body };
  }

  if (isOneOff) {
    return {
      title,
      body: `${money} over budget. Anything to log?`,
    };
  }

  return {
    title,
    body: `${money} over budget this cycle. Anything to log?`,
  };
}

/**
 * Formats the last calendar day of a cycle as e.g. `"Nov 30"` in `timeZone`.
 * `cycleEndExclusiveMs` is the exclusive end of the cycle.
 */
export function formatCycleLastDayLabel(
  cycleEndExclusiveMs: number,
  timeZone: string,
): string {
  const lastInstant = cycleEndExclusiveMs - 1;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(lastInstant));
}
