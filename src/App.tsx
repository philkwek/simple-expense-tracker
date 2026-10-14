import { useState, useEffect, useMemo, useRef } from 'react';
import { User, Cloud } from 'lucide-react';
import {
  DEFAULT_USER_SETTINGS,
  ExpenseItem,
  SyncState,
  UserProfile,
  UserSettings,
} from './types/expense';
import { calculatePeriodWindow } from './utils/periodCalculator';
import { subscribeToAuth } from './services/authService';
import {
  addExpense,
  deleteExpense,
  restoreExpense,
  subscribeToPeriodExpenses,
  subscribeToSettings,
  updateExpense,
  updateUserSettings,
} from './services/expenseService';
import { BudgetCard } from './components/BudgetCard';
import {
  CreateExpenseInput,
  ExpenseInputForm,
} from './components/ExpenseInputForm';
import { ExpenseList } from './components/ExpenseList';
import { UndoToast } from './components/UndoToast';
import { SettingsModal } from './components/SettingsModal';
import { AccountModal } from './components/AccountModal';

export function App() {
  const [user, setUser] = useState<UserProfile>({
    uid: 'local-guest',
    email: null,
    displayName: null,
    isAnonymous: true,
  });
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [periodOffset, setPeriodOffset] = useState<number>(0);
  const [syncState, setSyncState] = useState<SyncState>('local');

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);

  const [deletedExpense, setDeletedExpense] = useState<ExpenseItem | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // 1. Subscribe to Firebase Auth (auto-initiates anonymous guest session if signed out)
  useEffect(() => {
    const unsubscribe = subscribeToAuth((profile) => {
      setUser(profile);
    });
    return unsubscribe;
  }, []);

  // 2. Subscribe to User Settings in Firestore
  useEffect(() => {
    const unsubscribe = subscribeToSettings(
      user.uid,
      (nextSettings) => {
        setSettings(nextSettings);
      },
      (state) => {
        setSyncState(state);
      },
    );
    return unsubscribe;
  }, [user.uid]);

  // 3. Calculate active or historical PeriodWindow from settings + periodOffset
  const periodWindow = useMemo(
    () => calculatePeriodWindow(settings, new Date(), periodOffset),
    [settings, periodOffset],
  );

  // 4. Subscribe to expenses bounded to [periodWindow.start, periodWindow.end)
  useEffect(() => {
    const unsubscribe = subscribeToPeriodExpenses(
      user.uid,
      periodWindow.start,
      periodWindow.end,
      (items) => {
        setExpenses(items);
      },
      (state) => {
        setSyncState(state);
      },
    );
    return unsubscribe;
  }, [user.uid, periodWindow.start, periodWindow.end]);

  // Total spent in active period window
  const totalSpent = useMemo(
    () =>
      Math.round(
        expenses.reduce((sum, item) => sum + item.amount, 0) * 100,
      ) / 100,
    [expenses],
  );

  const handleAddExpense = async (input: CreateExpenseInput) => {
    await addExpense(user.uid, input);
    // If the user logged an expense while viewing a past period, jump back to current period if the expense is for now
    if (
      periodOffset !== 0 &&
      input.timestamp >= calculatePeriodWindow(settings, new Date(), 0).start.getTime()
    ) {
      setPeriodOffset(0);
    }
  };

  const handleUpdateExpense = async (
    id: string,
    updates: Partial<Pick<ExpenseItem, 'title' | 'amount' | 'timestamp' | 'hasTime'>>,
  ) => {
    const existing = expenses.find((item) => item.id === id);
    if (!existing) return;
    await updateExpense(user.uid, id, {
      title: updates.title ?? existing.title,
      amount: updates.amount ?? existing.amount,
      timestamp: updates.timestamp ?? existing.timestamp,
      hasTime: updates.hasTime ?? existing.hasTime,
    });
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

  const handleSaveSettings = async (updates: Partial<UserSettings>) => {
    await updateUserSettings(user.uid, updates);
    setPeriodOffset(0);
  };

  const accountBadgeLabel = user.isAnonymous
    ? 'Guest'
    : user.displayName || user.email?.split('@')[0] || 'Account';

  return (
    <div className="min-h-dvh w-full bg-[#F5F5F7] dark:bg-black text-neutral-900 dark:text-neutral-100 selection:bg-[#007AFF]/20">
      {/* Mobile-First Centered Column Shell */}
      <div className="w-full max-w-md mx-auto min-h-dvh flex flex-col px-4 pt-3 pb-10 safe-top safe-bottom">
        {/* Sticky Translucent App Header */}
        <header className="sticky top-2 z-30 mb-4">
          <div className="material-glass rounded-full px-3.5 py-2 flex items-center justify-between gap-2">
            {/* App Title */}
            <div className="flex items-center min-w-0">
              <span className="text-[16px] font-bold tracking-tight text-neutral-900 dark:text-white pl-1.5">
                Expense Tracker
              </span>
            </div>

            {/* Right Control: Account Management */}
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setIsAccountOpen(true)}
                aria-label="Open account and cloud sync settings"
                className={`pressable touch-target h-9 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  user.isAnonymous
                    ? 'bg-black/[0.04] dark:bg-white/[0.07] text-neutral-700 dark:text-neutral-200'
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
          </div>
        </header>

        {/* Main Content Stack */}
        <main className="flex-1 space-y-4">
          {/* 1. Dashboard Header Card */}
          <BudgetCard
            budget={settings.budget}
            totalSpent={totalSpent}
            currency={settings.currency}
            period={periodWindow}
            periodOffset={periodOffset}
            onPrevPeriod={() => setPeriodOffset((prev) => prev - 1)}
            onNextPeriod={() =>
              setPeriodOffset((prev) => Math.min(0, prev + 1))
            }
            onResetPeriod={() => setPeriodOffset(0)}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          {/* 2. Quick 2-Input Expense Form with Expandable Date/Time Override */}
          <ExpenseInputForm
            currency={settings.currency}
            onAddExpense={handleAddExpense}
          />

          {/* 3. Itemized Period Feed (Grouped by Day, Swipe-to-Delete, Inline Edit) */}
          <ExpenseList
            expenses={expenses}
            currency={settings.currency}
            onUpdateExpense={handleUpdateExpense}
            onDeleteExpense={handleDeleteExpense}
          />
        </main>
      </div>

      {/* Non-blocking 5-second Undo Toast (Apple Forgiveness Pattern) */}
      <UndoToast
        deletedExpense={deletedExpense}
        currency={settings.currency}
        onUndo={handleUndoDelete}
        onDismiss={handleDismissUndo}
      />

      {/* Budget & Cadence Settings Sheet */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />

      {/* Account Management & Cloud Sync Sheet */}
      <AccountModal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
        user={user}
        syncState={syncState}
        onUserUpdated={setUser}
      />
    </div>
  );
}

export default App;
