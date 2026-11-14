import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { User, Cloud } from 'lucide-react';
import {
  Budget,
  BudgetInput,
  DEFAULT_USER_SETTINGS,
  ExpenseItem,
  hasDateRange,
  isOneOffBudget,
  legacySettingsToBudget,
  SyncState,
  UserProfile,
} from './types/expense';
import {
  calculatePeriodWindow,
  computeDailyAllowances,
  getDailyAllowanceSummary,
  getExpenseQueryRange,
} from './utils/periodCalculator';
import { subscribeToAuth } from './services/authService';
import {
  addExpense,
  batchUpdateExpenses,
  countBudgetExpenses,
  createBudget,
  deleteBudget,
  deleteExpense,
  ExpenseUpdateEntry,
  getStoredActiveBudgetId,
  restoreExpense,
  setStoredActiveBudgetId,
  subscribeToBudgets,
  subscribeToPeriodExpenses,
  updateBudget,
} from './services/expenseService';
import { refreshPushTokenIfGranted } from './services/notificationService';
import { BudgetCard } from './components/BudgetCard';
import {
  CreateExpenseInput,
  ExpenseInputForm,
} from './components/ExpenseInputForm';
import { ExpenseList } from './components/ExpenseList';
import { UndoToast } from './components/UndoToast';
import { BudgetSwitcher } from './components/BudgetSwitcher';
import { LoadingScreen } from './components/LoadingScreen';

/** Shown for the brief moment before the first budgets snapshot arrives. */
const PLACEHOLDER_BUDGET: Budget = legacySettingsToBudget(DEFAULT_USER_SETTINGS, 0);

// The sheets aren't needed for first paint, so they ship in their own chunks.
const loadBudgetEditor = () => import('./components/BudgetEditorModal');
const loadAccountModal = () => import('./components/AccountModal');
const BudgetEditorModal = lazy(() =>
  loadBudgetEditor().then((m) => ({ default: m.BudgetEditorModal })),
);
const AccountModal = lazy(() =>
  loadAccountModal().then((m) => ({ default: m.AccountModal })),
);

/** True from the first time `open` is true; keeps a lazy sheet mounted so its exit animation still runs. */
function useHasOpened(open: boolean) {
  const [hasOpened, setHasOpened] = useState(open);
  if (open && !hasOpened) setHasOpened(true);
  return hasOpened;
}

