import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../lib/firebase';
import {
  BudgetCadence,
  BudgetReminders,
  DEFAULT_BUDGET_ID,
  DEFAULT_USER_SETTINGS,
  UserProfile,
} from '../types/expense';
import { ensureAccountBudgetsMigrated } from './expenseService';
import { planGuestBudgetMerge } from './budgetMerge';
import type { BudgetDocLike } from './budgetMerge';
import {
  computeNextReminderAt,
  isValidTimeZone,
  normalizeReminderTimes,
} from '../utils/reminders';

const LOCAL_AUTH_STORAGE_KEY = 'ledger_local_user_v1';

/** Firestore allows 500 writes per batch; stay safely under it. */
const MAX_BATCH_OPERATIONS = 400;

type AuthListener = (user: UserProfile) => void;
const localAuthListeners = new Set<AuthListener>();

function getLocalUser(): UserProfile {
  try {
    const raw = localStorage.getItem(LOCAL_AUTH_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as UserProfile;
    }
  } catch {
    // ignore storage errors
  }
  const guest: UserProfile = {
    uid: 'local-guest',
    email: null,
    displayName: null,
    isAnonymous: true,
  };
  saveLocalUser(guest);
  return guest;
}

function saveLocalUser(user: UserProfile): void {
  try {
    localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore storage errors
  }
  localAuthListeners.forEach((cb) => cb(user));
}

function mapFirebaseUser(user: User): UserProfile {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    isAnonymous: user.isAnonymous,
  };
}

function isBudgetCadence(value: unknown): value is BudgetCadence {
  return value === 'daily' || value === 'weekly' || value === 'monthly';
}

function normalizeCadence(value: unknown): BudgetCadence {
  return isBudgetCadence(value) ? value : DEFAULT_USER_SETTINGS.cadence;
}

function normalizeCurrency(value: unknown): string {
  return typeof value === 'string' && value.length === 3
    ? value
    : DEFAULT_USER_SETTINGS.currency;
}

