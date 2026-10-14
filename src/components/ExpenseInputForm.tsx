import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Calendar, Clock, X } from 'lucide-react';
import {
  toDateInputValue,
  toTimeInputValue,
  fromDateAndTimeInputs,
} from '../utils/periodCalculator';
import { SPRING_CRITICALLY_DAMPED } from '../lib/motion';

export interface CreateExpenseInput {
  title: string;
  amount: number;
  timestamp: number;
  hasTime: boolean;
}

interface ExpenseInputFormProps {
  currency: string;
  onAddExpense: (input: CreateExpenseInput) => Promise<void> | void;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  SGD: 'S$',
  CAD: 'CA$',
  AUD: 'A$',
  JPY: '¥',
};

export const ExpenseInputForm: React.FC<ExpenseInputFormProps> = ({
  currency,
  onAddExpense,
}) => {
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState<string>(() =>
    toDateInputValue(Date.now()),
  );
  // Empty string = whole day (user didn't pick a specific time)
  const [customTime, setCustomTime] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  const symbol = CURRENCY_SYMBOLS[currency] || '$';

  const handleToggleCustomDate = () => {
    setShowCustomDate((prev) => {
      const next = !prev;
      if (next) {
        setCustomDate(toDateInputValue(Date.now()));
        setCustomTime(''); // Default to whole day when opening manual date picker
      }
      return next;
    });
  };

  const applyQuickPreset = (preset: 'today' | 'yesterday' | 'now') => {
    const now = new Date();
    if (preset === 'today') {
      setCustomDate(toDateInputValue(now.getTime()));
      setCustomTime('');
    } else if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      setCustomDate(toDateInputValue(y.getTime()));
      setCustomTime('');
    } else if (preset === 'now') {
      setCustomDate(toDateInputValue(now.getTime()));
      setCustomTime(toTimeInputValue(now.getTime()));
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setAmountStr(raw);
    if (errorMsg) setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const numericAmount = parseFloat(amountStr);

    if (!trimmedTitle) {
      setErrorMsg('Enter an item name');
      titleInputRef.current?.focus();
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Enter a valid amount greater than 0');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const isManual = showCustomDate;
      const hasSpecificTime = !isManual || customTime.trim().length > 0;
      const timestamp = isManual
        ? fromDateAndTimeInputs(customDate, customTime)
        : Date.now();

      await onAddExpense({
        title: trimmedTitle,
        amount: Math.round(numericAmount * 100) / 100,
        timestamp,
        hasTime: hasSpecificTime,
      });

      setTitle('');
      setAmountStr('');
      setShowCustomDate(false);
      setCustomTime('');
    } catch {
      setErrorMsg('Could not save expense. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    title.trim().length > 0 && parseFloat(amountStr) > 0 && !isSubmitting;

  return (
    <motion.form
      layout
      transition={SPRING_CRITICALLY_DAMPED}
      onSubmit={handleSubmit}
      aria-label="Quick add expense"
      className="material-glass rounded-[22px] p-3.5"
    >
      {/* Primary 2-Input Quick Entry Row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <label htmlFor="expense-title-input" className="sr-only">
            Item Name
          </label>
          <input
            ref={titleInputRef}
            id="expense-title-input"
            name="title"
            type="text"
            placeholder="Coffee, groceries, taxi..."
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            className="w-full h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[16px] text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 transition-shadow"
          />
        </div>

        <div className="relative w-28 shrink-0">
          <label htmlFor="expense-amount-input" className="sr-only">
            Cost
          </label>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-medium text-neutral-400 dark:text-neutral-500 tabular-nums"
          >
            {symbol}
          </span>
          <input
            id="expense-amount-input"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amountStr}
            onChange={handleAmountChange}
            className="w-full h-11 pl-7 pr-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[16px] font-semibold tabular-nums text-right text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 transition-shadow"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="Add expense"
          className="pressable touch-target h-11 w-11 shrink-0 rounded-xl bg-[#007AFF] dark:bg-[#0A84FF] text-white flex items-center justify-center shadow-sm disabled:opacity-40 disabled:pointer-events-none"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>

      {/* Secondary Row: Timestamp Indicator & Manual Date Override Toggle */}
      <div className="flex items-center justify-between mt-2.5 px-1">
        <button
          type="button"
          onClick={handleToggleCustomDate}
          aria-expanded={showCustomDate}
          className={`pressable inline-flex items-center gap-1.5 text-[12px] font-medium rounded-full px-2.5 py-1 transition-colors ${
            showCustomDate
              ? 'bg-[#007AFF]/12 text-[#007AFF] dark:bg-[#0A84FF]/20 dark:text-[#0A84FF]'
              : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
          }`}
        >
          {showCustomDate ? (
            <Calendar className="w-3.5 h-3.5" />
          ) : (
            <Clock className="w-3.5 h-3.5" />
          )}
          <span>
            {showCustomDate
              ? customTime
                ? 'Custom date & time'
                : 'Custom date (Whole day)'
              : 'Now (Auto-timestamp)'}
          </span>
        </button>

        {errorMsg && (
          <span
            role="alert"
            className="text-[12px] font-medium text-[#FF3B30] dark:text-[#FF453A]"
          >
            {errorMsg}
          </span>
        )}
      </div>

      {/* Interruptible Spring-Expanded Date & Optional Time Drawer */}
      <AnimatePresence initial={false}>
        {showCustomDate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_CRITICALLY_DAMPED}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-2.5 border-t border-black/[0.06] dark:border-white/[0.08] flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => applyQuickPreset('today')}
                    className={`pressable px-2.5 py-1 rounded-lg text-[12px] font-medium ${
                      customDate === toDateInputValue(Date.now()) && !customTime
                        ? 'bg-[#007AFF]/15 text-[#007AFF] dark:bg-[#0A84FF]/25 dark:text-[#0A84FF]'
                        : 'bg-black/[0.04] dark:bg-white/[0.07] text-neutral-700 dark:text-neutral-200'
                    }`}
                  >
                    Today (All day)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickPreset('yesterday')}
                    className="pressable px-2.5 py-1 rounded-lg text-[12px] font-medium bg-black/[0.04] dark:bg-white/[0.07] text-neutral-700 dark:text-neutral-200"
                  >
                    Yesterday (All day)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickPreset('now')}
                    className="pressable px-2.5 py-1 rounded-lg text-[12px] font-medium bg-black/[0.04] dark:bg-white/[0.07] text-neutral-700 dark:text-neutral-200"
                  >
                    Specific time
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCustomDate(false)}
                  aria-label="Close custom date picker"
                  className="pressable p-1 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* Date Picker (Required when custom) */}
                <div className="relative flex items-center">
                  <Calendar className="w-4 h-4 text-neutral-400 absolute left-3 pointer-events-none" />
                  <input
                    type="date"
                    aria-label="Expense date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="w-full h-10 pl-9 pr-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[14px] tabular-nums text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                  />
                </div>

                {/* Optional Time Picker (Blank = Whole Day) */}
                <div className="relative flex items-center">
                  <Clock className="w-4 h-4 text-neutral-400 absolute left-3 pointer-events-none" />
                  <input
                    type="time"
                    aria-label="Optional expense time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-full h-10 pl-9 pr-7 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[14px] tabular-nums text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                  />
                  {customTime && (
                    <button
                      type="button"
                      onClick={() => setCustomTime('')}
                      aria-label="Clear time (set to whole day)"
                      className="pressable absolute right-2 p-0.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500 px-1">
                {customTime
                  ? 'Time will be displayed on this purchase.'
                  : 'No time selected — defaults to whole day (time hidden in feed).'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.form>
  );
};
