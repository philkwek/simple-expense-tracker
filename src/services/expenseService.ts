import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebase';
import {
  Budget,
  BUDGET_NAME_MAX_LENGTH,
  BudgetInput,
  BudgetKind,
  BudgetReminders,
  DEFAULT_BUDGET_ID,
  DEFAULT_USER_SETTINGS,
  ExpenseItem,
  legacySettingsToBudget,
  SyncState,
  UserSettings,
} from '../types/expense';
import {
  computeNextReminderAt,
  isValidTimeZone,
  normalizeReminderTimes,
} from '../utils/reminders';

const LOCAL_SETTINGS_PREFIX = 'ledger_settings_v1_';
const LOCAL_EXPENSES_PREFIX = 'ledger_expenses_v1_';
const LOCAL_BUDGETS_PREFIX = 'ledger_budgets_v1_';
const LOCAL_ACTIVE_BUDGET_PREFIX = 'ledger_active_budget_v1_';

/** Firestore allows 500 writes per batch; stay under it. */
const BATCH_CHUNK_SIZE = 400;

type BudgetsListener = (budgets: Budget[]) => void;
type ExpensesListener = (expenses: ExpenseItem[]) => void;

const localBudgetsListeners = new Map<string, Set<BudgetsListener>>();
const localExpensesListeners = new Map<string, Set<ExpensesListener>>();
const migrationsInFlight = new Map<string, Promise<void>>();

function isLocalMode(userId: string): boolean {
  return !isFirebaseConfigured || !db || userId === 'local-guest';
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

// ---------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------

function normalizeTimestamp(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof (val as Timestamp).toMillis === 'function') {
    return (val as Timestamp).toMillis();
  }
  return Date.now();
}

function isCadence(val: unknown): val is Budget['cadence'] {
  return val === 'daily' || val === 'weekly' || val === 'monthly';
}

