import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { PeriodWindow } from '../types/expense';
import { formatCurrency } from '../utils/periodCalculator';
import { SPRING_CRITICALLY_DAMPED, SPRING_MOMENTUM } from '../lib/motion';

interface BudgetCardProps {
  budget: number;
  totalSpent: number;
  currency: string;
  period: PeriodWindow;
  periodOffset: number;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onResetPeriod: () => void;
  onOpenSettings: () => void;
}

export const BudgetCard: React.FC<BudgetCardProps> = ({
  budget,
  totalSpent,
  currency,
  period,
  periodOffset,
  onPrevPeriod,
  onNextPeriod,
  onResetPeriod,
  onOpenSettings,
}) => {
  const safeBudget = Math.max(0, budget);
  const leftover = safeBudget - totalSpent;
  const isOverBudget = leftover < -0.004;
  const remainingRatio = safeBudget > 0 ? leftover / safeBudget : 0;
  const isWarning = !isOverBudget && safeBudget > 0 && remainingRatio < 0.15;

  const spentPercentage =
    safeBudget > 0 ? Math.min(100, Math.max(0, (totalSpent / safeBudget) * 100)) : totalSpent > 0 ? 100 : 0;

  // Color state tokens following Apple semantic colors
  const balanceColorClass = isOverBudget
    ? 'text-[#FF3B30] dark:text-[#FF453A]'
    : isWarning
      ? 'text-[#FF9500] dark:text-[#FF9F0A]'
      : 'text-neutral-900 dark:text-white';

  const barColorClass = isOverBudget
    ? 'bg-[#FF3B30] dark:bg-[#FF453A]'
    : isWarning
      ? 'bg-[#FF9500] dark:bg-[#FF9F0A]'
      : 'bg-[#34C759] dark:bg-[#30D158]';

  const statusBadgeClass = isOverBudget
    ? 'bg-[#FF3B30]/12 text-[#FF3B30] dark:bg-[#FF453A]/18 dark:text-[#FF453A]'
    : isWarning
      ? 'bg-[#FF9500]/12 text-[#D97706] dark:bg-[#FF9F0A]/18 dark:text-[#FF9F0A]'
      : 'bg-[#34C759]/12 text-[#248A3D] dark:bg-[#30D158]/18 dark:text-[#30D158]';

  return (
    <motion.section
      layout
      transition={SPRING_CRITICALLY_DAMPED}
      aria-label="Budget overview"
      className="w-full select-none"
    >
      {/* Top Bar: Active Cycle Navigation & Countdown Pill */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="inline-flex items-center bg-black/[0.04] dark:bg-white/[0.06] rounded-full p-0.5">
          <button
            type="button"
            onClick={onPrevPeriod}
            aria-label="Previous budget period"
            className="pressable touch-target flex items-center justify-center w-9 h-9 rounded-full text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={`${period.start.getTime()}-${period.end.getTime()}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={SPRING_CRITICALLY_DAMPED}
              className="px-2.5 text-[13px] font-semibold tracking-tight text-neutral-800 dark:text-neutral-100 whitespace-nowrap"
            >
              {period.label}
            </motion.span>
          </AnimatePresence>

          <button
            type="button"
            onClick={onNextPeriod}
            disabled={periodOffset >= 0}
            aria-label="Next budget period"
            className="pressable touch-target flex items-center justify-center w-9 h-9 rounded-full text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {periodOffset !== 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={SPRING_CRITICALLY_DAMPED}
              type="button"
              onClick={onResetPeriod}
              aria-label="Jump to current period"
              className="pressable inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] font-medium bg-[#007AFF]/12 text-[#007AFF] dark:bg-[#0A84FF]/20 dark:text-[#0A84FF]"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Current</span>
            </motion.button>
          )}

          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium ${statusBadgeClass}`}
          >
            {isOverBudget ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Clock className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate max-w-[130px]">{period.countdownLabel}</span>
          </span>
        </div>
      </div>

      {/* Primary Hero Metric: Leftover Balance */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500">
            {isOverBudget ? 'Over Budget By' : 'Leftover Balance'}
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="pressable text-[12px] font-medium text-[#007AFF] dark:text-[#0A84FF] hover:underline py-1"
          >
            Edit Budget
          </button>
        </div>

        <motion.div
          key={leftover}
          initial={{ scale: 0.985, opacity: 0.85 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={SPRING_CRITICALLY_DAMPED}
          className={`type-hero tabular-nums mt-0.5 ${balanceColorClass}`}
        >
          {isOverBudget
            ? `−${formatCurrency(Math.abs(leftover), currency)}`
            : formatCurrency(leftover, currency)}
        </motion.div>
      </div>

      {/* Fluid Spring Progress Track */}
      <div className="space-y-2">
        <div
          role="progressbar"
          aria-valuenow={Math.round(spentPercentage)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Budget usage percentage"
          className="h-2.5 w-full rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden p-0.5"
        >
          <motion.div
            initial={false}
            animate={{ width: `${spentPercentage}%` }}
            transition={SPRING_MOMENTUM}
            className={`h-full rounded-full ${barColorClass}`}
          />
        </div>

        {/* Secondary Metrics Row: Spent vs Total Budget */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="rounded-2xl bg-black/[0.025] dark:bg-white/[0.04] px-3.5 py-2.5 border border-black/[0.04] dark:border-white/[0.05]">
            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-neutral-400 dark:text-neutral-500">
              Total Spent
            </div>
            <div className="text-[16px] font-semibold tabular-nums tracking-tight text-neutral-800 dark:text-neutral-100 mt-0.5">
              {formatCurrency(totalSpent, currency)}
            </div>
          </div>

          <div className="rounded-2xl bg-black/[0.025] dark:bg-white/[0.04] px-3.5 py-2.5 border border-black/[0.04] dark:border-white/[0.05]">
            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-neutral-400 dark:text-neutral-500">
              Total Budget
            </div>
            <div className="text-[16px] font-semibold tabular-nums tracking-tight text-neutral-800 dark:text-neutral-100 mt-0.5">
              {formatCurrency(safeBudget, currency)}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
};