function normalizeTime(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    value &&
    typeof (value as { toMillis?: () => number }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function snapshotToBudgetDocLike(snapshotDoc: {
  id: string;
  data: () => Record<string, unknown>;
}): BudgetDocLike {
  const data = snapshotDoc.data();
  return {
    ...data,
    id: snapshotDoc.id,
    name: typeof data.name === 'string' ? data.name : 'Budget',
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
  };
}

/** Builds the budget that represents a legacy guest's single-budget settings. */
function synthesizeGuestBudget(
  settings: Record<string, unknown> | undefined,
  now: number,
): BudgetDocLike {
  return {
    id: DEFAULT_BUDGET_ID,
    name: 'Main',
    amount:
      typeof settings?.budget === 'number'
        ? settings.budget
        : DEFAULT_USER_SETTINGS.budget,
    cadence: normalizeCadence(settings?.cadence),
    periodStartDay:
      typeof settings?.periodStartDay === 'number'
        ? settings.periodStartDay
        : DEFAULT_USER_SETTINGS.periodStartDay,
    currency: normalizeCurrency(settings?.currency),
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Normalizes a persisted reminders map from a guest budget document, mirroring
 * `normalizeBudgetInput` in expenseService. Returns undefined when the budget never
 * had reminder settings, so the field is omitted rather than written as a default.
 */
function normalizeBudgetReminders(value: unknown): BudgetReminders | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const times = normalizeReminderTimes(data.times);
  return {
    enabled: data.enabled === true && times.length > 0,
    times,
    timeZone: isValidTimeZone(data.timeZone) ? data.timeZone : 'UTC',
  };
}

/**
 * Extracts only the fields allowed by the Firestore budget security rules.
 * Guest docs must never carry extra fields into the permanent user's account.
 */
function budgetDocFields(budget: BudgetDocLike, now: number) {
  const createdAt = normalizeTime(budget.createdAt, now);
  const reminders = normalizeBudgetReminders(budget.reminders);
  const nextReminderAt = computeNextReminderAt(reminders, now);
  return {
    name: budget.name,
    amount:
      typeof budget.amount === 'number' && Number.isFinite(budget.amount)
        ? budget.amount
        : 0,
    cadence: normalizeCadence(budget.cadence),
    periodStartDay:
      typeof budget.periodStartDay === 'number'
        ? budget.periodStartDay
        : DEFAULT_USER_SETTINGS.periodStartDay,
    currency: normalizeCurrency(budget.currency),
    dailyTracking: budget.dailyTracking === true,
    sortOrder: typeof budget.sortOrder === 'number' ? budget.sortOrder : 0,
    createdAt,
    updatedAt: normalizeTime(budget.updatedAt, createdAt),
    ...(reminders ? { reminders } : {}),
    ...(nextReminderAt !== null ? { nextReminderAt } : {}),
  };
}

/**
 * Migrates any guest budgets, expenses and settings from an anonymous user UID to a
 * permanent user UID so signing into an existing account never loses data entered
 * while browsing as a guest.
 */
async function migrateGuestDataInFirestore(
  fromGuestUid: string,
  toPermanentUid: string,
): Promise<void> {
  if (!db || !fromGuestUid || fromGuestUid === toPermanentUid) return;

  try {
    const firestore = db;
    const guestSettingsRef = doc(
      firestore,
      'users',
      fromGuestUid,
      'settings',
      'preference',
    );
    const permSettingsRef = doc(
      firestore,
      'users',
      toPermanentUid,
      'settings',
      'preference',
    );

    // Migrate the account's own legacy data first, so guest budgets are added
    // alongside its 'default' budget instead of standing in for it.
    await ensureAccountBudgetsMigrated(toPermanentUid);

    const [
      guestBudgetsSnap,
      accountBudgetsSnap,
      guestExpensesSnap,
      permSettingsSnap,
      guestSettingsSnap,
    ] = await Promise.all([
      getDocs(collection(firestore, 'users', fromGuestUid, 'budgets')),
      getDocs(collection(firestore, 'users', toPermanentUid, 'budgets')),
      getDocs(collection(firestore, 'users', fromGuestUid, 'expenses')),
      getDoc(permSettingsRef),
      getDoc(guestSettingsRef),
    ]);

    const now = Date.now();
    const accountBudgets = accountBudgetsSnap.docs.map(snapshotToBudgetDocLike);
    let guestBudgets = guestBudgetsSnap.docs.map(snapshotToBudgetDocLike);

    // Legacy guests (pre-multi-budget) have expenses but no budget documents.
    if (guestBudgets.length === 0 && !guestExpensesSnap.empty) {
      guestBudgets = [
        synthesizeGuestBudget(
          guestSettingsSnap.exists()
            ? (guestSettingsSnap.data() as Record<string, unknown>)
            : undefined,
          now,
        ),
      ];
    }

    const { budgetsToWrite, idMap } = planGuestBudgetMerge(
      guestBudgets,
      accountBudgets,
      () => doc(collection(firestore, 'users', toPermanentUid, 'budgets')).id,
    );

    const fallbackBudgetId = budgetsToWrite[0]?.id ?? DEFAULT_BUDGET_ID;
    let batch = writeBatch(firestore);
    let operationsInBatch = 0;

    const flushIfFull = async (): Promise<void> => {
      if (operationsInBatch < MAX_BATCH_OPERATIONS) return;
      await batch.commit();
      batch = writeBatch(firestore);
      operationsInBatch = 0;
    };

    for (const budget of budgetsToWrite) {
      batch.set(
        doc(firestore, 'users', toPermanentUid, 'budgets', budget.id),
        budgetDocFields(budget, now),
      );
      operationsInBatch += 1;
      await flushIfFull();
    }

    for (const expenseDoc of guestExpensesSnap.docs) {
      const data = expenseDoc.data();
      const originalBudgetId =
        typeof data.budgetId === 'string' && data.budgetId.length > 0
          ? data.budgetId
          : DEFAULT_BUDGET_ID;
      const targetBudgetId = idMap[originalBudgetId] ?? fallbackBudgetId;

      batch.set(
        doc(firestore, 'users', toPermanentUid, 'expenses', expenseDoc.id),
        { ...data, budgetId: targetBudgetId },
      );
      operationsInBatch += 1;
      await flushIfFull();

      batch.delete(expenseDoc.ref);
      operationsInBatch += 1;
      await flushIfFull();
    }

    // Guest budget documents are only removed once they have been copied.
    for (const guestBudgetDoc of guestBudgetsSnap.docs) {
      batch.delete(guestBudgetDoc.ref);
      operationsInBatch += 1;
      await flushIfFull();
    }

    if (operationsInBatch > 0) {
      await batch.commit();
    }

    // If the permanent user doesn't have settings yet, copy guest settings.
    if (!permSettingsSnap.exists() && guestSettingsSnap.exists()) {
      await setDoc(permSettingsRef, guestSettingsSnap.data());
    }
  } catch (err) {
    console.warn('Non-fatal guest data migration notice:', err);
  }
}

/**
 * Subscribes to authentication state changes.
 * Automatically initiates an anonymous session when signed out so the user has a zero-friction trial.
 */
export function subscribeToAuth(callback: AuthListener): () => void {
  if (!isFirebaseConfigured || !auth) {
    const initial = getLocalUser();
    callback(initial);
    localAuthListeners.add(callback);
    return () => {
      localAuthListeners.delete(callback);
    };
  }

  let signingInAnon = false;

  const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      callback(mapFirebaseUser(firebaseUser));
      return;
    }

    if (!signingInAnon) {
      signingInAnon = true;
      try {
        await signInAnonymously(auth!);
      } catch (err) {
        console.warn(
          'Anonymous auth unavailable, using local session fallback:',
          err,
        );
        callback(getLocalUser());
      } finally {
        signingInAnon = false;
      }
    }
  });

  return unsubscribe;
}