function clampPeriodStartDay(cadence: Budget['cadence'], day: number): number {
  const d = Math.floor(Number.isFinite(day) ? day : 0);
  if (cadence === 'daily') return Math.max(0, Math.min(23, d));
  if (cadence === 'weekly') return Math.max(0, Math.min(6, d));
  return Math.max(1, Math.min(31, d));
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as "YYYY-MM-DD". */
function isValidDateKey(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_KEY_PATTERN.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function normalizeBudgetInput(input: BudgetInput): BudgetInput {
  const cadence = isCadence(input.cadence) ? input.cadence : 'monthly';
  const kind: BudgetKind = input.kind === 'oneOff' ? 'oneOff' : 'recurring';

  // One-off dates come as a pair; a lone or invalid date makes the budget undated.
  let startDate: string | undefined;
  let endDate: string | undefined;
  if (kind === 'oneOff' && isValidDateKey(input.startDate) && isValidDateKey(input.endDate)) {
    // "YYYY-MM-DD" strings sort chronologically.
    [startDate, endDate] =
      input.startDate <= input.endDate
        ? [input.startDate, input.endDate]
        : [input.endDate, input.startDate];
  }
  const isUndatedOneOff = kind === 'oneOff' && !startDate;

  const normalized: BudgetInput = {
    kind,
    ...(startDate && endDate ? { startDate, endDate } : {}),
    name: input.name.trim().slice(0, BUDGET_NAME_MAX_LENGTH) || 'Budget',
    amount:
      Number.isFinite(input.amount) && input.amount >= 0
        ? Math.min(100_000_000, Math.round(input.amount * 100) / 100)
        : 0,
    cadence,
    periodStartDay: clampPeriodStartDay(cadence, input.periodStartDay),
    currency:
      typeof input.currency === 'string' && input.currency.length === 3
        ? input.currency
        : DEFAULT_USER_SETTINGS.currency,
    // Recurring: weekly/monthly only. One-off: needs dates to spread the amount over.
    dailyTracking:
      input.dailyTracking === true &&
      (kind === 'oneOff' ? !isUndatedOneOff : cadence !== 'daily'),
  };

  // Undated one-off budgets have no schedule to remind against.
  if (input.reminders && !isUndatedOneOff) {
    const times = normalizeReminderTimes(input.reminders.times);
    normalized.reminders = {
      // A reminder without any valid time can never fire, so it stays disabled.
      enabled: input.reminders.enabled === true && times.length > 0,
      times,
      timeZone: isValidTimeZone(input.reminders.timeZone)
        ? input.reminders.timeZone
        : 'UTC',
    };
  }

  return normalized;
}

function parseLegacySettings(data: Record<string, unknown> | undefined): UserSettings {
  if (!data) return { ...DEFAULT_USER_SETTINGS };
  return {
    budget:
      typeof data.budget === 'number' ? data.budget : DEFAULT_USER_SETTINGS.budget,
    cadence: isCadence(data.cadence) ? data.cadence : DEFAULT_USER_SETTINGS.cadence,
    periodStartDay:
      typeof data.periodStartDay === 'number'
        ? data.periodStartDay
        : DEFAULT_USER_SETTINGS.periodStartDay,
    currency:
      typeof data.currency === 'string' && data.currency.length === 3
        ? data.currency
        : DEFAULT_USER_SETTINGS.currency,
  };
}

function parseReminders(value: unknown): BudgetReminders | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  return {
    enabled: data.enabled === true,
    times: Array.isArray(data.times)
      ? data.times.filter((time): time is string => typeof time === 'string')
      : [],
    timeZone: typeof data.timeZone === 'string' ? data.timeZone : '',
  };
}

function parseBudget(id: string, data: Record<string, unknown>): Budget {
  const reminders = parseReminders(data.reminders);
  const base = normalizeBudgetInput({
    kind: data.kind === 'oneOff' ? 'oneOff' : 'recurring',
    startDate: typeof data.startDate === 'string' ? data.startDate : undefined,
    endDate: typeof data.endDate === 'string' ? data.endDate : undefined,
    name: typeof data.name === 'string' ? data.name : 'Budget',
    amount: typeof data.amount === 'number' ? data.amount : 0,
    cadence: isCadence(data.cadence) ? data.cadence : 'monthly',
    periodStartDay:
      typeof data.periodStartDay === 'number' ? data.periodStartDay : 1,
    currency: typeof data.currency === 'string' ? data.currency : 'USD',
    dailyTracking: data.dailyTracking === true,
    ...(reminders ? { reminders } : {}),
  });
  const budget: Budget = {
    ...base,
    id,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    createdAt: normalizeTimestamp(data.createdAt),
    updatedAt: normalizeTimestamp(data.updatedAt),
  };
  if (
    typeof data.nextReminderAt === 'number' &&
    Number.isFinite(data.nextReminderAt)
  ) {
    budget.nextReminderAt = data.nextReminderAt;
  }
  return budget;
}

function parseExpense(id: string, data: Record<string, unknown>): ExpenseItem {
  return {
    id,
    budgetId:
      typeof data.budgetId === 'string' && data.budgetId.length > 0
        ? data.budgetId
        : DEFAULT_BUDGET_ID,
    title: typeof data.title === 'string' ? data.title : 'Expense',
    amount: typeof data.amount === 'number' ? data.amount : 0,
    timestamp: normalizeTimestamp(data.timestamp),
    createdAt: normalizeTimestamp(data.createdAt),
    hasTime: typeof data.hasTime === 'boolean' ? data.hasTime : true,
  };
}

function sortBudgets(budgets: Budget[]): Budget[] {
  return [...budgets].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
  );
}

function budgetToDoc(budget: Budget) {
  return {
    kind: budget.kind === 'oneOff' ? 'oneOff' : 'recurring',
    ...(budget.startDate && budget.endDate
      ? { startDate: budget.startDate, endDate: budget.endDate }
      : {}),
    name: budget.name,
    amount: budget.amount,
    cadence: budget.cadence,
    periodStartDay: budget.periodStartDay,
    currency: budget.currency,
    dailyTracking: budget.dailyTracking === true,
    sortOrder: budget.sortOrder,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt ?? Date.now(),
    // Budgets are written with setDoc (full overwrite): omitting these keys
    // removes them, which is exactly how disabling reminders works.
    ...(budget.reminders ? { reminders: budget.reminders } : {}),
    ...(typeof budget.nextReminderAt === 'number' &&
    Number.isFinite(budget.nextReminderAt)
      ? { nextReminderAt: budget.nextReminderAt }
      : {}),
  };
}

/**
 * Stores the next reminder instant on a budget, recomputed from its reminders so a
 * stale value is never carried over. Removes the field when reminders cannot fire.
 */
function setNextReminderAt(budget: Budget, now: number): Budget {
  const nextReminderAt = computeNextReminderAt(budget.reminders, now);
  if (nextReminderAt === null) {
    delete budget.nextReminderAt;
  } else {
    budget.nextReminderAt = nextReminderAt;
  }
  return budget;
}

