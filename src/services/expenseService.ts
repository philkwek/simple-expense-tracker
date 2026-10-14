import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebase';
import {
  DEFAULT_USER_SETTINGS,
  ExpenseItem,
  SyncState,
  UserSettings,
} from '../types/expense';

const LOCAL_SETTINGS_PREFIX = 'ledger_settings_v1_';
const LOCAL_EXPENSES_PREFIX = 'ledger_expenses_v1_';

type SettingsListener = (settings: UserSettings) => void;
type ExpensesListener = (expenses: ExpenseItem[]) => void;

const localSettingsListeners = new Map<string, Set<SettingsListener>>();
const localExpensesListeners = new Map<string, Set<ExpensesListener>>();

function readLocalSettings(userId: string): UserSettings {
  try {
    const raw = localStorage.getItem(`${LOCAL_SETTINGS_PREFIX}${userId}`);
    if (raw) {
      return { ...DEFAULT_USER_SETTINGS, ...(JSON.parse(raw) as Partial<UserSettings>) };
    }
  } catch {
    // ignore storage errors
  }
  return { ...DEFAULT_USER_SETTINGS };
}

function writeLocalSettings(userId: string, settings: UserSettings): void {
  try {
    localStorage.setItem(
      `${LOCAL_SETTINGS_PREFIX}${userId}`,
      JSON.stringify(settings),
    );
  } catch {
    // ignore storage errors
  }
  const set = localSettingsListeners.get(userId);
  if (set) {
    set.forEach((cb) => cb(settings));
  }
}

