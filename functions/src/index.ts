/**
 * Scheduled sender for budget logging reminders.
 *
 * One broad query finds budgets whose stored reminder slot is due within the
 * next minute. Everything else is scoped to a single user/budget, and spending
 * is read with aggregation queries only, so the per-run read cost stays flat.
 */
import { initializeApp } from 'firebase-admin/app';
import {
  AggregateField,
  FieldPath,
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  buildMessageFromSums,
  parseBudgetForReminder,
  planBudgetReminder,
  tokenErrorShouldDelete,
  type ReminderRanges,
  type ReminderSums,
} from './reminderPlan';

initializeApp();

const db = getFirestore();

interface PushTokenEntry {
  tokenId: string;
  token: string;
}

/** Structural shape of one multicast send result (kept local so this file
 * type-checks without the messaging type import being required in tests). */
interface MulticastSendResult {
  success: boolean;
  error?: { code?: string };
}

/** Reads and validates the push tokens stored under `users/{uid}/private/push`. */
async function fetchPushTokens(uid: string): Promise<PushTokenEntry[]> {
  const snapshot = await db.doc(`users/${uid}/private/push`).get();
  const data = snapshot.data() as
    | { tokens?: Record<string, unknown> }
    | undefined;
  const rawTokens = data?.tokens ?? {};

  const entries: PushTokenEntry[] = [];
  for (const [tokenId, value] of Object.entries(rawTokens)) {
    if (!value || typeof value !== 'object') continue;
    const token = (value as { token?: unknown }).token;
    if (typeof token === 'string' && token.length > 0) {
      entries.push({ tokenId, token });
    }
  }
  return entries;
}

/**
 * Sums expense amounts with an aggregation query. Never fetches expense docs.
 * Half-open range: `[fromMs, toMs)`.
 */
async function sumExpenses(
  uid: string,
  budgetId: string,
  fromMs: number,
  toMs: number,
): Promise<number> {
  if (!(toMs > fromMs)) return 0;

  const snapshot = await db
    .collection(`users/${uid}/expenses`)
    .where('budgetId', '==', budgetId)
    .where('timestamp', '>=', fromMs)
    .where('timestamp', '<', toMs)
    .aggregate({ total: AggregateField.sum('amount') })
    .get();

  const total = snapshot.data().total;
  return typeof total === 'number' && Number.isFinite(total) ? total : 0;
}

/** Aggregates the expense sums needed to build one reminder message. */
async function loadSums(
  uid: string,
  budgetId: string,
  ranges: ReminderRanges,
): Promise<ReminderSums> {
  if (ranges.kind === 'daily') {
    // One-off budgets aggregate from the start of time and across their whole
    // lifetime; recurring budgets use the cycle window.
    const sumEnd = ranges.sumEnd ?? ranges.cycleEnd;
    const spentBefore =
      ranges.todayStart <= ranges.cycleStart
        ? 0
        : await sumExpenses(uid, budgetId, ranges.cycleStart, ranges.todayStart);
    const spentToday = await sumExpenses(
      uid,
      budgetId,
      ranges.todayStart,
      sumEnd,
    );
    return { spentBefore, spentToday };
  }

  const spentInCycle = await sumExpenses(
    uid,
    budgetId,
    ranges.cycleStart,
    ranges.sumEnd ?? ranges.cycleEnd,
  );
  return { spentInCycle };
}

/** Commits one token-pruning batch per affected user. */
async function flushTokenDeletes(
  pending: Map<string, Set<string>>,
): Promise<void> {
  for (const [uid, tokenIds] of pending) {
    if (tokenIds.size === 0) continue;
    try {
      const batch = db.batch();
      const pushRef = db.doc(`users/${uid}/private/push`);
      for (const tokenId of tokenIds) {
        batch.update(
          pushRef,
          new FieldPath('tokens', tokenId),
          FieldValue.delete(),
        );
      }
      await batch.commit();
    } catch (error) {
      logger.error(`Could not prune push tokens for users/${uid}`, error);
    }
  }
}