export function App() {
  const [user, setUser] = useState<UserProfile>({
    uid: 'local-guest',
    email: null,
    displayName: null,
    isAnonymous: true,
  });
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [activeBudgetId, setActiveBudgetId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [periodOffset, setPeriodOffset] = useState<number>(0);
  const [syncState, setSyncState] = useState<SyncState>('local');

  // Splash gating: the real user, their budgets, and the active budget's expenses must all
  // have arrived before the dashboard is revealed, so the default placeholder never shows.
  const [authResolved, setAuthResolved] = useState(false);
  const [loadedExpensesKey, setLoadedExpensesKey] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const hasOpenedEditor = useHasOpened(editorMode !== null);
  const hasOpenedAccount = useHasOpened(isAccountOpen);

  // Fetch the sheet chunks once the browser is idle so the first open is instant.
  useEffect(() => {
    const prefetch = () => {
      void loadBudgetEditor();
      void loadAccountModal();
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(prefetch, 2000);
    return () => clearTimeout(id);
  }, []);

  const [deletedExpense, setDeletedExpense] = useState<ExpenseItem | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // 1. Subscribe to Firebase Auth (auto-initiates anonymous guest session if signed out)
  useEffect(() => {
    const unsubscribe = subscribeToAuth((profile) => {
      setUser(profile);
      setAuthResolved(true);
    });
    return unsubscribe;
  }, []);

  // 2. Subscribe to the user's budgets (migrates single-budget accounts on first load)
  useEffect(() => {
    setBudgets([]);
    setActiveBudgetId(getStoredActiveBudgetId(user.uid));
    const unsubscribe = subscribeToBudgets(user.uid, setBudgets, setSyncState);
    return unsubscribe;
  }, [user.uid]);

  // Keep the saved push token fresh when this device already allows notifications.
  useEffect(() => {
    if (user.uid === 'local-guest') return;
    void refreshPushTokenIfGranted(user.uid);
  }, [user.uid]);

  // Falls back to the first budget when the remembered one no longer exists
  const activeBudget: Budget =
    budgets.find((b) => b.id === activeBudgetId) ?? budgets[0] ?? PLACEHOLDER_BUDGET;
  const hasBudgets = budgets.length > 0;

  // 3. Calculate active or historical PeriodWindow from the active budget + periodOffset.
  // One-off budgets need their kind/dates so the window is a single open-ended period.
  const { cadence, periodStartDay, kind, startDate, endDate } = activeBudget;
  const periodConfig = useMemo(
    () => ({ cadence, periodStartDay, kind, startDate, endDate }),
    [cadence, periodStartDay, kind, startDate, endDate],
  );
  const periodWindow = useMemo(
    () => calculatePeriodWindow(periodConfig, new Date(), periodOffset),
    [periodConfig, periodOffset],
  );
  // One-off budgets count every expense logged to them, regardless of date.
  const expenseQueryRange = useMemo(
    () => getExpenseQueryRange(periodConfig, periodWindow),
    [periodConfig, periodWindow],
  );
  const periodStartMs = expenseQueryRange.start.getTime();
  const periodEndMs = expenseQueryRange.end.getTime();

  // 4. Subscribe to the active budget's expenses bounded to [start, end)
  const expensesKey = `${user.uid}|${activeBudget.id}|${periodStartMs}|${periodEndMs}`;
  useEffect(() => {
    if (!hasBudgets) {
      setExpenses([]);
      return;
    }
    const unsubscribe = subscribeToPeriodExpenses(
      user.uid,
      activeBudget.id,
      new Date(periodStartMs),
      new Date(periodEndMs),
      (items) => {
        setExpenses(items);
        setLoadedExpensesKey(expensesKey);
      },
      setSyncState,
    );
    return unsubscribe;
  }, [user.uid, hasBudgets, activeBudget.id, periodStartMs, periodEndMs, expensesKey]);

  // A one-off budget has exactly one period, so never leave a past-period offset active.
  useEffect(() => {
    if (isOneOffBudget(activeBudget) && periodOffset !== 0) {
      setPeriodOffset(0);
    }
  }, [activeBudget, periodOffset]);

  // Latch once everything is in; later budget/period switches never bring the splash back.
  const isDataReady = authResolved && hasBudgets && loadedExpensesKey === expensesKey;
  useEffect(() => {
    if (isDataReady) setHasLoaded(true);
  }, [isDataReady]);

  // Never trap the user on the splash (e.g. a brand-new account opened offline).
  useEffect(() => {
    const id = window.setTimeout(() => setHasLoaded(true), 8000);
    return () => window.clearTimeout(id);
  }, []);

  // Total spent in active period window
  const totalSpent = useMemo(
    () =>
      Math.round(
        expenses.reduce((sum, item) => sum + item.amount, 0) * 100,
      ) / 100,
    [expenses],
  );

  // Rolling daily allowance (weekly/monthly budgets with dailyTracking enabled; dated one-offs)
  const isOneOff = isOneOffBudget(activeBudget);
  const showDailyAllowance =
    activeBudget.dailyTracking === true &&
    (isOneOff ? hasDateRange(activeBudget) : activeBudget.cadence !== 'daily');
  const countEarlierSpending = isOneOff;

  const dailyAllowances = useMemo(
    () =>
      showDailyAllowance
        ? computeDailyAllowances(activeBudget.amount, periodWindow, expenses, {
            countEarlierSpending,
          })
        : null,
    [
      showDailyAllowance,
      activeBudget.amount,
      periodWindow,
      expenses,
      countEarlierSpending,
    ],
  );

  const todayAllowance = useMemo(
    () =>
      showDailyAllowance && periodOffset === 0
        ? getDailyAllowanceSummary(activeBudget.amount, periodWindow, expenses, new Date(), {
            countEarlierSpending,
          })
        : null,
    [
      showDailyAllowance,
      periodOffset,
      activeBudget.amount,
      periodWindow,
      expenses,
      countEarlierSpending,
    ],
  );

  const handleAddExpense = async (input: CreateExpenseInput) => {
    await addExpense(user.uid, { ...input, budgetId: activeBudget.id });
    // If the user logged an expense while viewing a past period, jump back to current period if the expense is for now
    if (
      periodOffset !== 0 &&
      input.timestamp >= calculatePeriodWindow(activeBudget, new Date(), 0).start.getTime()
    ) {
      setPeriodOffset(0);
    }
  };

  const handleBatchUpdateExpenses = async (updates: ExpenseUpdateEntry[]) => {
    if (updates.length === 0) return;
    await batchUpdateExpenses(user.uid, updates);
  };

  const handleDeleteExpense = async (item: ExpenseItem) => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }
    setDeletedExpense(item);
    await deleteExpense(user.uid, item.id);

    undoTimerRef.current = window.setTimeout(() => {
      setDeletedExpense(null);
      undoTimerRef.current = null;
    }, 5000);
  };

  const handleUndoDelete = async () => {
    if (!deletedExpense) return;
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const toRestore = deletedExpense;
    setDeletedExpense(null);
    await restoreExpense(user.uid, toRestore);
  };

  const handleDismissUndo = () => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setDeletedExpense(null);
  };

  const handleSelectBudget = (budgetId: string) => {
    if (budgetId === activeBudget.id) return;
    setActiveBudgetId(budgetId);
    setStoredActiveBudgetId(user.uid, budgetId);
    setPeriodOffset(0);
  };

  // Deep link from a reminder notification ("/?budget=<id>"), once per page load.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || budgets.length === 0) return;
    deepLinkHandledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const budgetId = params.get('budget');
    if (!budgetId) return;

    if (budgets.some((b) => b.id === budgetId)) {
      handleSelectBudget(budgetId);
      setPeriodOffset(0);
    }
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.hash,
    );
  }, [budgets, handleSelectBudget]);

  const handleSaveBudget = async (input: BudgetInput) => {
    if (editorMode === 'create') {
      const created = await createBudget(user.uid, input);
      handleSelectBudget(created.id);
    } else {
      await updateBudget(user.uid, activeBudget, input);
      setPeriodOffset(0);
    }
  };

  const handleDeleteBudget = async () => {
    if (budgets.length <= 1) return;
    const deletedId = activeBudget.id;
    const next = budgets.find((b) => b.id !== deletedId);
    await deleteBudget(user.uid, deletedId);
    if (next) handleSelectBudget(next.id);
    // The deleted budget's expenses are gone; an undo would restore into a missing budget
    if (deletedExpense?.budgetId === deletedId) handleDismissUndo();
  };

  // The undo toast belongs to the budget the expense came from, which may not be the active one
  const deletedExpenseCurrency =
    budgets.find((b) => b.id === deletedExpense?.budgetId)?.currency ??
    activeBudget.currency;

  const accountBadgeLabel = user.isAnonymous
    ? 'Guest'
    : user.displayName || user.email?.split('@')[0] || 'Account';

  return (
    <div className="min-h-dvh w-full bg-[#F5F5F7] dark:bg-black text-neutral-900 dark:text-neutral-100 selection:bg-[#007AFF]/20">
      {/* Mobile-First Centered Column Shell */}
      <div className="w-full max-w-md mx-auto min-h-dvh flex flex-col px-4 safe-top safe-bottom">
        {/* Main Content Stack */}
        <main className="flex-1 w-full space-y-5">
          {/* 0. Budget Switcher + account button */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <BudgetSwitcher
                budgets={budgets}
                activeBudgetId={activeBudget.id}
                onSelectBudget={handleSelectBudget}
                onCreateBudget={() => setEditorMode('create')}
              />
            </div>
            <button
              type="button"
              onClick={() => setIsAccountOpen(true)}
              aria-label="Open account and cloud sync settings"
              className={`pressable touch-target shrink-0 h-9 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                user.isAnonymous
                  ? 'bg-white/90 dark:bg-neutral-900/80 border border-black/[0.055] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.03)] text-neutral-700 dark:text-neutral-200'
                  : 'bg-[#007AFF]/12 dark:bg-[#0A84FF]/20 text-[#007AFF] dark:text-[#0A84FF]'
              }`}
            >
              {user.isAnonymous ? (
                <User className="w-3.5 h-3.5" />
              ) : (
                <Cloud className="w-3.5 h-3.5" />
              )}
              <span className="max-w-[84px] truncate">{accountBadgeLabel}</span>
            </button>
          </div>

          {/* 1. Dashboard Budget Overview */}
          <BudgetCard
            budget={activeBudget.amount}
            totalSpent={totalSpent}
            currency={activeBudget.currency}
            period={periodWindow}
            periodOffset={periodOffset}
            todayAllowance={todayAllowance}
            onPrevPeriod={() => setPeriodOffset((prev) => prev - 1)}
            onNextPeriod={() =>
              setPeriodOffset((prev) => Math.min(0, prev + 1))
            }
            onResetPeriod={() => setPeriodOffset(0)}
            onOpenSettings={() => setEditorMode('edit')}
          />

          {/* 2. Quick 2-Input Expense Form with Expandable Date/Time Override */}
          <ExpenseInputForm
            currency={activeBudget.currency}
            onAddExpense={handleAddExpense}
          />

          {/* 3. Itemized Period Feed (Grouped by Day, Swipe-to-Delete, Batch Edit Mode) */}
          <ExpenseList
            expenses={expenses}
            currency={activeBudget.currency}
            dailyAllowances={dailyAllowances}
            onBatchUpdateExpenses={handleBatchUpdateExpenses}
            onDeleteExpense={handleDeleteExpense}
          />
        </main>
      </div>

      {/* Non-blocking 5-second Undo Toast (Apple Forgiveness Pattern) */}
      <UndoToast
        deletedExpense={deletedExpense}
        currency={deletedExpenseCurrency}
        onUndo={handleUndoDelete}
        onDismiss={handleDismissUndo}
      />

      <LoadingScreen visible={!hasLoaded} />

      <Suspense fallback={null}>
        {/* Create / Edit Budget Sheet */}
        {hasOpenedEditor && (
          <BudgetEditorModal
            isOpen={editorMode !== null}
            onClose={() => setEditorMode(null)}
            userId={user.uid}
            mode={editorMode ?? 'edit'}
            budget={editorMode === 'edit' ? activeBudget : null}
            canDelete={budgets.length > 1}
            onSave={handleSaveBudget}
            onDelete={handleDeleteBudget}
            getExpenseCount={() => countBudgetExpenses(user.uid, activeBudget.id)}
          />
        )}

        {/* Account Management & Cloud Sync Sheet */}
        {hasOpenedAccount && (
          <AccountModal
            isOpen={isAccountOpen}
            onClose={() => setIsAccountOpen(false)}
            user={user}
            syncState={syncState}
            onUserUpdated={setUser}
          />
        )}
      </Suspense>
    </div>
  );
}

export default App;