// ---------------------------------------------------------------
// Local (guest / offline) storage
// ---------------------------------------------------------------

function readLocalBudgets(userId: string): Budget[] {
  const raw = readJson<Budget[]>(`${LOCAL_BUDGETS_PREFIX}${userId}`);
  return Array.isArray(raw) ? sortBudgets(raw) : [];
}

function writeLocalBudgets(userId: string, budgets: Budget[], notify = true): void {
  const sorted = sortBudgets(budgets);
  writeJson(`${LOCAL_BUDGETS_PREFIX}${userId}`, sorted);
  if (notify) {
    localBudgetsListeners.get(userId)?.forEach((cb) => cb(sorted));
  }
}

function readLocalExpenses(userId: string): ExpenseItem[] {
  const raw = readJson<Partial<ExpenseItem>[]>(`${LOCAL_EXPENSES_PREFIX}${userId}`);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) =>
    parseExpense(String(item.id ?? ''), item as Record<string, unknown>),
  );
}

function writeLocalExpenses(userId: string, expenses: ExpenseItem[]): void {
  writeJson(`${LOCAL_EXPENSES_PREFIX}${userId}`, expenses);
  localExpensesListeners.get(userId)?.forEach((cb) => cb(expenses));
}

/**
 * Local equivalent of the Firestore migration: turns the legacy single-budget settings
 * into the first budget and tags existing expenses with its ID.
 */
function migrateLocalIfNeeded(userId: string): Budget[] {
  const existing = readLocalBudgets(userId);
  if (existing.length > 0) return existing;

  const legacy = readJson<Record<string, unknown>>(`${LOCAL_SETTINGS_PREFIX}${userId}`);
  const first = legacySettingsToBudget(parseLegacySettings(legacy ?? undefined));
  // readLocalExpenses already defaults a missing budgetId to DEFAULT_BUDGET_ID
  writeJson(`${LOCAL_EXPENSES_PREFIX}${userId}`, readLocalExpenses(userId));
  writeLocalBudgets(userId, [first], false);
  return [first];
}

