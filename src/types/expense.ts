export type BudgetCadence = 'daily' | 'weekly' | 'monthly';

export type SyncState = 'synced' | 'syncing' | 'local' | 'error';

/**
 * Legacy single-budget settings shape, still stored at `users/{uid}/settings/preference`.
 * Only read during migration to the multi-budget model; new code uses `Budget`.
 */
export interface UserSettings {
  budget: number;
  cadence: BudgetCadence;
  /**
   * - daily: cutoff hour of the day (0..23, e.g., 0 = midnight, 4 = 4:00 AM)
   * - weekly: starting day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
   * - monthly: starting day of month (1..31, automatically clamped to month length)
   */
  periodStartDay: number;
  currency: string;
  updatedAt?: number;
}

/**
 * - recurring: resets every cycle per `cadence`/`periodStartDay`
 * - oneOff: a single budget with no resets, optionally bounded by `startDate`/`endDate`
 */
export type BudgetKind = 'recurring' | 'oneOff';

/** The fields that decide how a budget's period window is calculated. */
export type PeriodConfig = Pick<UserSettings, 'cadence' | 'periodStartDay'> &
  Pick<BudgetInput, 'kind' | 'startDate' | 'endDate'>;

/** Editable fields of a budget, as entered in the budget editor. */
export interface BudgetInput {
  /** Absent on budgets created before one-off budgets existed: treat as 'recurring'. Locked after creation. */
  kind?: BudgetKind;
  /**
   * One-off only: first and last day of the budget, inclusive, as local dates "YYYY-MM-DD".
   * Both set (dated one-off) or both absent (undated one-off). Always absent on recurring budgets.
   */
  startDate?: string;
  endDate?: string;
  name: string;
  /** Spending allowance per period */
  amount: number;
  cadence: BudgetCadence;
  /** Same meaning as `UserSettings.periodStartDay` */
  periodStartDay: number;
  currency: string;
  /**
   * Weekly/monthly only: show a rolling daily allowance,
   * (amount − spent before the day) ÷ days left in the cycle including that day.
   * Absent/false on budgets created before the feature. Ignored for daily cadence.
   */
  dailyTracking?: boolean;
  /** Push reminders to log expenses. Absent on budgets created before the feature. */
  reminders?: BudgetReminders;
}

export interface BudgetReminders {
  enabled: boolean;
  /** Local wall-clock times "HH:mm" on 15-minute steps, sorted, unique, 1..REMINDER_MAX_TIMES */
  times: string[];
  /** IANA time zone the times are in, e.g. "Asia/Singapore" (taken from the device on save) */
  timeZone: string;
}

/** True when `budget` is a one-off budget (missing `kind` means recurring). */
export function isOneOffBudget(budget: Pick<BudgetInput, 'kind'>): boolean {
  return budget.kind === 'oneOff';
}

/** True for a one-off budget with a start and end date. */
export function hasDateRange(
  budget: Pick<BudgetInput, 'kind' | 'startDate' | 'endDate'>,
): boolean {
  return isOneOffBudget(budget) && !!budget.startDate && !!budget.endDate;
}

export const REMINDER_MAX_TIMES = 4;
export const REMINDER_STEP_MINUTES = 15;

export interface Budget extends BudgetInput {
  id: string;
  sortOrder: number;
  createdAt: number;
  updatedAt?: number;
  /**
   * Epoch ms of the next reminder to send (UTC instant). Present only while reminders
   * are enabled; recomputed by the client on save and advanced by the sender function.
   */
  nextReminderAt?: number;
}

/**
 * Push tokens for one user, stored at `users/{uid}/private/push`.
 * Keyed by a short hash of the token so re-registering the same device is idempotent.
 */
export interface PushTokensDoc {
  tokens: Record<string, { token: string; updatedAt: number }>;
}

/** ID given to the budget created from a user's pre-multi-budget settings. */
export const DEFAULT_BUDGET_ID = 'default';
export const BUDGET_NAME_MAX_LENGTH = 40;

export interface ExpenseItem {
  id: string;
  /** The budget this expense counts against */
  budgetId: string;
  title: string;
  amount: number;
  /** Epoch milliseconds of when the expense occurred */
  timestamp: number;
  /** Epoch milliseconds of when the record was created */
  createdAt: number;
  /** True when a specific time of day is recorded; false for whole-day manual date entries */
  hasTime?: boolean;
}

export interface PeriodWindow {
  start: Date;
  end: Date;
  /** e.g., "Oct 1 – Oct 31" or "Today, Oct 14" */
  label: string;
  /** e.g., "Resets in 18 days" or "Resets in 13h 57m" or "Past cycle" */
  countdownLabel: string;
  /** e.g., "Monthly (1st)" or "Weekly (Mon)" or "Daily (12:00 AM)" */
  cadenceLabel: string;
  isCurrent: boolean;
  /** 0 = current active period, -1 = previous period, etc. */
  offset: number;
  /** Present only for one-off budgets. */
  oneOff?: {
    dated: boolean;
    /** dated: relative to startDate/endDate; undated: always 'active' */
    status: 'upcoming' | 'active' | 'ended';
  };
}

export interface DayExpenseGroup {
  dateKey: string;
  label: string;
  subtotal: number;
  items: ExpenseItem[];
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  budget: 150,
  cadence: 'monthly',
  periodStartDay: 1,
  currency: 'USD',
};

export function legacySettingsToBudget(
  settings: UserSettings,
  now: number = Date.now(),
): Budget {
  return {
    id: DEFAULT_BUDGET_ID,
    name: 'Main',
    amount: settings.budget,
    cadence: settings.cadence,
    periodStartDay: settings.periodStartDay,
    currency: settings.currency,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
];
