import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Calendar, Clock, X } from 'lucide-react';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '../utils/periodCalculator';
import { SPRING_CRITICALLY_DAMPED } from '../lib/motion';

export interface CreateExpenseInput {
  title: string;
  amount: number;
  timestamp: number;
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
  const [showCustomTime, setShowCustomTime] = useState(false);
  const [customDateTime, setCustomDateTime] = useState<string>(() =>
    toDateTimeLocalValue(Date.now())
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  const symbol = CURRENCY_SYMBOLS[currency] || '$';

  const handleToggleCustomTime = () => {
    setShowCustomTime((prev) => {
      const next = !prev;
      if (next) {
        setCustomDateTime(toDateTimeLocalValue(Date.now()));
      }
      return next;
    });
  };

  const applyQuickTimePreset = (preset: 'now' | 'yesterday' | 'morning') => {
    const now = new Date();
    if (preset === 'now') {
      setCustomDateTime(toDateTimeLocalValue(now.getTime()));
    } else if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      y.setHours(12, 0, 0, 0);
      setCustomDateTime(toDateTimeLocalValue(y.getTime()));
    } else if (preset === 'morning') {
      const m = new Date(now);
      m.setHours(9, 0, 0, 0);
      setCustomDateTime(toDateTimeLocalValue(m.getTime()));
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '');
    // Prevent multiple decimals
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
      const timestamp = showCustomTime
        ? fromDateTimeLocalValue(customDateTime)
        : Date.now();

      await onAddExpense({
        title: trimmedTitle,
        amount: Math.round(numericAmount * 100) / 100,
        timestamp,
      });

      // Reset inputs & keep mobile flow snappy
      setTitle('');
      setAmountStr('');
      setShowCustomTime(false);
    } catch {
      setErrorMsg('Could not save expense. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = title.trim().length > 0 && parseFloat(amountStr) > 0 && !isSubmitting;

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

      {/* Secondary Row: Timestamp Indicator & Manual Date/Time Override Toggle */}
      <div className="flex items-center justify-between mt-2.5 px-1">
        <button
          type="button"
          onClick={handleToggleCustomTime}
          aria-expanded={showCustomTime}
          className={`pressable inline-flex items-center gap-1.5 text-[12px] font-medium rounded-full px-2.5 py-1 transition-colors ${
            showCustomTime
              ? 'bg-[#007AFF]/12 text-[#007AFF] dark:bg-[#0A84FF]/20 dark:text-[#0A84FF]'
              : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{showCustomTime ? 'Custom date & time' : 'Now (Auto-timestamp)'}</span>
        </button>

        {errorMsg && (
          <span role="alert" className="text-[12px] font-medium text-[#FF3B30] dark:text-[#FF453A]">
            {errorMsg}
          </span>
        )}
      </div>

      {/* Interruptible Spring-Expanded Date/Time Picker Drawer */}
      <AnimatePresence initial={false}>
        {showCustomTime && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_CRITICALLY_DAMPED}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-2.5 border-t border-black/[0.06] dark:border-white/[0.08] flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyQuickTimePreset('now')}
                    className="pressable px-2.5 py-1 rounded-lg text-[12px] font-medium bg-black/[0.04] dark:bg-white/[0.07] text-neutral-700 dark:text-neutral-200"
                  >
                    Right now
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickTimePreset('morning')}
                    className="pressable px-2.5 py-1 rounded-lg text-[12px] font-medium bg-black/[0.04] dark:bg-white/[0.07] text-neutral-700 dark:text-neutral-200"
                  >
                    Today 9 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickTimePreset('yesterday')}
                    className="pressable px-2.5 py-1 rounded-lg text-[12px] font-medium bg-black/[0.04] dark:bg-white/[0.07] text-neutral-700 dark:text-neutral-200"
                  >
                    Yesterday
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCustomTime(false)}
                  aria-label="Close custom date picker"
                  className="pressable p-1 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="relative flex items-center">
                <Calendar className="w-4 h-4 text-neutral-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="datetime-local"
                  aria-label="Expense date and time"
                  value={customDateTime}
                  onChange={(e) => setCustomDateTime(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[15px] tabular-nums text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.form>
  );
};
