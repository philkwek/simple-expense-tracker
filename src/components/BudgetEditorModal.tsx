import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useReducedMotion,
  animate,
} from 'framer-motion';
import {
  X,
  Plus,
  SlidersHorizontal,
  Calendar,
  Clock,
  DollarSign,
  Check,
  Trash2,
} from 'lucide-react';
import {
  Budget,
  BudgetCadence,
  BudgetInput,
  BUDGET_NAME_MAX_LENGTH,
  DEFAULT_USER_SETTINGS,
  SUPPORTED_CURRENCIES,
} from '../types/expense';
import { formatHourLabel, getOrdinalSuffix } from '../utils/periodCalculator';
import {
  SPRING_MOMENTUM,
  applyRubberbandBounds,
  getSpringTransition,
} from '../lib/motion';

export interface BudgetEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'create' starts from defaults; 'edit' loads `budget` */
  mode: 'create' | 'edit';
  /** The budget being edited; null in create mode */
  budget: Budget | null;
  /** False when this is the user's only budget: deleting is not allowed */
  canDelete: boolean;
  /** Persists the form. The modal closes itself after this resolves. */
  onSave: (input: BudgetInput) => Promise<void>;
  /** Deletes `budget` and all of its expenses. The modal closes itself after this resolves. */
  onDelete: () => Promise<void>;
  /** Resolves to how many expenses will be deleted along with `budget` */
  getExpenseCount: () => Promise<number>;
}

const WEEKDAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
];

const CADENCE_OPTIONS: readonly BudgetCadence[] = ['daily', 'weekly', 'monthly'];
const DAILY_HOURS =[0, 3, 4, 6, 9, 12, 18, 21];
const MONTHLY_COMMON_DAYS = [1, 5, 10, 15, 20, 25, 28, 30, 31];

const LABEL_CLASS =
  'block text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2';