export const sendExpenseReminders = onSchedule(
  {
    schedule: '*/15 * * * *',
    timeZone: 'Etc/UTC',
    region: 'asia-southeast1',
    retryCount: 0,
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const now = Date.now();

    // The only broad query in this function.
    const snapshot = await db
      .collectionGroup('budgets')
      .where('nextReminderAt', '<=', now + 60_000)
      .limit(500)
      .get();

    // Per-run caches, keyed by uid.
    const tokenCache = new Map<string, PushTokenEntry[]>();
    const pendingTokenDeletes = new Map<string, Set<string>>();

    let due = 0;
    let sent = 0;
    let stale = 0;
    let failed = 0;
    let tokensRemoved = 0;

    for (const doc of snapshot.docs) {
      due += 1;
      const uid = doc.ref.parent.parent?.id;
      const budgetId = doc.id;

      if (!uid) {
        failed += 1;
        logger.warn(`Budget ${budgetId} has no parent user document; skipping`);
        continue;
      }

      try {
        const budget = parseBudgetForReminder(doc.data());
        if (!budget) {
          await doc.ref.update({ nextReminderAt: FieldValue.delete() });
          continue;
        }

        const plan = planBudgetReminder(budget, now);

        if (plan.stale) {
          stale += 1;
        } else {
          let tokens = tokenCache.get(uid);
          if (!tokens) {
            tokens = await fetchPushTokens(uid);
            tokenCache.set(uid, tokens);
          }

          if (tokens.length > 0) {
            const sums = await loadSums(uid, budgetId, plan.ranges);
            const { title, body } = buildMessageFromSums(
              budget,
              plan.ranges,
              sums,
              now,
            );

            // Data-only push: the app's service worker renders the notification.
            const response = await getMessaging().sendEachForMulticast({
              tokens: tokens.map((entry) => entry.token),
              data: {
                title,
                body,
                url: `/?budget=${encodeURIComponent(budgetId)}`,
                tag: `budget-${budgetId}`,
              },
              webpush: {
                headers: {
                  Urgency: 'high',
                  TTL: '3600',
                },
              },
            });

            if (response.successCount > 0) sent += 1;

            const removedIds = new Set<string>();
            response.responses.forEach(
              (result: MulticastSendResult, index: number) => {
                const entry = tokens?.[index];
                if (!entry) return;
                if (
                  !result.success &&
                  tokenErrorShouldDelete(result.error?.code)
                ) {
                  removedIds.add(entry.tokenId);
                }
              },
            );

            if (removedIds.size > 0) {
              tokensRemoved += removedIds.size;
              tokenCache.set(
                uid,
                tokens.filter((entry) => !removedIds.has(entry.tokenId)),
              );

              let pending = pendingTokenDeletes.get(uid);
              if (!pending) {
                pending = new Set<string>();
                pendingTokenDeletes.set(uid, pending);
              }
              for (const tokenId of removedIds) pending.add(tokenId);
            }
          }
        }

        await doc.ref.update({
          nextReminderAt: plan.nextReminderAt ?? FieldValue.delete(),
        });
      } catch (error) {
        failed += 1;
        logger.error(`Reminder failed for users/${uid}/budgets/${budgetId}`, error);

        // Still advance the slot, otherwise this doc is due again 15 minutes
        // from now and the run would hot-loop on the same failing budget.
        try {
          const budget = parseBudgetForReminder(doc.data());
          if (budget) {
            const plan = planBudgetReminder(budget, now);
            await doc.ref.update({
              nextReminderAt: plan.nextReminderAt ?? FieldValue.delete(),
            });
          } else {
            await doc.ref.update({ nextReminderAt: FieldValue.delete() });
          }
        } catch (advanceError) {
          logger.error(
            `Could not advance nextReminderAt for users/${uid}/budgets/${budgetId}`,
            advanceError,
          );
        }
      }
    }

    await flushTokenDeletes(pendingTokenDeletes);

    logger.info(
      `sendExpenseReminders: due=${due} sent=${sent} stale=${stale} failed=${failed} tokensRemoved=${tokensRemoved}`,
    );
  },
);
