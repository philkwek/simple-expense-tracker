import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import {
  Trash2,
  Pencil,
  Check,
  X,
  Receipt,
  Clock,
  Calendar,
} from 'lucide-react';
import { ExpenseItem } from '../types/expense';
import { ExpenseUpdateEntry } from '../services/expenseService';
import {
  formatCurrency,
  groupExpensesByDay,
  toDateInputValue,
  toTimeInputValue,
  fromDateAndTimeInputs,
} from '../utils/periodCalculator';
import {
  SPRING_CRITICALLY_DAMPED,
  SPRING_MOMENTUM,
  applyRubberbandBounds,
  selectNearestSnapTarget,
} from '../lib/motion';

export interface ExpenseDraft {
  title: string;
  amountStr: string;
  date: string;
  time: string;
}

interface ExpenseListProps {
  expenses: ExpenseItem[];
  currency: string;
  onBatchUpdateExpenses: (
    updates: ExpenseUpdateEntry[],
  ) => Promise<void> | void;
  onDeleteExpense: (expense: ExpenseItem) => Promise<void> | void;
}

const ACTION_REVEAL_WIDTH = 72;
const FULL_SWIPE_DELETE_THRESHOLD = -180;

function createDraftFromItem(item: ExpenseItem, currency: string): ExpenseDraft {
  return {
    title: item.title,
    amountStr:
      currency === 'JPY'
        ? String(Math.round(item.amount))
        : item.amount.toFixed(2),
    date: toDateInputValue(item.timestamp),
    time: item.hasTime === false ? '' : toTimeInputValue(item.timestamp),
  };
}

interface ExpenseRowProps {
  item: ExpenseItem;
  currency: string;
  isEditMode: boolean;
  draft: ExpenseDraft;
  onDraftChange: (id: string, patch: Partial<ExpenseDraft>) => void;
  isOpenRow: boolean;
  onOpenChange: (id: string | null) => void;
  onDelete: (expense: ExpenseItem) => Promise<void> | void;
}

