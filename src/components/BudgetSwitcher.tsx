import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { Budget } from '../types/expense';
import { getSpringTransition } from '../lib/motion';

export interface BudgetSwitcherProps {
  /** All budgets, already sorted in display order. May be empty while loading. */
  budgets: Budget[];
  activeBudgetId: string;
  onSelectBudget: (budgetId: string) => void;
  /** Opens the budget editor in create mode */
  onCreateBudget: () => void;
}

/** Width of the soft fade applied to an overflowing scroll edge. */
const SCROLL_FADE_PX = 24;

const CHIP_BASE =
  "pressable relative inline-flex h-9 min-w-[44px] shrink-0 items-center justify-center rounded-full px-3.5 text-[13px] font-semibold tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";

const INACTIVE_CHIP =
  'border border-black/[0.055] bg-white/90 text-neutral-700 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:bg-white dark:border-white/[0.08] dark:bg-neutral-900/80 dark:text-neutral-200 dark:hover:bg-neutral-800';

const PLUS_CHIP =
  "pressable relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/[0.055] bg-white/90 text-neutral-500 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 dark:border-white/[0.08] dark:bg-neutral-900/80 dark:text-neutral-300 dark:hover:bg-neutral-800 after:absolute after:-inset-1 after:content-['']";

/** Skeleton pill widths keep the loading row visually close to real chips. */
const PLACEHOLDER_WIDTHS = ['w-24', 'w-16', 'w-20'];

export const BudgetSwitcher: React.FC<BudgetSwitcherProps> = ({
  budgets,
  activeBudgetId,
  onSelectBudget,
  onCreateBudget,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const isLoading = budgets.length === 0;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [edgeFade, setEdgeFade] = useState({ left: false, right: false });

  // Detect overflow so we only mask the edges that actually have content behind them.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const updateEdgeFade = () => {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      const left = scroller.scrollLeft > 1;
      const right = maxScroll > 1 && scroller.scrollLeft < maxScroll - 1;
      setEdgeFade((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };

    updateEdgeFade();
    scroller.addEventListener('scroll', updateEdgeFade, { passive: true });
    window.addEventListener('resize', updateEdgeFade);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateEdgeFade);
      observer.observe(scroller);
      if (contentRef.current) observer.observe(contentRef.current);
    }

    return () => {
      scroller.removeEventListener('scroll', updateEdgeFade);
      window.removeEventListener('resize', updateEdgeFade);
      observer?.disconnect();
    };
  }, []);

  const scrollChipIntoView = useCallback(
    (index: number) => {
      const chip = chipRefs.current[index];
      if (!chip) return;
      chip.scrollIntoView({
        inline: 'nearest',
        block: 'nearest',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    },
    [prefersReducedMotion],
  );

  // Keep the selected chip visible when the active budget changes from elsewhere
  // (e.g. a newly created budget) or when the list first arrives.
  useEffect(() => {
    if (budgets.length === 0) return;
    const index = budgets.findIndex((budget) => budget.id === activeBudgetId);
    if (index === -1) return;
    scrollChipIntoView(index);
  }, [activeBudgetId, budgets, scrollChipIntoView]);

  const handleChipKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    const nextIndex = index + (event.key === 'ArrowRight' ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= budgets.length) return;

    event.preventDefault();
    chipRefs.current[nextIndex]?.focus({ preventScroll: true });
    scrollChipIntoView(nextIndex);
  };

  const scrollMask =
    edgeFade.left && edgeFade.right
      ? `linear-gradient(to right, transparent 0, #000 ${SCROLL_FADE_PX}px, #000 calc(100% - ${SCROLL_FADE_PX}px), transparent 100%)`
      : edgeFade.left
        ? `linear-gradient(to right, transparent 0, #000 ${SCROLL_FADE_PX}px)`
        : edgeFade.right
          ? `linear-gradient(to right, #000 calc(100% - ${SCROLL_FADE_PX}px), transparent 100%)`
          : undefined;

  return (
    <nav aria-label="Budgets" aria-busy={isLoading}>
      <div
        ref={scrollRef}
        style={{
          scrollbarWidth: 'none',
          maskImage: scrollMask,
          WebkitMaskImage: scrollMask,
        }}
        className="-mx-4 flex overflow-x-auto overscroll-x-contain px-4 py-1 [&::-webkit-scrollbar]:hidden"
      >
        <div ref={contentRef} className="flex w-max items-center gap-1.5">
          {isLoading ? (
            <>
              <span className="sr-only">Loading budgets</span>
              {PLACEHOLDER_WIDTHS.map((width, index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  className={`h-9 shrink-0 rounded-full bg-black/[0.05] dark:bg-white/[0.07] ${width}`}
                />
              ))}
            </>
          ) : (
            <>
              {budgets.map((budget, index) => {
                const isActive = budget.id === activeBudgetId;
                return (
                  <button
                    key={budget.id}
                    ref={(node) => {
                      chipRefs.current[index] = node;
                    }}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSelectBudget(budget.id)}
                    onKeyDown={(event) => handleChipKeyDown(event, index)}
                    className={`${CHIP_BASE} ${
                      isActive
                        ? 'text-white dark:text-neutral-900'
                        : INACTIVE_CHIP
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="budgetSwitcherActivePill"
                        transition={getSpringTransition(prefersReducedMotion)}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full bg-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.16)] dark:bg-white"
                      />
                    )}
                    <span className="relative max-w-[168px] truncate">
                      {budget.name}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={onCreateBudget}
                aria-label="New budget"
                className={PLUS_CHIP}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};
