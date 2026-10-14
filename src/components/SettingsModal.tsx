import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import {
  X,
  SlidersHorizontal,
  Calendar,
  Clock,
  DollarSign,
  Check,
} from 'lucide-react';
import {
  BudgetCadence,
  SUPPORTED_CURRENCIES,
  UserSettings,
} from '../types/expense';
import {
  formatHourLabel,
  getOrdinalSuffix,
} from '../utils/periodCalculator';
import {
  SPRING_CRITICALLY_DAMPED,
  SPRING_MOMENTUM,
  applyRubberbandBounds,
} from '../lib/motion';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSaveSettings: (updates: Partial<UserSettings>) => Promise<void> | void;
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

const DAILY_HOURS = [0, 3, 4, 6, 9, 12, 18, 21];
const MONTHLY_COMMON_DAYS = [1, 5, 10, 15, 20, 25, 28, 30, 31];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const [budgetStr, setBudgetStr] = useState(String(settings.budget));
  const [cadence, setCadence] = useState<BudgetCadence>(settings.cadence);
  const [periodStartDay, setPeriodStartDay] = useState<number>(
    settings.periodStartDay,
  );
  const [currency, setCurrency] = useState<string>(settings.currency);
  const [isSaving, setIsSaving] = useState(false);

  const sheetY = useMotionValue(0);
  const dragStateRef = useRef<{
    startY: number;
    lastY: number;
    lastTime: number;
    velocityY: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      sheetY.set(0);
      setBudgetStr(String(settings.budget));
      setCadence(settings.cadence);
      setPeriodStartDay(settings.periodStartDay);
      setCurrency(settings.currency);
    }
  }, [isOpen, settings, sheetY]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedBudget = parseFloat(budgetStr);
    const validBudget =
      Number.isFinite(parsedBudget) && parsedBudget >= 0
        ? Math.round(parsedBudget * 100) / 100
        : settings.budget;

    setIsSaving(true);
    try {
      await onSaveSettings({
        budget: validBudget,
        cadence,
        periodStartDay,
        currency,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCurrencyObj =
    SUPPORTED_CURRENCIES.find((c) => c.code === currency) ||
    SUPPORTED_CURRENCIES[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING_CRITICALLY_DAMPED}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Bottom Sheet / Modal Surface */}
          <motion.div
            style={{ y: sheetY }}
            initial={{ opacity: 0, y: 120, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 120, scale: 0.98 }}
            transition={SPRING_CRITICALLY_DAMPED}
            className="relative z-10 w-full max-w-md rounded-t-[28px] sm:rounded-[28px] material-glass bg-white/95 dark:bg-neutral-900/95 p-5 pb-8 sm:pb-6 shadow-2xl max-h-[90dvh] overflow-y-auto"
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
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-[#007AFF]/12 dark:bg-[#0A84FF]/20 text-[#007AFF] dark:text-[#0A84FF] flex items-center justify-center">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="settings-modal-title"
                    className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white"
                  >
                    Budget & Cycle Settings
                  </h2>
                  <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                    Customize your allowance and reset cadence
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close settings"
                className="pressable touch-target w-9 h-9 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-300 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 1. Target Budget Input */}
              <div>
                <label
                  htmlFor="settings-budget-input"
                  className="block text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2"
                >
                  Target Spending Budget
                </label>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-4 text-[20px] font-semibold text-neutral-400 dark:text-neutral-500 tabular-nums">
                    {selectedCurrencyObj.symbol}
                  </span>
                  <input
                    id="settings-budget-input"
                    type="text"
                    inputMode="decimal"
                    value={budgetStr}
                    onChange={(e) =>
                      setBudgetStr(e.target.value.replace(/[^0-9.]/g, ''))
                    }
                    placeholder="150.00"
                    className="w-full h-14 pl-12 pr-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] text-[24px] font-bold tabular-nums tracking-tight text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                  />
                </div>
              </div>

              {/* 2. Budget Reset Cadence (Segmented Pill Control) */}
              <div>
                <span className="block text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2">
                  Budget Cycle Cadence
                </span>
                <div className="grid grid-cols-3 p-1 rounded-2xl bg-black/[0.05] dark:bg-white/[0.07] relative">
                  {(['daily', 'weekly', 'monthly'] as const).map((option) => {
                    const isActive = cadence === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleCadenceSelect(option)}
                        className={`pressable relative z-10 py-2.5 text-[13px] font-semibold capitalize rounded-xl transition-colors ${
                          isActive
                            ? 'text-neutral-900 dark:text-white'
                            : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="cadenceSegmentedPill"
                            transition={SPRING_CRITICALLY_DAMPED}
                            className="absolute inset-0 rounded-xl bg-white dark:bg-neutral-800 shadow-sm -z-10"
                          />
                        )}
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Dynamic Cycle Reset Boundary Selector */}
              <motion.div
                key={cadence}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING_CRITICALLY_DAMPED}
                className="space-y-2"
              >
                {cadence === 'daily' && (
                  <div>
                    <label
                      htmlFor="daily-cutoff-select"
                      className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2"
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
                            className={`pressable py-2 px-2 rounded-xl text-[12px] font-semibold transition-colors ${
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
                      id="daily-cutoff-select"
                      value={periodStartDay}
                      onChange={(e) =>
                        setPeriodStartDay(Number(e.target.value))
                      }
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
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2">
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
                            className={`pressable py-2.5 rounded-xl text-[12px] font-semibold transition-colors ${
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
                      htmlFor="monthly-start-day"
                      className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2"
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
                            className={`pressable px-3 py-1.5 rounded-xl text-[12px] font-semibold tabular-nums transition-colors ${
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
                      id="monthly-start-day"
                      value={periodStartDay}
                      onChange={(e) =>
                        setPeriodStartDay(Number(e.target.value))
                      }
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

              {/* 4. Currency Selector */}
              <div>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2">
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
                        className={`pressable py-2 px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1 transition-colors ${
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

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSaving}
                className="pressable w-full h-12 rounded-2xl bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[15px] font-semibold shadow-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>{isSaving ? 'Saving...' : 'Save Budget Settings'}</span>
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