export const BudgetEditorModal: React.FC<BudgetEditorModalProps> = ({
  isOpen,
  onClose,
  mode,
  budget,
  canDelete,
  onSave,
  onDelete,
  getExpenseCount,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const springTransition = getSpringTransition(prefersReducedMotion);

  const [name, setName] = useState('');
  const [amountStr, setAmountStr] = useState(
    String(DEFAULT_USER_SETTINGS.budget),
  );
  const [cadence, setCadence] = useState<BudgetCadence>(
    DEFAULT_USER_SETTINGS.cadence,
  );
  const [periodStartDay, setPeriodStartDay] = useState<number>(
    DEFAULT_USER_SETTINGS.periodStartDay,
  );
  const [currency, setCurrency] = useState<string>(
    DEFAULT_USER_SETTINGS.currency,
  );
  const [isSaving, setIsSaving] = useState(false);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [expenseCount, setExpenseCount] = useState<number | null>(null);
  const [expenseCountFailed, setExpenseCountFailed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const sheetY = useMotionValue(0);

  // Measured height of the active cadence panel, so the container can animate between sizes.
  const cadencePanelRef = useRef<HTMLDivElement>(null);
  const [cadencePanelHeight, setCadencePanelHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = cadencePanelRef.current;
    if (!isOpen || !el) return;
    setCadencePanelHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setCadencePanelHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen]);
  const dragStateRef = useRef<{
    startY: number;
    lastY: number;
    lastTime: number;
    velocityY: number;
  } | null>(null);

  // Keep the latest counter callback without restarting an in-flight count.
  const getExpenseCountRef = useRef(getExpenseCount);
  useEffect(() => {
    getExpenseCountRef.current = getExpenseCount;
  }, [getExpenseCount]);

  // Load the form once per open (and re-load if the edited budget changes).
  // Layout effect so a previous session's delete confirmation never flashes on reopen.
  const lastInitializedRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!isOpen) {
      lastInitializedRef.current = null;
      return;
    }
    const initKey = `${mode}:${budget?.id ?? ''}`;
    if (lastInitializedRef.current === initKey) return;
    lastInitializedRef.current = initKey;

    sheetY.set(0);
    setName(mode === 'edit' && budget ? budget.name : '');
    const initialAmount =
      mode === 'edit' && budget
        ? budget.amount
        : DEFAULT_USER_SETTINGS.budget;
    setAmountStr(String(initialAmount));
    setCadence(
      mode === 'edit' && budget ? budget.cadence : DEFAULT_USER_SETTINGS.cadence,
    );
    setPeriodStartDay(
      mode === 'edit' && budget
        ? budget.periodStartDay
        : DEFAULT_USER_SETTINGS.periodStartDay,
    );
    setCurrency(
      mode === 'edit' && budget
        ? budget.currency
        : DEFAULT_USER_SETTINGS.currency,
    );
    setIsSaving(false);
    setIsConfirmingDelete(false);
    setIsDeleting(false);
    setExpenseCount(null);
    setExpenseCountFailed(false);
  }, [isOpen, mode, budget, sheetY]);

  // Count the expenses that would be deleted while the confirmation is open.
  useEffect(() => {
    if (!isConfirmingDelete) return;
    let cancelled = false;
    setExpenseCount(null);
    setExpenseCountFailed(false);

    getExpenseCountRef
      .current()
      .then((count) => {
        if (!cancelled) setExpenseCount(count);
      })
      .catch(() => {
        if (!cancelled) setExpenseCountFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isConfirmingDelete]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isOpen || isSaving || isDeleting) return;
      // Escape steps back out of the delete confirmation before closing the sheet
      if (isConfirmingDelete) {
        setIsConfirmingDelete(false);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isSaving, isDeleting, isConfirmingDelete]);

  const handleCadenceSelect = (nextCadence: BudgetCadence) => {
    setCadence(nextCadence);
    if (nextCadence === 'daily' && (periodStartDay < 0 || periodStartDay > 23)) {
      setPeriodStartDay(0);
    } else if (
      nextCadence === 'weekly' &&
      (periodStartDay < 0 || periodStartDay > 6)
    ) {
      setPeriodStartDay(1); // Monday default
    } else if (
      nextCadence === 'monthly' &&
      (periodStartDay < 1 || periodStartDay > 31)
    ) {
      setPeriodStartDay(1); // 1st of month default
    }
  };

  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: performance.now(),
      velocityY: 0,
    };
  };

  const handleSheetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;

    const dy = e.clientY - state.startY;
    const now = performance.now();
    const dt = Math.max(1, now - state.lastTime);
    const instantVy = ((e.clientY - state.lastY) / dt) * 1000;
    state.velocityY = state.velocityY * 0.35 + instantVy * 0.65;
    state.lastY = e.clientY;
    state.lastTime = now;

    const boundedY = applyRubberbandBounds(dy, 0, 600, 180, 0.55);
    sheetY.set(boundedY);
  };

  const handleSheetPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    if (!state) return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture errors
    }

    const currentY = sheetY.get();
    const vy = state.velocityY;

    if (currentY > 110 || vy > 650) {
      onClose();
    } else {
      animate(sheetY, 0, {
        ...SPRING_MOMENTUM,
        velocity: vy,
      });
    }
  };

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (isConfirmingDelete) return;
    if (!trimmedName) return;

    const fallbackAmount =
      mode === 'edit' && budget ? budget.amount : DEFAULT_USER_SETTINGS.budget;
    const parsedAmount = parseFloat(amountStr);
    const validAmount =
      Number.isFinite(parsedAmount) && parsedAmount >= 0
        ? Math.round(parsedAmount * 100) / 100
        : fallbackAmount;

    setIsSaving(true);
    try {
      await onSave({
        name: trimmedName,
        amount: validAmount,
        cadence,
        periodStartDay,
        currency,
      });
      onClose();
    } catch {
      // Keep the sheet open so the user can retry.
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete();
      onClose();
    } catch {
      // Keep the sheet open so the user can retry.
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedCurrencyObj =
    SUPPORTED_CURRENCIES.find((c) => c.code === currency) ||
    SUPPORTED_CURRENCIES[0];

  const title = mode === 'create' ? 'New Budget' : 'Edit Budget';
  const subtitle =
    mode === 'create'
      ? 'Set an allowance and when it resets'
      : 'Change the allowance, cycle or currency';
  const submitLabel = isSaving
    ? 'Saving…'
    : mode === 'create'
      ? 'Create Budget'
      : 'Save Changes';

  const HeaderIcon = mode === 'create' ? Plus : SlidersHorizontal;

  const deleteDescription = expenseCountFailed
    ? "This also deletes all of its expenses. This can't be undone."
    : expenseCount === null
      ? 'Counting expenses…'
      : expenseCount === 0
        ? "It has no expenses. This can't be undone."
        : expenseCount === 1
          ? "This also deletes its 1 expense. This can't be undone."
          : `This also deletes its ${expenseCount} expenses. This can't be undone.`;

  const confirmOffsetY = prefersReducedMotion ? 0 : 6;

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="budget-editor-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springTransition}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/*
            Two layers so the enter/exit slide and the drag offset never fight over one `y`:
            the outer layer owns the presence animation, the inner surface owns the drag.
          */}
          <motion.div
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 120, scale: 0.98 }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1 }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 120, scale: 0.98 }
            }
            transition={springTransition}
            className="relative z-10 w-full max-w-md"
          >
          {/* Bottom Sheet / Modal Surface */}
          <motion.div
            style={{ y: sheetY }}
            className="w-full rounded-t-[28px] sm:rounded-[28px] material-glass bg-white/95 dark:bg-neutral-900/95 p-5 pb-8 sm:pb-6 shadow-2xl max-h-[90dvh] overflow-y-auto"
          >
            {/* Grab Handle */}
            <div
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerEnd}
              onPointerCancel={handleSheetPointerEnd}
              style={{ touchAction: 'none' }}
              className="w-full pt-1 pb-3 flex justify-center cursor-grab active:cursor-grabbing"
            >
              <div className="w-10 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between mb-5 gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 shrink-0 rounded-2xl bg-[#007AFF]/12 dark:bg-[#0A84FF]/20 text-[#007AFF] dark:text-[#0A84FF] flex items-center justify-center">
                  <HeaderIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="budget-editor-title"
                    className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white"
                  >
                    {title}
                  </h2>
                  <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                    {subtitle}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close budget editor"
                className="pressable touch-target w-9 h-9 shrink-0 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-300 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 1. Name */}
              <div>
                <label
                  htmlFor="budget-editor-name"
                  className={LABEL_CLASS}
                >
                  Name
                </label>
                <input
                  id="budget-editor-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Groceries"
                  maxLength={BUDGET_NAME_MAX_LENGTH}
                  autoFocus={mode === 'create'}
                  enterKeyHint="next"
                  autoComplete="off"
                  className="w-full h-12 px-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] text-[16px] font-medium text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
              </div>

              {/* 2. Budget amount per period */}
              <div>
                <label
                  htmlFor="budget-editor-amount"
                  className={LABEL_CLASS}
                >
                  Budget per period
                </label>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-4 text-[20px] font-semibold text-neutral-400 dark:text-neutral-500 tabular-nums">
                    {selectedCurrencyObj.symbol}
                  </span>
                  <input
                    id="budget-editor-amount"
                    type="text"
                    inputMode="decimal"
                    value={amountStr}
                    onChange={(e) =>
                      setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))
                    }
                    placeholder="150.00"
                    className="w-full h-14 pl-12 pr-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] text-[24px] font-bold tabular-nums tracking-tight text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                  />
                </div>
              </div>

              {/* 3. Budget Reset Cadence (Segmented Pill Control) */}
              <div>
                <span className={LABEL_CLASS}>Budget Cycle Cadence</span>
                <div className="grid grid-cols-3 p-1 rounded-2xl bg-black/[0.05] dark:bg-white/[0.07] relative">
                  {/*
                    One sliding indicator instead of a shared `layoutId` pill: a layoutId
                    element inside the sheet's AnimatePresence never reports its exit as
                    complete after it has moved, which left the invisible full-screen
                    dialog mounted and blocking every tap once the sheet was closed.
                  */}
                  <motion.div
                    aria-hidden="true"
                    initial={false}
                    animate={{ x: `${CADENCE_OPTIONS.indexOf(cadence) * 100}%` }}
                    transition={springTransition}
                    className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl bg-white dark:bg-neutral-800 shadow-sm"
                  />
                  {CADENCE_OPTIONS.map((option) => {
                    const isActive = cadence === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleCadenceSelect(option)}
                        aria-pressed={isActive}
                        className={`pressable relative z-10 py-2.5 text-[13px] font-semibold capitalize rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                          isActive
                            ? 'text-neutral-900 dark:text-white'
                            : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Dynamic Cycle Reset Boundary Selector */}
              {/* Height follows the active panel; panels crossfade (quick out, then in). */}
              <motion.div
                initial={false}
                animate={{ height: cadencePanelHeight ?? 'auto' }}
                transition={springTransition}
                className="-mx-1 -my-1 overflow-hidden"
              >
              <div ref={cadencePanelRef} className="px-1 py-1">
              <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={cadence}
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  y: prefersReducedMotion ? 0 : -6,
                  transition: { duration: 0.1, ease: 'easeIn' },
                }}
                transition={springTransition}
                className="space-y-2"
              >
                {cadence === 'daily' && (
                  <div>
                    <label
                      htmlFor="budget-editor-daily-cutoff"
                      className={`${LABEL_CLASS} flex items-center gap-1.5`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Daily Reset Cutoff Hour</span>
                    </label>
                    <div className="grid grid-cols-4 gap-1.5 mb-2">
                      {DAILY_HOURS.map((hr) => {
                        const selected = periodStartDay === hr;
                        return (
                          <button
                            key={hr}
                            type="button"
                            onClick={() => setPeriodStartDay(hr)}
                            aria-pressed={selected}
                            className={`pressable py-2 px-2 rounded-xl text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                              selected
                                ? 'bg-[#007AFF] dark:bg-[#0A84FF] text-white'
                                : 'bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'
                            }`}
                          >
                            {hr === 0
                              ? '12 AM'
                              : hr === 12
                                ? '12 PM'
                                : hr < 12
                                  ? `${hr} AM`
                                  : `${hr - 12} PM`}
                          </button>
                        );
                      })}
                    </div>
                    <select
                      id="budget-editor-daily-cutoff"
                      value={periodStartDay}
                      onChange={(e) => setPeriodStartDay(Number(e.target.value))}
                      className="w-full h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[15px] text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                    >
                      {Array.from({ length: 24 }, (_, hr) => (
                        <option key={hr} value={hr}>
                          Resets daily at {formatHourLabel(hr)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {cadence === 'weekly' && (
                  <div>
                    <span className={`${LABEL_CLASS} flex items-center gap-1.5`}>
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Starting Day of Week</span>
                    </span>
                    <div className="grid grid-cols-7 gap-1">
                      {WEEKDAYS.map((day) => {
                        const selected = periodStartDay === day.value;
                        return (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => setPeriodStartDay(day.value)}
                            aria-pressed={selected}
                            aria-label={day.label}
                            className={`pressable py-2.5 rounded-xl text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                              selected
                                ? 'bg-[#007AFF] dark:bg-[#0A84FF] text-white shadow-sm'
                                : 'bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'
                            }`}
                          >
                            {day.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {cadence === 'monthly' && (
                  <div>
                    <label
                      htmlFor="budget-editor-monthly-start"
                      className={`${LABEL_CLASS} flex items-center gap-1.5`}
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Starting Day of Month</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {MONTHLY_COMMON_DAYS.map((d) => {
                        const selected = periodStartDay === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setPeriodStartDay(d)}
                            aria-pressed={selected}
                            className={`pressable px-3 py-1.5 rounded-xl text-[12px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                              selected
                                ? 'bg-[#007AFF] dark:bg-[#0A84FF] text-white'
                                : 'bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'
                            }`}
                          >
                            {getOrdinalSuffix(d)}
                          </button>
                        );
                      })}
                    </div>
                    <select
                      id="budget-editor-monthly-start"
                      value={periodStartDay}
                      onChange={(e) => setPeriodStartDay(Number(e.target.value))}
                      className="w-full h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[15px] text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                        <option key={day} value={day}>
                          Starts on the {getOrdinalSuffix(day)} of each month
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </motion.div>
              </AnimatePresence>
              </div>
              </motion.div>

              {/* 5. Currency Selector */}
              <div>
                <span className={`${LABEL_CLASS} flex items-center gap-1.5`}>
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Currency</span>
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {SUPPORTED_CURRENCIES.map((c) => {
                    const selected = currency === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setCurrency(c.code)}
                        aria-pressed={selected}
                        className={`pressable py-2 px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                          selected
                            ? 'bg-[#007AFF] dark:bg-[#0A84FF] text-white shadow-sm'
                            : 'bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        <span>{c.code}</span>
                        <span className="opacity-70 text-[11px]">
                          {c.symbol}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Footer: submit + delete, or inline delete confirmation */}
              <AnimatePresence mode="wait" initial={false}>
                {isConfirmingDelete ? (
                  <motion.div
                    key="delete-confirmation"
                    initial={{ opacity: 0, y: confirmOffsetY }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: confirmOffsetY }}
                    transition={springTransition}
                    className="rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] p-4"
                  >
                    <h3 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-white break-words">
                      {`Delete "${budget?.name ?? trimmedName}"?`}
                    </h3>
                    <p
                      aria-live="polite"
                      className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400"
                    >
                      {deleteDescription}
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsConfirmingDelete(false)}
                        disabled={isDeleting}
                        className="pressable h-11 rounded-xl bg-white dark:bg-neutral-800 border border-black/[0.055] dark:border-white/[0.08] text-[15px] font-semibold text-neutral-700 dark:text-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmDelete}
                        disabled={isDeleting}
                        className="pressable h-11 rounded-xl bg-[#FF3B30] dark:bg-[#FF453A] text-white text-[15px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="footer-actions"
                    initial={{ opacity: 0, y: confirmOffsetY }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: confirmOffsetY }}
                    transition={springTransition}
                    className="space-y-0.5"
                  >
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="pressable w-full h-12 rounded-2xl bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[15px] font-semibold shadow-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                    >
                      <Check className="w-4 h-4 stroke-[2.5]" />
                      <span>{submitLabel}</span>
                    </button>

                    {mode === 'edit' &&
                      (canDelete ? (
                        <button
                          type="button"
                          onClick={() => setIsConfirmingDelete(true)}
                          className="pressable touch-target w-full h-11 inline-flex items-center justify-center gap-1.5 text-[#FF3B30] dark:text-[#FF453A] text-[15px] font-medium rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete Budget</span>
                        </button>
                      ) : (
                        <p className="pt-2 text-center text-[12px] text-neutral-400 dark:text-neutral-500">
                          You need at least one budget.
                        </p>
                      ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