const ExpenseRow: React.FC<ExpenseRowProps> = ({
  item,
  currency,
  isEditMode,
  draft,
  onDraftChange,
  isOpenRow,
  onOpenChange,
  onDelete,
}) => {
  const x = useMotionValue(0);
  const pointerStartRef = useRef<{
    x: number;
    y: number;
    initialOffset: number;
    lockedAxis: 'x' | 'y' | null;
    lastX: number;
    lastTime: number;
    velocityX: number;
  } | null>(null);

  // Sync open/closed state from parent
  useEffect(() => {
    const target = isOpenRow && !isEditMode ? -ACTION_REVEAL_WIDTH : 0;
    const controls = animate(x, target, SPRING_CRITICALLY_DAMPED);
    return () => controls.stop();
  }, [isOpenRow, isEditMode, x]);

  const showTime = item.hasTime !== false;
  const timeFormatted = showTime
    ? new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(item.timestamp))
    : null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditMode) return;
    // Only primary touch/mouse button
    if (e.button !== 0) return;

    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialOffset: x.get(),
      lockedAxis: null,
      lastX: e.clientX,
      lastTime: performance.now(),
      velocityX: 0,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = pointerStartRef.current;
    if (!state || isEditMode) return;

    const dx = e.clientX - state.x;
    const dy = e.clientY - state.y;

    // 10px directional hysteresis before locking horizontal drag
    if (!state.lockedAxis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      state.lockedAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (state.lockedAxis === 'x') {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }

    if (state.lockedAxis !== 'x') return;

    const now = performance.now();
    const dt = Math.max(1, now - state.lastTime);
    const instantVx = ((e.clientX - state.lastX) / dt) * 1000;
    state.velocityX = state.velocityX * 0.35 + instantVx * 0.65;
    state.lastX = e.clientX;
    state.lastTime = now;

    const rawOffset = state.initialOffset + dx;
    // Allow 1:1 tracking between [-ACTION_REVEAL_WIDTH, 0] and progressive rubber-band past boundaries
    const bounded = applyRubberbandBounds(
      rawOffset,
      -ACTION_REVEAL_WIDTH,
      0,
      160,
      0.55,
    );
    x.set(bounded);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!state || state.lockedAxis !== 'x') return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore pointer capture release errors
    }

    const currentX = x.get();
    const vx = state.velocityX;

    // Full swipe-through delete when pulled far left or thrown hard left
    if (
      currentX <= FULL_SWIPE_DELETE_THRESHOLD ||
      (currentX < -85 && vx < -950)
    ) {
      animate(x, -360, SPRING_MOMENTUM);
      onDelete(item);
      return;
    }

    const snapTarget = selectNearestSnapTarget(
      currentX,
      vx,
      [0, -ACTION_REVEAL_WIDTH],
      0.992,
    );

    const isOpening = snapTarget === -ACTION_REVEAL_WIDTH;
    onOpenChange(isOpening ? item.id : null);
    animate(x, snapTarget, {
      ...SPRING_MOMENTUM,
      velocity: vx,
    });
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={SPRING_CRITICALLY_DAMPED}
      className="relative overflow-hidden rounded-2xl bg-white/80 dark:bg-neutral-900/80 border border-black/[0.05] dark:border-white/[0.07]"
    >
      {isEditMode ? (
        <div className="p-3.5 space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft.title}
              maxLength={120}
              onChange={(e) =>
                onDraftChange(item.id, { title: e.target.value })
              }
              aria-label={`Edit item name for ${item.title}`}
              className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[16px] text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
            />
            <input
              type="text"
              inputMode="decimal"
              value={draft.amountStr}
              onChange={(e) =>
                onDraftChange(item.id, {
                  amountStr: e.target.value.replace(/[^0-9.]/g, ''),
                })
              }
              aria-label={`Edit cost for ${item.title}`}
              className="w-24 h-10 px-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[16px] font-semibold tabular-nums text-right text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 grid grid-cols-2 gap-1.5">
              <div className="relative flex items-center">
                <Calendar className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="date"
                  aria-label={`Edit date for ${item.title}`}
                  value={draft.date}
                  onChange={(e) =>
                    onDraftChange(item.id, { date: e.target.value })
                  }
                  className="w-full h-9 pl-7 pr-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[12px] tabular-nums text-neutral-700 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
              </div>

              <div className="relative flex items-center">
                <Clock className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="time"
                  aria-label={`Edit optional time for ${item.title}`}
                  value={draft.time}
                  onChange={(e) =>
                    onDraftChange(item.id, { time: e.target.value })
                  }
                  className="w-full h-9 pl-7 pr-6 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[12px] tabular-nums text-neutral-700 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
                {draft.time && (
                  <button
                    type="button"
                    onClick={() => onDraftChange(item.id, { time: '' })}
                    aria-label="Clear time (whole day)"
                    className="pressable absolute right-1.5 p-0.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDelete(item)}
              aria-label={`Delete ${item.title}`}
              className="pressable touch-target h-9 w-9 shrink-0 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-neutral-400 hover:text-[#FF3B30] dark:hover:text-[#FF453A] hover:bg-[#FF3B30]/10 flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          {/* Background Swipe Action Tray */}
          <div
            aria-hidden={!isOpenRow}
            className="absolute inset-y-0 right-0 flex items-stretch"
            style={{ width: ACTION_REVEAL_WIDTH }}
          >
            <button
              type="button"
              onClick={() => onDelete(item)}
              aria-label={`Delete ${item.title}`}
              className="pressable flex-1 bg-[#FF3B30] dark:bg-[#FF453A] text-white flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          </div>

          {/* Foreground Draggable Surface */}
          <motion.div
            style={{ x, touchAction: 'pan-y' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onClick={() => {
              if (isOpenRow) {
                onOpenChange(null);
              }
            }}
            className="relative z-10 bg-white dark:bg-neutral-900 px-4 py-3.5 flex items-center justify-between gap-3 select-none cursor-grab active:cursor-grabbing"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {item.title}
              </div>
              {timeFormatted && (
                <div className="inline-flex items-center gap-1 text-[12px] text-neutral-400 dark:text-neutral-500 mt-0.5 tabular-nums">
                  <Clock className="w-3 h-3" />
                  <span>{timeFormatted}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[16px] font-semibold tabular-nums tracking-tight text-neutral-900 dark:text-white">
                {formatCurrency(item.amount, currency)}
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item);
                }}
                aria-label={`Delete ${item.title}`}
                className="pressable p-2 ml-0.5 rounded-lg text-neutral-400 hover:text-[#FF3B30] dark:hover:text-[#FF453A] hover:bg-[#FF3B30]/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.li>
  );
};

export const ExpenseList: React.FC<ExpenseListProps> = ({
  expenses,
  currency,
  onBatchUpdateExpenses,
  onDeleteExpense,
}) => {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ExpenseDraft>>({});

  // Keep draft entries populated if new expenses arrive while in edit mode
  useEffect(() => {
    if (!isEditMode) return;
    setDrafts((prev) => {
      const next = { ...prev };
      let added = false;
      for (const item of expenses) {
        if (!next[item.id]) {
          next[item.id] = createDraftFromItem(item, currency);
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [expenses, currency, isEditMode]);

  const enterEditMode = () => {
    setOpenRowId(null);
    const initialDrafts: Record<string, ExpenseDraft> = {};
    for (const item of expenses) {
      initialDrafts[item.id] = createDraftFromItem(item, currency);
    }
    setDrafts(initialDrafts);
    setIsEditMode(true);
  };

  const cancelEditMode = () => {
    setIsEditMode(false);
    setDrafts({});
  };

  const handleDraftChange = (id: string, patch: Partial<ExpenseDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { title: '', amountStr: '0', date: '', time: '' }),
        ...patch,
      },
    }));
  };

  const handleSaveAllEdits = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const changedUpdates: ExpenseUpdateEntry[] = [];

      for (const item of expenses) {
        const draft = drafts[item.id];
        if (!draft) continue;

        const trimmedTitle = draft.title.trim();
        const parsedAmount = parseFloat(draft.amountStr);
        if (
          !trimmedTitle ||
          !Number.isFinite(parsedAmount) ||
          parsedAmount <= 0
        ) {
          continue;
        }

        const nextAmount = Math.round(parsedAmount * 100) / 100;
        const nextHasTime = draft.time.trim().length > 0;
        const nextTimestamp = fromDateAndTimeInputs(
          draft.date,
          draft.time,
          item.timestamp,
        );
        const prevHasTime = item.hasTime !== false;

        const isModified =
          trimmedTitle !== item.title ||
          Math.abs(nextAmount - item.amount) > 0.001 ||
          nextTimestamp !== item.timestamp ||
          nextHasTime !== prevHasTime;

        if (isModified) {
          changedUpdates.push({
            id: item.id,
            title: trimmedTitle,
            amount: nextAmount,
            timestamp: nextTimestamp,
            hasTime: nextHasTime,
          });
        }
      }

      if (changedUpdates.length > 0) {
        await onBatchUpdateExpenses(changedUpdates);
      }

      setIsEditMode(false);
      setDrafts({});
    } finally {
      setIsSaving(false);
    }
  };

  const dayGroups = groupExpensesByDay(expenses);

  if (expenses.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_CRITICALLY_DAMPED}
        className="material-glass rounded-[22px] py-12 px-6 text-center"
      >
        <div className="w-11 h-11 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center mx-auto mb-3 text-neutral-400 dark:text-neutral-500">
          <Receipt className="w-5 h-5" />
        </div>
        <h3 className="text-[15px] font-semibold text-neutral-800 dark:text-neutral-200">
          No expenses in this period
        </h3>
        <p className="text-[13px] text-neutral-400 dark:text-neutral-500 mt-1 max-w-[240px] mx-auto">
          Add an item above to start tracking your spending for this cycle.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4" aria-label="Itemized expenses">
      {/* Top List Toolbar with Edit Mode Toggle */}
      <div className="flex items-center justify-between px-1.5">
        <span className="text-[13px] font-semibold tracking-tight text-neutral-700 dark:text-neutral-200">
          {isEditMode ? 'Editing Expenses' : 'Expenses'}
        </span>

        <div className="flex items-center gap-1.5">
          {isEditMode ? (
            <>
              <button
                type="button"
                onClick={cancelEditMode}
                disabled={isSaving}
                aria-label="Cancel editing"
                className="pressable h-8 px-2.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.08] text-neutral-600 dark:text-neutral-300 text-[12px] font-medium inline-flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                onClick={handleSaveAllEdits}
                disabled={isSaving}
                aria-label="Save all edits"
                className="pressable h-8 px-3 rounded-lg bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[12px] font-semibold inline-flex items-center gap-1 shadow-sm shadow-[#007AFF]/20"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save'}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={enterEditMode}
              aria-label="Toggle edit mode"
              title="Edit expenses"
              className="pressable p-2 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {dayGroups.map((group) => (
          <motion.section
            key={group.dateKey}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING_CRITICALLY_DAMPED}
            className="space-y-2"
          >
            {/* Day Group Header with Tabular Daily Subtotal */}
            <div className="flex items-center justify-between px-1.5">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500">
                {group.label}
              </h3>
              <span className="text-[12px] font-semibold tabular-nums text-neutral-500 dark:text-neutral-400">
                {formatCurrency(group.subtotal, currency)}
              </span>
            </div>

            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {group.items.map((item) => (
                  <ExpenseRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    isEditMode={isEditMode}
                    draft={
                      drafts[item.id] ?? createDraftFromItem(item, currency)
                    }
                    onDraftChange={handleDraftChange}
                    isOpenRow={openRowId === item.id}
                    onOpenChange={setOpenRowId}
                    onDelete={onDeleteExpense}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </motion.section>
        ))}
      </AnimatePresence>
    </div>
  );
};