function readLocalExpenses(userId: string): ExpenseItem[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_EXPENSES_PREFIX}${userId}`);
    if (raw) {
      return JSON.parse(raw) as ExpenseItem[];
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

function writeLocalExpenses(userId: string, expenses: ExpenseItem[]): void {
  try {
    localStorage.setItem(
      `${LOCAL_EXPENSES_PREFIX}${userId}`,
      JSON.stringify(expenses),
    );
  } catch {
    // ignore storage errors
  }
  const set = localExpensesListeners.get(userId);
  if (set) {
    set.forEach((cb) => cb(expenses));
  }
}

function normalizeTimestamp(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof (val as Timestamp).toMillis === 'function') {
    return (val as Timestamp).toMillis();
  }
  return Date.now();
}

/**
 * Subscribes in real time to `users/{userId}/settings/preference` on Cloud Firestore.
 * Automatically seeds default settings if the document does not exist yet.
 */
export function subscribeToSettings(
  userId: string,
  onSettings: (settings: UserSettings) => void,
  onSyncState?: (state: SyncState) => void,
): () => void {
  if (!isFirebaseConfigured || !db || userId === 'local-guest') {
    onSyncState?.('local');
    const initial = readLocalSettings(userId);
    onSettings(initial);

    if (!localSettingsListeners.has(userId)) {
      localSettingsListeners.set(userId, new Set());
    }
    localSettingsListeners.get(userId)!.add(onSettings);
    return () => {
      localSettingsListeners.get(userId)?.delete(onSettings);
    };
  }

  const prefRef = doc(db, 'users', userId, 'settings', 'preference');

  const unsubscribe = onSnapshot(
    prefRef,
    { includeMetadataChanges: true },
    async (snap) => {
      onSyncState?.(snap.metadata.hasPendingWrites ? 'syncing' : 'synced');

      if (snap.exists()) {
        const data = snap.data();
        const settings: UserSettings = {
          budget:
            typeof data.budget === 'number'
              ? data.budget
              : DEFAULT_USER_SETTINGS.budget,
          cadence:
            data.cadence === 'daily' ||
            data.cadence === 'weekly' ||
            data.cadence === 'monthly'
              ? data.cadence
              : DEFAULT_USER_SETTINGS.cadence,
          periodStartDay:
            typeof data.periodStartDay === 'number'
              ? data.periodStartDay
              : DEFAULT_USER_SETTINGS.periodStartDay,
          currency:
            typeof data.currency === 'string' && data.currency.length === 3
              ? data.currency
              : DEFAULT_USER_SETTINGS.currency,
          updatedAt: normalizeTimestamp(data.updatedAt),
        };
        writeLocalSettings(userId, settings);
        onSettings(settings);
      } else {
        onSettings(DEFAULT_USER_SETTINGS);
        try {
          await setDoc(prefRef, {
            ...DEFAULT_USER_SETTINGS,
            updatedAt: Date.now(),
          });
        } catch {
          // ignore if initial seed races with auth state
        }
      }
    },
    (err) => {
      console.warn('Firestore settings listener fallback:', err);
      onSyncState?.('local');
      onSettings(readLocalSettings(userId));
    },
  );

  return unsubscribe;
}

/**
 * Updates `users/{userId}/settings/preference` in Cloud Firestore.
 */
export async function updateUserSettings(
  userId: string,
  partial: Partial<UserSettings>,
): Promise<void> {
  const current = readLocalSettings(userId);
  const next: UserSettings = {
    budget:
      typeof partial.budget === 'number' && partial.budget >= 0
        ? Math.round(partial.budget * 100) / 100
        : current.budget,
    cadence: partial.cadence ?? current.cadence,
    periodStartDay:
      typeof partial.periodStartDay === 'number'
        ? Math.max(0, Math.min(31, Math.floor(partial.periodStartDay)))
        : current.periodStartDay,
    currency: partial.currency ?? current.currency,
    updatedAt: Date.now(),
  };

  writeLocalSettings(userId, next);

  if (!isFirebaseConfigured || !db || userId === 'local-guest') {
    return;
  }

  const prefRef = doc(db, 'users', userId, 'settings', 'preference');
  await setDoc(prefRef, {
    budget: next.budget,
    cadence: next.cadence,
    periodStartDay: next.periodStartDay,
    currency: next.currency,
    updatedAt: next.updatedAt,
  });
}

/**
 * Subscribes in real time to period-bound expenses in `users/{userId}/expenses`
 * where `timestamp >= periodStartMs` and `timestamp < periodEndMs`.
 */
export function subscribeToPeriodExpenses(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  onExpenses: (expenses: ExpenseItem[]) => void,
  onSyncState?: (state: SyncState) => void,
): () => void {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();

  const filterAndSort = (items: ExpenseItem[]): ExpenseItem[] =>
    items
      .filter((item) => item.timestamp >= startMs && item.timestamp < endMs)
      .sort((a, b) => b.timestamp - a.timestamp || b.createdAt - a.createdAt);

  if (!isFirebaseConfigured || !db || userId === 'local-guest') {
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

  const expensesRef = collection(db, 'users', userId, 'expenses');
  const q = query(
    expensesRef,
    where('timestamp', '>=', startMs),
    where('timestamp', '<', endMs),
    orderBy('timestamp', 'desc'),
  );

  const unsubscribe = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      onSyncState?.(snapshot.metadata.hasPendingWrites ? 'syncing' : 'synced');
      const items: ExpenseItem[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          title: typeof data.title === 'string' ? data.title : 'Expense',
          amount: typeof data.amount === 'number' ? data.amount : 0,
          timestamp: normalizeTimestamp(data.timestamp),
          createdAt: normalizeTimestamp(data.createdAt),
          hasTime: typeof data.hasTime === 'boolean' ? data.hasTime : true,
        });
      });
      onExpenses(items);
    },
    (err) => {
      console.warn('Firestore expenses listener fallback:', err);
      onSyncState?.('local');
      onExpenses(filterAndSort(readLocalExpenses(userId)));
    },
  );

  return unsubscribe;
}

/**
 * Logs a new expense to `users/{userId}/expenses` in Cloud Firestore.
 */
export async function addExpense(
  userId: string,
  input: {
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

  if (!isFirebaseConfigured || !db || userId === 'local-guest') {
    const newItem: ExpenseItem = {
      id: `local_${now}_${Math.random().toString(36).slice(2, 8)}`,
      title: cleanTitle,
      amount: cleanAmount,
      timestamp,
      createdAt: now,
      hasTime,
    };
    const existing = readLocalExpenses(userId);
    writeLocalExpenses(userId, [newItem, ...existing]);
    return newItem;
  }

  const payload = {
    title: cleanTitle,
    amount: cleanAmount,
    timestamp,
    createdAt: now,
    hasTime,
  };

  const docRef = await addDoc(
    collection(db, 'users', userId, 'expenses'),
    payload,
  );
  return {
    id: docRef.id,
    ...payload,
  };
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
  const cleanTitle = updates.title.trim().slice(0, 120) || 'Expense';
  const cleanAmount = Math.max(0, Math.round(updates.amount * 100) / 100);
  const cleanTimestamp = Math.floor(updates.timestamp);
  const cleanHasTime =
    typeof updates.hasTime === 'boolean' ? updates.hasTime : true;

  if (!isFirebaseConfigured || !db || userId === 'local-guest') {
    const existing = readLocalExpenses(userId);
    const next = existing.map((item) =>
      item.id === expenseId
        ? {
            ...item,
            title: cleanTitle,
            amount: cleanAmount,
            timestamp: cleanTimestamp,
            hasTime: cleanHasTime,
          }
        : item,
    );
    writeLocalExpenses(userId, next);
    return;
  }

  const expenseRef = doc(db, 'users', userId, 'expenses', expenseId);
  await updateDoc(expenseRef, {
    title: cleanTitle,
    amount: cleanAmount,
    timestamp: cleanTimestamp,
    hasTime: cleanHasTime,
  });
}

/**
 * Deletes an expense from `users/{userId}/expenses/{expenseId}`.
 */
export async function deleteExpense(
  userId: string,
  expenseId: string,
): Promise<void> {
  if (!isFirebaseConfigured || !db || userId === 'local-guest') {
    const existing = readLocalExpenses(userId);
    writeLocalExpenses(
      userId,
      existing.filter((item) => item.id !== expenseId),
    );
    return;
  }

  const expenseRef = doc(db, 'users', userId, 'expenses', expenseId);
  await deleteDoc(expenseRef);
}

/**
 * Restores a recently deleted expense with its original ID and timestamps (Apple Forgiveness Pattern §16).
 */
export async function restoreExpense(
  userId: string,
  item: ExpenseItem,
): Promise<void> {
  if (!isFirebaseConfigured || !db || userId === 'local-guest') {
    const existing = readLocalExpenses(userId).filter((e) => e.id !== item.id);
    writeLocalExpenses(userId, [item, ...existing]);
    return;
  }

  const expenseRef = doc(db, 'users', userId, 'expenses', item.id);
  await setDoc(expenseRef, {
    title: item.title.trim().slice(0, 120) || 'Expense',
    amount: Math.max(0, Math.round(item.amount * 100) / 100),
    timestamp: Math.floor(item.timestamp),
    createdAt: Math.floor(item.createdAt),
    hasTime: typeof item.hasTime === 'boolean' ? item.hasTime : true,
  });
}