/**
 * Creates a permanent Email & Password account.
 * If currently signed in as an anonymous guest, links the credential to the existing UID
 * so all Firestore documents under `users/{uid}` remain seamlessly intact.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<UserProfile> {
  const cleanEmail = email.trim();
  const cleanName = displayName?.trim() || null;

  if (!isFirebaseConfigured || !auth) {
    const updated: UserProfile = {
      uid: 'local-guest',
      email: cleanEmail,
      displayName: cleanName || cleanEmail.split('@')[0],
      isAnonymous: false,
    };
    saveLocalUser(updated);
    return updated;
  }

  const currentUser = auth.currentUser;
  let finalUser: User;

  if (currentUser && currentUser.isAnonymous) {
    const credential = EmailAuthProvider.credential(cleanEmail, password);
    try {
      const linked = await linkWithCredential(currentUser, credential);
      finalUser = linked.user;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        throw new Error(
          'An account with this email already exists. Please switch to Sign In.',
        );
      }
      throw new Error(formatAuthError(err));
    }
  } else {
    try {
      const created = await createUserWithEmailAndPassword(
        auth,
        cleanEmail,
        password,
      );
      finalUser = created.user;
    } catch (err) {
      throw new Error(formatAuthError(err));
    }
  }

  if (cleanName) {
    await updateProfile(finalUser, { displayName: cleanName });
  }

  return mapFirebaseUser(finalUser);
}

/**
 * Signs in to an existing Email & Password account, automatically migrating any expenses
 * logged during the current anonymous guest session into the signed-in user's Firestore collection.
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<UserProfile> {
  const cleanEmail = email.trim();

  if (!isFirebaseConfigured || !auth) {
    const existing = getLocalUser();
    const updated: UserProfile = {
      uid: 'local-guest',
      email: cleanEmail,
      displayName: existing.displayName || cleanEmail.split('@')[0],
      isAnonymous: false,
    };
    saveLocalUser(updated);
    return updated;
  }

  const previousGuestUid =
    auth.currentUser && auth.currentUser.isAnonymous
      ? auth.currentUser.uid
      : null;

  try {
    const result = await signInWithEmailAndPassword(auth, cleanEmail, password);
    if (previousGuestUid && previousGuestUid !== result.user.uid) {
      await migrateGuestDataInFirestore(previousGuestUid, result.user.uid);
    }
    return mapFirebaseUser(result.user);
  } catch (err) {
    throw new Error(formatAuthError(err));
  }
}

/**
 * Updates the current user's display name.
 */
export async function updateUserDisplayName(
  displayName: string,
): Promise<UserProfile> {
  const cleanName = displayName.trim();
  if (!isFirebaseConfigured || !auth || !auth.currentUser) {
    const current = getLocalUser();
    const updated: UserProfile = {
      ...current,
      displayName: cleanName || null,
    };
    saveLocalUser(updated);
    return updated;
  }

  await updateProfile(auth.currentUser, { displayName: cleanName });
  return mapFirebaseUser(auth.currentUser);
}

/**
 * Signs out of the permanent account and transitions cleanly to a fresh guest session.
 */
export async function signOutUser(): Promise<void> {
  if (!isFirebaseConfigured || !auth) {
    const guest: UserProfile = {
      uid: 'local-guest',
      email: null,
      displayName: null,
      isAnonymous: true,
    };
    saveLocalUser(guest);
    return;
  }
  await signOut(auth);
}

export function formatAuthError(err: unknown): string {
  const code = (err as { code?: string; message?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect email or password. Please try again.';
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return 'This email is already registered. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return (
        (err as { message?: string })?.message ||
        'Authentication failed. Please try again.'
      );
  }
}
