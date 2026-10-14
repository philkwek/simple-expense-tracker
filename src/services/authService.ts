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
import { UserProfile } from '../types/expense';

const LOCAL_AUTH_STORAGE_KEY = 'ledger_local_user_v1';

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

/**
 * Migrates any guest expenses and settings from an anonymous user UID to a permanent user UID
 * so signing into an existing account never loses data entered while browsing as a guest.
 */
async function migrateGuestDataInFirestore(
  fromGuestUid: string,
  toPermanentUid: string,
): Promise<void> {
  if (!db || !fromGuestUid || fromGuestUid === toPermanentUid) return;

  try {
    const guestExpensesSnap = await getDocs(
      collection(db, 'users', fromGuestUid, 'expenses'),
    );
    if (!guestExpensesSnap.empty) {
      const batch = writeBatch(db);
      guestExpensesSnap.forEach((expenseDoc) => {
        const targetRef = doc(
          db!,
          'users',
          toPermanentUid,
          'expenses',
          expenseDoc.id,
        );
        batch.set(targetRef, expenseDoc.data());
        batch.delete(expenseDoc.ref);
      });
      await batch.commit();
    }

    // If permanent user doesn't have settings yet, copy guest settings
    const permSettingsRef = doc(
      db,
      'users',
      toPermanentUid,
      'settings',
      'preference',
    );
    const permSettingsSnap = await getDoc(permSettingsRef);
    if (!permSettingsSnap.exists()) {
      const guestSettingsSnap = await getDoc(
        doc(db, 'users', fromGuestUid, 'settings', 'preference'),
      );
      if (guestSettingsSnap.exists()) {
        await setDoc(permSettingsRef, guestSettingsSnap.data());
      }
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
