import React, { useState, useRef } from 'react';
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

interface ExpenseListProps {
  expenses: ExpenseItem[];
  currency: string;
  onUpdateExpense: (
    id: string,
    updates: Partial<
      Pick<ExpenseItem, 'title' | 'amount' | 'timestamp' | 'hasTime'>
    >,
  ) => Promise<void> | void;
  onDeleteExpense: (expense: ExpenseItem) => Promise<void> | void;
}

const ACTION_REVEAL_WIDTH = 132;
const FULL_SWIPE_DELETE_THRESHOLD = -210;

interface ExpenseRowProps {
  item: ExpenseItem;
  currency: string;
  isOpenRow: boolean;
  onOpenChange: (id: string | null) => void;
  onUpdate: (
    id: string,
    updates: Partial<
      Pick<ExpenseItem, 'title' | 'amount' | 'timestamp' | 'hasTime'>
    >,
  ) => Promise<void> | void;
  onDelete: (expense: ExpenseItem) => Promise<void> | void;
}

const ExpenseRow: React.FC<ExpenseRowProps> = ({
  item,
  currency,
  isOpenRow,
  onOpenChange,
  onUpdate,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editAmountStr, setEditAmountStr] = useState(item.amount.toFixed(2));
  const [editDate, setEditDate] = useState(() =>
    toDateInputValue(item.timestamp),
  );
  const [editTime, setEditTime] = useState(() =>
    item.hasTime === false ? '' : toTimeInputValue(item.timestamp),
  );

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
  React.useEffect(() => {
    const target = isOpenRow ? -ACTION_REVEAL_WIDTH : 0;
    const controls = animate(x, target, SPRING_CRITICALLY_DAMPED);
    return () => controls.stop();
  }, [isOpenRow, x]);

  const showTime = item.hasTime !== false;
  const timeFormatted = showTime
    ? new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(item.timestamp))
    : null;

  const startEditing = () => {
    onOpenChange(null);
    setEditTitle(item.title);
    setEditAmountStr(
      currency === 'JPY'
        ? String(Math.round(item.amount))
        : item.amount.toFixed(2),
    );
    setEditDate(toDateInputValue(item.timestamp));
    setEditTime(item.hasTime === false ? '' : toTimeInputValue(item.timestamp));
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = editTitle.trim();
    const parsedAmount = parseFloat(editAmountStr);
    if (!trimmed || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;

    const hasSpecificTime = editTime.trim().length > 0;
    await onUpdate(item.id, {
      title: trimmed,
      amount: Math.round(parsedAmount * 100) / 100,
      timestamp: fromDateAndTimeInputs(editDate, editTime, item.timestamp),
      hasTime: hasSpecificTime,
    });
    setIsEditing(false);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing) return;
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
    if (!state || isEditing) return;

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
      (currentX < -95 && vx < -950)
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
      {isEditing ? (
        <form onSubmit={handleSaveEdit} className="p-3.5 space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editTitle}
              maxLength={120}
              onChange={(e) => setEditTitle(e.target.value)}
              aria-label="Edit item name"
              className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[16px] text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
              autoFocus
            />
            <input
              type="text"
              inputMode="decimal"
              value={editAmountStr}
              onChange={(e) =>
                setEditAmountStr(e.target.value.replace(/[^0-9.]/g, ''))
              }
              aria-label="Edit cost"
              className="w-24 h-10 px-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[16px] font-semibold tabular-nums text-right text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 grid grid-cols-2 gap-1.5">
              <div className="relative flex items-center">
                <Calendar className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="date"
                  aria-label="Edit date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full h-9 pl-7 pr-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[12px] tabular-nums text-neutral-700 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
              </div>

              <div className="relative flex items-center">
                <Clock className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="time"
                  aria-label="Edit optional time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="w-full h-9 pl-7 pr-6 rounded-xl bg-black/[0.04] dark:bg-white/[0.07] text-[12px] tabular-nums text-neutral-700 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
                {editTime && (
                  <button
                    type="button"
                    onClick={() => setEditTime('')}
                    aria-label="Clear time (whole day)"
                    className="pressable absolute right-1.5 p-0.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                aria-label="Cancel editing"
                className="pressable touch-target h-9 w-9 rounded-xl bg-black/[0.05] dark:bg-white/[0.08] text-neutral-600 dark:text-neutral-300 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                type="submit"
                aria-label="Save changes"
                className="pressable touch-target h-9 px-3 rounded-xl bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[13px] font-semibold inline-flex items-center gap-1"
              >
                <Check className="w-4 h-4" />
                <span>Save</span>
              </button>
            </div>
          </div>
        </form>
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
              onClick={startEditing}
              aria-label={`Edit ${item.title}`}
              className="pressable flex-1 bg-[#007AFF] dark:bg-[#0A84FF] text-white flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
            >
              <Pencil className="w-4 h-4" />
              <span>Edit</span>
            </button>
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

              {/* Quick accessible action buttons for non-swipe or desktop pointers */}
              <div className="flex items-center gap-0.5 ml-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditing();
                  }}
                  aria-label={`Edit ${item.title}`}
                  className="pressable p-2 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item);
                  }}
                  aria-label={`Delete ${item.title}`}
                  className="pressable p-2 rounded-lg text-neutral-400 hover:text-[#FF3B30] dark:hover:text-[#FF453A] hover:bg-[#FF3B30]/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
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
  onUpdateExpense,
  onDeleteExpense,
}) => {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
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
    <div className="space-y-5" aria-label="Itemized expenses">
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
                    isOpenRow={openRowId === item.id}
                    onOpenChange={setOpenRowId}
                    onUpdate={onUpdateExpense}
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
