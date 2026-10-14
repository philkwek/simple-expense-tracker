export type BudgetCadence = 'daily' | 'weekly' | 'monthly';

export type SyncState = 'synced' | 'syncing' | 'local' | 'error';

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

export interface ExpenseItem {
  id: string;
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
