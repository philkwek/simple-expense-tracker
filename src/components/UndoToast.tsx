import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';
import { ExpenseItem } from '../types/expense';
import { formatCurrency } from '../utils/periodCalculator';
import { SPRING_CRITICALLY_DAMPED } from '../lib/motion';

interface UndoToastProps {
  deletedExpense: ExpenseItem | null;
  currency: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export const UndoToast: React.FC<UndoToastProps> = ({
  deletedExpense,
  currency,
  onUndo,
  onDismiss,
}) => {
  return (
    <AnimatePresence>
      {deletedExpense && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-5 z-40 px-4 pointer-events-none flex justify-center safe-bottom"
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={SPRING_CRITICALLY_DAMPED}
            className="pointer-events-auto w-full max-w-sm rounded-2xl bg-white/95 dark:bg-neutral-800/95 text-neutral-900 dark:text-white backdrop-blur-xl px-4 py-3 shadow-lg border border-black/10 dark:border-white/10 flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1 text-[13px]">
              <span className="text-neutral-500 dark:text-neutral-300">Deleted </span>
              <span className="font-semibold text-neutral-900 dark:text-white truncate">
                {deletedExpense.title}
              </span>
              <span className="text-neutral-500 dark:text-neutral-300 tabular-nums">
                {' '}
                ({formatCurrency(deletedExpense.amount, currency)})
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onUndo}
                className="pressable inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[13px] font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="pressable p-1.5 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