export function getStoredActiveBudgetId(userId: string): string | null {
  try {
    return localStorage.getItem(`${LOCAL_ACTIVE_BUDGET_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

export function setStoredActiveBudgetId(userId: string, budgetId: string): void {
  try {
    localStorage.setItem(`${LOCAL_ACTIVE_BUDGET_PREFIX}${userId}`, budgetId);
  } catch {
    // ignore storage errors
  }
}

// ---------------------------------------------------------------
// Firestore migration (single budget -> multiple budgets)
// ---------------------------------------------------------------

/**
 * One-time migration for accounts created before multiple budgets existed.
 *
 * 1. Tags every expense that has no `budgetId` with `DEFAULT_BUDGET_ID`.
 * 2. Creates `budgets/default` from the legacy `settings/preference` document.
 *
 * The budget document is written last and is itself the "migration done" marker, so an
 * interrupted run simply runs again. Every write is idempotent.
 */
async function migrateFirestoreToBudgets(userId: string): Promise<void> {
  if (!db) return;
  const firestore = db;

  const prefSnap = await getDoc(
    doc(firestore, 'users', userId, 'settings', 'preference'),
  );
  const legacy = parseLegacySettings(
    prefSnap.exists() ? (prefSnap.data() as Record<string, unknown>) : undefined,
  );

  const expensesSnap = await getDocs(collection(firestore, 'users', userId, 'expenses'));
  const untagged = expensesSnap.docs.filter((d) => {
    const budgetId = d.data().budgetId;
    return typeof budgetId !== 'string' || budgetId.length === 0;
  });

  for (let i = 0; i < untagged.length; i += BATCH_CHUNK_SIZE) {
    const batch = writeBatch(firestore);
    for (const expenseDoc of untagged.slice(i, i + BATCH_CHUNK_SIZE)) {
      batch.update(expenseDoc.ref, { budgetId: DEFAULT_BUDGET_ID });
    }
    await batch.commit();
  }

  const budget = legacySettingsToBudget(legacy);
  await setDoc(
    doc(firestore, 'users', userId, 'budgets', DEFAULT_BUDGET_ID),
    budgetToDoc(budget),
  );
}

/**
 * Makes sure an existing account with legacy (pre-multi-budget) data has been migrated
 * before other budgets are merged into it, e.g. a guest's budgets on sign-in. Without
 * this, the merged budgets would mark the account as migrated and its untagged legacy
 * expenses would never match any budget query. Accounts with no data are left alone.
 */
export async function ensureAccountBudgetsMigrated(userId: string): Promise<void> {
  if (isLocalMode(userId)) return;
  const firestore = db!;
  const [budgetsSnap, prefSnap, expensesSnap] = await Promise.all([
    getDocs(query(collection(firestore, 'users', userId, 'budgets'), limit(1))),
    getDoc(doc(firestore, 'users', userId, 'settings', 'preference')),
    getDocs(query(collection(firestore, 'users', userId, 'expenses'), limit(1))),
  ]);
  if (!budgetsSnap.empty) return;
  if (!prefSnap.exists() && expensesSnap.empty) return;
  await migrateFirestoreToBudgets(userId);
}

function runMigrationOnce(userId: string): Promise<void> {
  const inFlight = migrationsInFlight.get(userId);
  if (inFlight) return inFlight;
  const run = migrateFirestoreToBudgets(userId)
    .catch((err) => {
      console.warn('Budget migration failed; will retry on next load:', err);
    })
    .finally(() => {
      migrationsInFlight.delete(userId);
    });
  migrationsInFlight.set(userId, run);
  return run;
}

// ---------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------

/**
 * Subscribes in real time to `users/{userId}/budgets`, sorted by `sortOrder`.
 * Runs the one-time migration when the user has no budgets yet, so the listener
 * always ends up emitting at least one budget.
 */
export function subscribeToBudgets(
  userId: string,
  onBudgets: (budgets: Budget[]) => void,
  onSyncState?: (state: SyncState) => void,
): () => void {
  if (isLocalMode(userId)) {
    onSyncState?.('local');
    onBudgets(migrateLocalIfNeeded(userId));

    if (!localBudgetsListeners.has(userId)) {
      localBudgetsListeners.set(userId, new Set());
    }
    localBudgetsListeners.get(userId)!.add(onBudgets);
    return () => {
      localBudgetsListeners.get(userId)?.delete(onBudgets);
    };
  }

  const budgetsRef = collection(db!, 'users', userId, 'budgets');

  return onSnapshot(
    budgetsRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      onSyncState?.(snapshot.metadata.hasPendingWrites ? 'syncing' : 'synced');

      if (snapshot.empty) {
        // Only trust "no budgets" when it comes from the server, not an empty cache.
        if (!snapshot.metadata.fromCache) {
          void runMigrationOnce(userId);
        }
        const cached = readLocalBudgets(userId);
        if (cached.length > 0) onBudgets(cached);
        return;
      }

      const budgets = sortBudgets(
        snapshot.docs.map((d) => parseBudget(d.id, d.data())),
      );
      writeLocalBudgets(userId, budgets, false);
      onBudgets(budgets);
    },
    (err) => {
      console.warn('Firestore budgets listener fallback:', err);
      onSyncState?.('local');
      onBudgets(migrateLocalIfNeeded(userId));
    },
  );
}

/** Creates a budget and returns it. It is placed after all existing budgets. */
export async function createBudget(
  userId: string,
  input: BudgetInput,
): Promise<Budget> {
  const now = Date.now();
  const existing = readLocalBudgets(userId);
  const sortOrder =
    existing.reduce((max, b) => Math.max(max, b.sortOrder), -1) + 1;
  const clean = normalizeBudgetInput(input);

  if (isLocalMode(userId)) {
    const budget: Budget = setNextReminderAt(
      {
        ...clean,
        id: `local_b_${now}_${Math.random().toString(36).slice(2, 8)}`,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      },
      now,
    );
    writeLocalBudgets(userId, [...existing, budget]);
    return budget;
  }

  const ref = doc(collection(db!, 'users', userId, 'budgets'));
  const budget: Budget = setNextReminderAt(
    { ...clean, id: ref.id, sortOrder, createdAt: now, updatedAt: now },
    now,
  );
  await setDoc(ref, budgetToDoc(budget));
  return budget;
}

export async function updateBudget(
  userId: string,
  budget: Budget,
  input: BudgetInput,
): Promise<void> {
  const now = Date.now();
  // A budget's kind is locked at creation.
  const merged = normalizeBudgetInput({
    ...input,
    kind: budget.kind === 'oneOff' ? 'oneOff' : 'recurring',
  });
  // `input` may omit reminders, in which case the budget's existing reminders
  // stay in place; nextReminderAt is always recomputed from the merged result.
  const combined: Budget = {
    ...budget,
    ...merged,
    // Dates come only from the new input, so clearing them sticks.
    startDate: merged.startDate,
    endDate: merged.endDate,
    updatedAt: now,
  };
  if (!combined.startDate) delete combined.startDate;
  if (!combined.endDate) delete combined.endDate;
  if (combined.kind === 'oneOff' && !combined.startDate) delete combined.reminders;
  const next = setNextReminderAt(combined, now);

  if (isLocalMode(userId)) {
    writeLocalBudgets(
      userId,
      readLocalBudgets(userId).map((b) => (b.id === budget.id ? next : b)),
    );
    return;
  }

  await setDoc(doc(db!, 'users', userId, 'budgets', budget.id), budgetToDoc(next));
}

/** Number of expenses recorded against a budget, across all periods. */
export async function countBudgetExpenses(
  userId: string,
  budgetId: string,
): Promise<number> {
  if (isLocalMode(userId)) {
    return readLocalExpenses(userId).filter((e) => e.budgetId === budgetId).length;
  }
  const snap = await getCountFromServer(
    query(
      collection(db!, 'users', userId, 'expenses'),
      where('budgetId', '==', budgetId),
    ),
  );
  return snap.data().count;
}

/**
 * Deletes a budget and every expense recorded against it.
 * Callers must not delete the user's last remaining budget.
 */
export async function deleteBudget(userId: string, budgetId: string): Promise<void> {
  if (isLocalMode(userId)) {
    writeLocalExpenses(
      userId,
      readLocalExpenses(userId).filter((e) => e.budgetId !== budgetId),
    );
    writeLocalBudgets(
      userId,
      readLocalBudgets(userId).filter((b) => b.id !== budgetId),
    );
    return;
  }

  const firestore = db!;
  const expensesRef = collection(firestore, 'users', userId, 'expenses');
  // Delete in chunks until nothing is left for this budget.
  for (;;) {
    const snap = await getDocs(
      query(expensesRef, where('budgetId', '==', budgetId), limit(BATCH_CHUNK_SIZE)),
    );
    if (snap.empty) break;
    const batch = writeBatch(firestore);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(firestore, 'users', userId, 'budgets', budgetId));
}

// ---------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------

/**
 * Subscribes in real time to one budget's expenses in `users/{userId}/expenses`
 * where `timestamp >= periodStartMs` and `timestamp < periodEndMs`.
 */
export function subscribeToPeriodExpenses(
  userId: string,
  budgetId: string,
  periodStart: Date,
  periodEnd: Date,
  onExpenses: (expenses: ExpenseItem[]) => void,
  onSyncState?: (state: SyncState) => void,
): () => void {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();

  const filterAndSort = (items: ExpenseItem[]): ExpenseItem[] =>
    items
      .filter(
        (item) =>
          item.budgetId === budgetId &&
          item.timestamp >= startMs &&
          item.timestamp < endMs,
      )
      .sort((a, b) => b.timestamp - a.timestamp || b.createdAt - a.createdAt);

  if (isLocalMode(userId)) {
    onSyncState?.('local');
    const emitLocal = (all: ExpenseItem[]) => {
      onExpenses(filterAndSort(all));
    };
    emitLocal(readLocalExpenses(userId));

    if (!localExpensesListeners.has(userId)) {
      localExpensesListeners.set(userId, new Set());
    }
    localExpensesListeners.get(userId)!.add(emitLocal);
    return () => {
      localExpensesListeners.get(userId)?.delete(emitLocal);
    };
  }

  const q = query(
    collection(db!, 'users', userId, 'expenses'),
    where('budgetId', '==', budgetId),
    where('timestamp', '>=', startMs),
    where('timestamp', '<', endMs),
    orderBy('timestamp', 'desc'),
  );

  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      onSyncState?.(snapshot.metadata.hasPendingWrites ? 'syncing' : 'synced');
      onExpenses(snapshot.docs.map((d) => parseExpense(d.id, d.data())));
    },
    (err) => {
      console.warn('Firestore expenses listener fallback:', err);
      onSyncState?.('local');
      onExpenses(filterAndSort(readLocalExpenses(userId)));
    },
  );
}

/**
 * Logs a new expense against a budget in `users/{userId}/expenses`.
 */
export async function addExpense(
  userId: string,
  input: {
    budgetId: string;
    title: string;
    amount: number;
    timestamp?: number;
    hasTime?: boolean;
  },
): Promise<ExpenseItem> {
  const now = Date.now();
  const cleanTitle = input.title.trim().slice(0, 120) || 'Expense';
  const cleanAmount = Math.max(0, Math.round(input.amount * 100) / 100);
  const timestamp =
    typeof input.timestamp === 'number' && Number.isFinite(input.timestamp)
      ? input.timestamp
      : now;
  const hasTime = typeof input.hasTime === 'boolean' ? input.hasTime : true;

  const payload = {
    budgetId: input.budgetId,
    title: cleanTitle,
    amount: cleanAmount,
    timestamp,
    createdAt: now,
    hasTime,
  };

  if (isLocalMode(userId)) {
    const newItem: ExpenseItem = {
      id: `local_${now}_${Math.random().toString(36).slice(2, 8)}`,
      ...payload,
    };
    writeLocalExpenses(userId, [newItem, ...readLocalExpenses(userId)]);
    return newItem;
  }

  const docRef = await addDoc(collection(db!, 'users', userId, 'expenses'), payload);
  return { id: docRef.id, ...payload };
}

export interface ExpenseUpdateEntry {
  id: string;
  title: string;
  amount: number;
  timestamp: number;
  hasTime?: boolean;
}

/**
 * Updates an existing expense in `users/{userId}/expenses/{expenseId}`.
 */
export async function updateExpense(
  userId: string,
  expenseId: string,
  updates: {
    title: string;
    amount: number;
    timestamp: number;
    hasTime?: boolean;
  },
): Promise<void> {
  await batchUpdateExpenses(userId, [{ id: expenseId, ...updates }]);
}

/**
 * Commits multiple expense edits in a single atomic Firestore writeBatch call.
 * An expense's `budgetId` is never changed by an edit.
 */
export async function batchUpdateExpenses(
  userId: string,
  updates: ExpenseUpdateEntry[],
): Promise<void> {
  if (updates.length === 0) return;

  const normalized = updates.map((u) => ({
    id: u.id,
    title: u.title.trim().slice(0, 120) || 'Expense',
    amount: Math.max(0, Math.round(u.amount * 100) / 100),
    timestamp: Math.floor(u.timestamp),
    hasTime: typeof u.hasTime === 'boolean' ? u.hasTime : true,
  }));

  if (isLocalMode(userId)) {
    const updateMap = new Map(normalized.map((u) => [u.id, u]));
    const next = readLocalExpenses(userId).map((item) => {
      const match = updateMap.get(item.id);
      return match
        ? {
            ...item,
            title: match.title,
            amount: match.amount,
            timestamp: match.timestamp,
            hasTime: match.hasTime,
          }
        : item;
    });
    writeLocalExpenses(userId, next);
    return;
  }

  const batch = writeBatch(db!);
  for (const item of normalized) {
    batch.update(doc(db!, 'users', userId, 'expenses', item.id), {
      title: item.title,
      amount: item.amount,
      timestamp: item.timestamp,
      hasTime: item.hasTime,
    });
  }
  await batch.commit();
}

/**
 * Deletes an expense from `users/{userId}/expenses/{expenseId}`.
 */
export async function deleteExpense(
  userId: string,
  expenseId: string,
): Promise<void> {
  if (isLocalMode(userId)) {
    writeLocalExpenses(
      userId,
      readLocalExpenses(userId).filter((item) => item.id !== expenseId),
    );
    return;
  }

  await deleteDoc(doc(db!, 'users', userId, 'expenses', expenseId));
}

/**
 * Restores a recently deleted expense with its original ID, budget and timestamps
 * (Apple Forgiveness Pattern §16).
 */
export async function restoreExpense(
  userId: string,
  item: ExpenseItem,
): Promise<void> {
  if (isLocalMode(userId)) {
    const existing = readLocalExpenses(userId).filter((e) => e.id !== item.id);
    writeLocalExpenses(userId, [item, ...existing]);
    return;
  }

  await setDoc(doc(db!, 'users', userId, 'expenses', item.id), {
    budgetId: item.budgetId,
    title: item.title.trim().slice(0, 120) || 'Expense',
    amount: Math.max(0, Math.round(item.amount * 100) / 100),
    timestamp: Math.floor(item.timestamp),
    createdAt: Math.floor(item.createdAt),
    hasTime: typeof item.hasTime === 'boolean' ? item.hasTime : true,
  });
}
