import { describe, expect, it } from 'vitest';
import { planGuestBudgetMerge, type BudgetDocLike } from './budgetMerge';

function makeBudget(
  id: string,
  overrides: Partial<BudgetDocLike> = {},
): BudgetDocLike {
  return {
    id,
    name: `Budget ${id}`,
    sortOrder: 0,
    amount: 100,
    cadence: 'monthly',
    periodStartDay: 1,
    currency: 'USD',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('planGuestBudgetMerge', () => {
  it('keeps original guest ids, names and sort orders when the account has no budgets', () => {
    const guestBudgets = [
      makeBudget('default', { name: 'Main', sortOrder: 0 }),
      makeBudget('g-trip', { name: 'Trip', sortOrder: 1 }),
    ];
    let makeIdCalls = 0;

    const { budgetsToWrite, idMap } = planGuestBudgetMerge(
      guestBudgets,
      [],
      () => {
        makeIdCalls += 1;
        return 'generated';
      },
    );

    expect(makeIdCalls).toBe(0);
    expect(budgetsToWrite).toEqual(guestBudgets);
    expect(idMap).toEqual({ default: 'default', 'g-trip': 'g-trip' });
  });

  it('remaps a colliding default budget and appends guest budgets after the account max', () => {
    const guestBudgets = [
      makeBudget('g-trip', { name: 'Trip', sortOrder: 2 }),
      makeBudget('default', { name: 'Guest main', sortOrder: 1 }),
    ];
    const accountBudgets = [
      makeBudget('default', { name: 'Account main', sortOrder: 4 }),
      makeBudget('acc-2', { name: 'Account secondary', sortOrder: 7 }),
    ];

    const { budgetsToWrite, idMap } = planGuestBudgetMerge(
      guestBudgets,
      accountBudgets,
      () => 'new-default',
    );

    expect(budgetsToWrite.map((budget) => budget.id)).toEqual([
      'new-default',
      'g-trip',
    ]);
    expect(budgetsToWrite[0]).toMatchObject({
      id: 'new-default',
      name: 'Guest main (guest)',
      sortOrder: 8,
    });
    expect(budgetsToWrite[1]).toMatchObject({
      id: 'g-trip',
      name: 'Trip (guest)',
      sortOrder: 9,
    });
    expect(idMap).toEqual({ default: 'new-default', 'g-trip': 'g-trip' });
  });

  it('truncates long names to 40 characters without cutting the guest suffix', () => {
    const guestBudgets = [
      makeBudget('default', { name: 'A'.repeat(60), sortOrder: 0 }),
    ];
    const accountBudgets = [
      makeBudget('default', { name: 'Existing', sortOrder: 0 }),
    ];

    const { budgetsToWrite } = planGuestBudgetMerge(
      guestBudgets,
      accountBudgets,
      () => 'new-id',
    );

    const name = budgetsToWrite[0].name;
    expect(name).toHaveLength(40);
    expect(name.endsWith(' (guest)')).toBe(true);
    expect(name).toBe(`${'A'.repeat(32)} (guest)`);
  });

  it('keeps a non-colliding guest id and still marks it as a guest budget', () => {
    const guestBudgets = [
      makeBudget('guest-budget', { name: 'Holidays', sortOrder: 0 }),
    ];
    const accountBudgets = [
      makeBudget('default', { name: 'Account main', sortOrder: 4 }),
    ];
    let makeIdCalls = 0;

    const { budgetsToWrite, idMap } = planGuestBudgetMerge(
      guestBudgets,
      accountBudgets,
      () => {
        makeIdCalls += 1;
        return 'unused-id';
      },
    );

    expect(makeIdCalls).toBe(0);
    expect(budgetsToWrite[0]).toMatchObject({
      id: 'guest-budget',
      name: 'Holidays (guest)',
      sortOrder: 5,
    });
    expect(idMap).toEqual({ 'guest-budget': 'guest-budget' });
  });

  it('returns empty results when the guest has no budgets', () => {
    let makeIdCalls = 0;

    const result = planGuestBudgetMerge(
      [],
      [makeBudget('default')],
      () => {
        makeIdCalls += 1;
        return 'generated';
      },
    );

    expect(result.budgetsToWrite).toEqual([]);
    expect(result.idMap).toEqual({});
    expect(makeIdCalls).toBe(0);
  });
});
