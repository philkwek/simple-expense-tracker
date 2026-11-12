import { BUDGET_NAME_MAX_LENGTH } from '../types/expense';

/**
 * Minimal shape of a budget document needed to plan a guest-to-account merge.
 * Extra Firestore fields are preserved on the output so callers can decide which
 * of them are safe to write.
 */
export interface BudgetDocLike {
  id: string;
  name: string;
  sortOrder: number;
  [key: string]: unknown;
}

export interface GuestBudgetMergePlan {
  budgetsToWrite: BudgetDocLike[];
  idMap: Record<string, string>;
}

const GUEST_NAME_SUFFIX = ' (guest)';

/**
 * Appends the guest suffix while keeping the whole name within the budget name
 * limit. The suffix itself is never truncated; only the original name is trimmed.
 */
function addGuestSuffix(name: string): string {
  const maxOriginalLength = BUDGET_NAME_MAX_LENGTH - GUEST_NAME_SUFFIX.length;
  const original = name.trim().slice(0, maxOriginalLength).trimEnd();
  return `${original}${GUEST_NAME_SUFFIX}`;
}

/**
 * Works out how a guest's budgets should be written into an existing account.
 *
 * - With no account budgets, the guest budgets are kept exactly as they are.
 * - Otherwise each guest budget is appended after the account's budgets and gets
 *   the " (guest)" suffix. An id that already exists in the account is replaced
 *   with a freshly generated id, so two unrelated "default" budgets never merge.
 *
 * The function is pure and deterministic for a given `makeId` implementation.
 */
export function planGuestBudgetMerge(
  guestBudgets: BudgetDocLike[],
  accountBudgets: BudgetDocLike[],
  makeId: () => string,
): GuestBudgetMergePlan {
  const idMap: Record<string, string> = {};

  if (guestBudgets.length === 0) {
    return { budgetsToWrite: [], idMap };
  }

  if (accountBudgets.length === 0) {
    const budgetsToWrite = guestBudgets.map((budget) => ({ ...budget }));
    for (const budget of budgetsToWrite) {
      idMap[budget.id] = budget.id;
    }
    return { budgetsToWrite, idMap };
  }

  const accountIds = new Set(accountBudgets.map((budget) => budget.id));
  const maxAccountSortOrder = accountBudgets.reduce(
    (max, budget) => Math.max(max, budget.sortOrder),
    -1,
  );

  const orderedGuestBudgets = [...guestBudgets].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const budgetsToWrite = orderedGuestBudgets.map((budget, index) => {
    const id = accountIds.has(budget.id) ? makeId() : budget.id;
    idMap[budget.id] = id;

    return {
      ...budget,
      id,
      name: addGuestSuffix(budget.name),
      sortOrder: maxAccountSortOrder + 1 + index,
    };
  });

  return { budgetsToWrite, idMap };
}
