import { deleteField, doc, setDoc } from 'firebase/firestore';
import { app, db, isFirebaseConfigured } from '../lib/firebase';

export type ReminderSupport =
  | 'supported'
  | 'needs-install'
  | 'unsupported'
  | 'unavailable';

type EnablePushResult = 'granted' | 'denied' | 'unsupported' | 'error';

const PUSH_TOKEN_CACHE_PREFIX = 'ledger:pushToken:';
const TOKEN_ID_LENGTH = 24;
const SERVICE_WORKER_URL = '/sw.js';

/**
 * The VAPID key is required both to obtain a token and to judge whether push can
 * work at all. An empty value means the deployment has not enabled Web Push.
 */
function getVapidKey(): string {
  const key = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  return typeof key === 'string' ? key.trim() : '';
}

/**
 * Reasons no push token can exist that are cheap to check without touching the
 * messaging SDK: Firebase isn't configured, there is no Firestore handle, this is
 * the local-only guest session, or Web Push has no VAPID key.
 */
function isPushUnavailable(userId: string): boolean {
  return (
    !isFirebaseConfigured ||
    !app ||
    !db ||
    userId === 'local-guest' ||
    getVapidKey().length === 0
  );
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports itself as desktop Safari.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  ) {
    return true;
  }
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function hasMessagingApis(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'PushManager' in window
  );
}

/** Loads the messaging SDK lazily so it stays out of the main bundle. */
async function isMessagingSupported(): Promise<boolean> {
  try {
    const { isSupported } = await import('firebase/messaging');
    return await isSupported();
  } catch {
    return false;
  }
}

export async function getReminderSupport(
  userId: string,
): Promise<ReminderSupport> {
  if (isPushUnavailable(userId)) return 'unavailable';
  // iOS only exposes PushManager once the app is installed to the home screen.
  if (isIosDevice() && !isStandaloneDisplay()) return 'needs-install';
  if (!hasMessagingApis()) return 'unsupported';
  return (await isMessagingSupported()) ? 'supported' : 'unsupported';
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

function readCachedToken(userId: string): string | null {
  try {
    return localStorage.getItem(`${PUSH_TOKEN_CACHE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function writeCachedToken(userId: string, token: string): void {
  try {
    localStorage.setItem(`${PUSH_TOKEN_CACHE_PREFIX}${userId}`, token);
  } catch {
    // Ignore storage errors: the token is still saved in Firestore.
  }
}

/** First 24 hex characters of SHA-256(token), used as the map key in Firestore. */
async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, TOKEN_ID_LENGTH);
}

/**
 * Persists a token under `users/{uid}/private/push`, keyed by its hash. Replaces
 * the previous token for this device in the same write so rotations don't pile up.
 */
async function savePushToken(userId: string, token: string): Promise<void> {
  const tokenId = await hashToken(token);
  const cachedToken = readCachedToken(userId);
  if (cachedToken === token) return;

  const firestore = db;
  if (!firestore) throw new Error('Firestore is not available');

  const tokens: Record<string, unknown> = {
    [tokenId]: { token, updatedAt: Date.now() },
  };
  if (cachedToken) {
    const cachedId = await hashToken(cachedToken);
    if (cachedId !== tokenId) {
      tokens[cachedId] = deleteField();
    }
  }

  await setDoc(
    doc(firestore, 'users', userId, 'private', 'push'),
    { tokens },
    { merge: true },
  );
  writeCachedToken(userId, token);
}

async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: '/',
  });
  await navigator.serviceWorker.ready;
  return registration;
}

async function fetchPushToken(
  registration: ServiceWorkerRegistration,
): Promise<string | null> {
  const firebaseApp = app;
  if (!firebaseApp) return null;
  const { getMessaging, getToken } = await import('firebase/messaging');
  const token = await getToken(getMessaging(firebaseApp), {
    vapidKey: getVapidKey(),
    serviceWorkerRegistration: registration,
  });
  return token || null;
}

export async function enablePushNotifications(
  userId: string,
): Promise<EnablePushResult> {
  // Only synchronous checks may run before requestPermission(): iOS requires the
  // prompt to happen while the user's click is still being handled.
  if (isPushUnavailable(userId)) return 'unsupported';
  if (isIosDevice() && !isStandaloneDisplay()) return 'unsupported';
  if (!hasMessagingApis()) return 'unsupported';

  let permissionRequest: Promise<NotificationPermission>;
  try {
    permissionRequest = Notification.requestPermission();
  } catch (err) {
    console.warn('Push notification permission request failed:', err);
    return 'error';
  }

  try {
    const [permission, supported] = await Promise.all([
      permissionRequest,
      isMessagingSupported(),
    ]);
    if (!supported) return 'unsupported';
    if (permission !== 'granted') return 'denied';

    const registration = await registerPushServiceWorker();
    const token = await fetchPushToken(registration);
    if (!token) return 'error';
    await savePushToken(userId, token);
    return 'granted';
  } catch (err) {
    console.warn('Enabling push notifications failed:', err);
    return 'error';
  }
}

export async function refreshPushTokenIfGranted(userId: string): Promise<void> {
  try {
    const support = await getReminderSupport(userId);
    if (support !== 'supported') return;
    if (
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    ) {
      return;
    }

    const registration = await registerPushServiceWorker();
    const token = await fetchPushToken(registration);
    if (!token) return;
    await savePushToken(userId, token);
  } catch {
    // Refreshing is opportunistic; a failure just leaves the saved token in place.
  }
}
