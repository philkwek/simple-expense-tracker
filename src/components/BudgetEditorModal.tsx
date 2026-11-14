import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useReducedMotion,
  animate,
  type Transition,
} from 'framer-motion';
import {
  X,
  Plus,
  SlidersHorizontal,
  Calendar,
  CalendarDays,
  Clock,
  DollarSign,
  Check,
  Trash2,
  Bell,
  ChevronDown,
} from 'lucide-react';
import {
  Budget,
  BudgetCadence,
  BudgetInput,
  BudgetKind,
  BUDGET_NAME_MAX_LENGTH,
  DEFAULT_USER_SETTINGS,
  QUICK_PICK_CURRENCY_CODES,
  REMINDER_MAX_TIMES,
  SUPPORTED_CURRENCIES,
  hasDateRange,
  getCurrencyOption,
  isZeroDecimalCurrency,
  roundToCurrency,
} from '../types/expense';
import {
  calculatePeriodWindow,
  formatCurrency,
  formatHourLabel,
  getCycleDayCount,
  getOrdinalSuffix,
  toDateInputValue,
} from '../utils/periodCalculator';
import {
  REMINDER_TIME_OPTIONS,
  formatReminderTime,
  normalizeReminderTimes,
} from '../utils/reminders';
import {
  ReminderSupport,
  enablePushNotifications,
  getNotificationPermission,
  getReminderSupport,
} from '../services/notificationService';
import {
  SPRING_MOMENTUM,
  applyRubberbandBounds,
  getSpringTransition,
} from '../lib/motion';

export interface BudgetEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Firebase uid of the signed-in user (or 'local-guest') */
  userId: string;
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
const KIND_OPTIONS: readonly BudgetKind[] = ['recurring', 'oneOff'];
const KIND_LABELS: Record<BudgetKind, string> = {
  recurring: 'Recurring',
  oneOff: 'One-off',
};
const DAILY_HOURS =[0, 3, 4, 6, 9, 12, 18, 21];
const MONTHLY_COMMON_DAYS = [1, 5, 10, 15, 20, 25, 28, 30, 31];
const DEFAULT_REMINDER_TIME = '20:00';

interface FormSnapshot {
  kind: BudgetKind;
  datesEnabled: boolean;
  startDate: string;
  endDate: string;
  name: string;
  amountStr: string;
  cadence: BudgetCadence;
  periodStartDay: number;
  currency: string;
  dailyTracking: boolean;
  remindersEnabled: boolean;
  reminderTimes: string[];
}

const serializeForm = (form: FormSnapshot): string => JSON.stringify(form);

const LABEL_CLASS =
  'block text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-400 dark:text-neutral-500 mb-2';

/**
 * A form section that grows/shrinks its height while fading, so the sections below
 * glide into place instead of jumping. Must be a direct child of `AnimatePresence`.
 *
 * The form's `space-y-5` gap is replaced by `pt-5` inside the clipped area: a margin
 * would appear/disappear instantly. The `-mx-1 px-1` / `-mb-1 pb-1` pairs leave room
 * for focus rings that would otherwise be clipped by `overflow-hidden`.
 */
const CollapsibleSection: React.FC<{
  transition: Transition;
  children: React.ReactNode;
}> = ({ transition, children }) => (
  <motion.div
    initial={{ height: 0, opacity: 0 }}
    animate={{
      height: 'auto',
      opacity: 1,
      transition: { height: transition, opacity: { duration: 0.2, delay: 0.05 } },
    }}
    exit={{
      height: 0,
      opacity: 0,
      transition: { height: transition, opacity: { duration: 0.1, ease: 'easeIn' } },
    }}
    className="!mt-0 -mx-1 -mb-1 overflow-hidden"
  >
    <div className="px-1 pt-5 pb-1">{children}</div>
  </motion.div>
);

const CURRENCY_CHIP_CLASS =
  'pressable py-2 px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40';
const CURRENCY_CHIP_SELECTED_CLASS =
  'bg-[#007AFF] dark:bg-[#0A84FF] text-white shadow-sm';
const CURRENCY_CHIP_IDLE_CLASS =
  'bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-300';

export const BudgetEditorModal: React.FC<BudgetEditorModalProps> = ({
  isOpen,
  onClose,
  userId,
  mode,
  budget,
  canDelete,
  onSave,
  onDelete,
  getExpenseCount,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const springTransition = getSpringTransition(prefersReducedMotion);

  const [kind, setKind] = useState<BudgetKind>('recurring');
  const [datesEnabled, setDatesEnabled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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
  const [isMoreCurrenciesOpen, setIsMoreCurrenciesOpen] = useState(false);
  const [dailyTracking, setDailyTracking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderTimes, setReminderTimes] = useState<string[]>([
    DEFAULT_REMINDER_TIME,
  ]);
  const [reminderSupport, setReminderSupport] = useState<ReminderSupport | null>(
    null,
  );
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const [isEnablingReminders, setIsEnablingReminders] = useState(false);
  // Invalidates in-flight permission work when the sheet closes or the user changes.
  const reminderSessionRef = useRef(0);

  // Turning reminders off must always work, even on a device that can't turn them on
  // (e.g. reminders were enabled from the installed app, now edited in a browser tab).
  const reminderSwitchDisabled =
    isEnablingReminders ||
    (!remindersEnabled &&
      (reminderSupport === 'needs-install' ||
        reminderSupport === 'unsupported' ||
        reminderSupport === 'unavailable'));

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [expenseCount, setExpenseCount] = useState<number | null>(null);
  const [expenseCountFailed, setExpenseCountFailed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form values as loaded, so closing an edited budget can warn about unsaved changes.
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

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
  }, [isOpen, kind]);

  // Measured height of the one-off date fields, so the Dates section can grow/shrink smoothly.
  const datesPanelRef = useRef<HTMLDivElement>(null);
  const [datesPanelHeight, setDatesPanelHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = datesPanelRef.current;
    if (!isOpen || !el) return;
    setDatesPanelHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setDatesPanelHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, kind, datesEnabled]);
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
  const [formSession, setFormSession] = useState(0);
  useLayoutEffect(() => {
    if (!isOpen) {
      lastInitializedRef.current = null;
      return;
    }
    const initKey = `${mode}:${budget?.id ?? ''}`;
    if (lastInitializedRef.current === initKey) return;
    lastInitializedRef.current = initKey;
    setFormSession((n) => n + 1);

    sheetY.set(0);
    const initialKind: BudgetKind =
      mode === 'edit' && budget && budget.kind === 'oneOff'
        ? 'oneOff'
        : 'recurring';
    setKind(initialKind);
    const initialDatesEnabled =
      mode === 'edit' && budget ? hasDateRange(budget) : false;
    const initialStartDate =
      mode === 'edit' && budget && initialDatesEnabled
        ? budget.startDate ?? ''
        : '';
    const initialEndDate =
      mode === 'edit' && budget && initialDatesEnabled
        ? budget.endDate ?? ''
        : '';
    setDatesEnabled(initialDatesEnabled);
    setStartDate(initialStartDate);
    setEndDate(initialEndDate);
    const initialName = mode === 'edit' && budget ? budget.name : '';
    setName(initialName);
    const initialAmount =
      mode === 'edit' && budget
        ? budget.amount
        : DEFAULT_USER_SETTINGS.budget;
    setAmountStr(String(initialAmount));
    const initialCadence =
      mode === 'edit' && budget ? budget.cadence : DEFAULT_USER_SETTINGS.cadence;
    setCadence(initialCadence);
    const initialPeriodStartDay =
      mode === 'edit' && budget
        ? budget.periodStartDay
        : DEFAULT_USER_SETTINGS.periodStartDay;
    setPeriodStartDay(initialPeriodStartDay);
    const initialCurrency =
      mode === 'edit' && budget
        ? budget.currency
        : DEFAULT_USER_SETTINGS.currency;
    setCurrency(initialCurrency);
    setIsMoreCurrenciesOpen(false);
    const initialDailyTracking =
      mode === 'edit' && budget ? budget.dailyTracking === true : false;
    setDailyTracking(initialDailyTracking);
    const initialReminders =
      mode === 'edit' && budget ? budget.reminders : undefined;
    const normalizedInitialTimes = initialReminders
      ? normalizeReminderTimes(initialReminders.times)
      : [];
    const initialRemindersEnabled = initialReminders
      ? initialReminders.enabled
      : false;
    const initialReminderTimes =
      normalizedInitialTimes.length > 0
        ? normalizedInitialTimes
        : [DEFAULT_REMINDER_TIME];
    setRemindersEnabled(initialRemindersEnabled);
    setReminderTimes(initialReminderTimes);
    setInitialSnapshot(
      serializeForm({
        kind: initialKind,
        datesEnabled: initialDatesEnabled,
        startDate: initialStartDate,
        endDate: initialEndDate,
        name: initialName,
        amountStr: String(initialAmount),
        cadence: initialCadence,
        periodStartDay: initialPeriodStartDay,
        currency: initialCurrency,
        dailyTracking: initialDailyTracking,
        remindersEnabled: initialRemindersEnabled,
        reminderTimes: initialReminderTimes,
      }),
    );
    setIsConfirmingDiscard(false);
    setReminderNotice(null);
    setIsEnablingReminders(false);
    setIsSaving(false);
    setIsConfirmingDelete(false);
    setIsDeleting(false);
    setExpenseCount(null);
    setExpenseCountFailed(false);
  }, [isOpen, mode, budget, sheetY]);

  // Bump the reminder session on every open/close so stale permission results are dropped.
  useEffect(() => {
    reminderSessionRef.current += 1;
  }, [isOpen, userId]);

  // Ask what this device supports whenever the sheet opens.
  useEffect(() => {
    if (!isOpen || !userId) return;
    const session = reminderSessionRef.current;
    let cancelled = false;
    setReminderSupport(null);

    getReminderSupport(userId)
      .then((support) => {
        if (!cancelled && reminderSessionRef.current === session) {
          setReminderSupport(support);
        }
      })
      .catch(() => {
        if (!cancelled && reminderSessionRef.current === session) {
          setReminderSupport('unsupported');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, userId]);

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

  const hasUnsavedChanges =
    mode === 'edit' &&
    initialSnapshot !== null &&
    serializeForm({
      kind,
      datesEnabled,
      startDate,
      endDate,
      name,
      amountStr,
      cadence,
      periodStartDay,
      currency,
      dailyTracking,
      remindersEnabled,
      reminderTimes,
    }) !== initialSnapshot;

  // Every dismissal path (X, backdrop, Escape, swipe down) goes through here so an
  // edited budget asks before throwing changes away.
  const requestClose = () => {
    if (hasUnsavedChanges && !isSaving && !isDeleting) {
      animate(sheetY, 0, SPRING_MOMENTUM);
      setIsConfirmingDiscard(true);
      return;
    }
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isOpen || isSaving || isDeleting) return;
      // Escape steps back out of a confirmation before closing the sheet
      if (isConfirmingDiscard) {
        setIsConfirmingDiscard(false);
      } else if (isConfirmingDelete) {
        setIsConfirmingDelete(false);
      } else {
        requestCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, isDeleting, isConfirmingDelete, isConfirmingDiscard]);

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

  const handleToggleDates = () => {
    if (datesEnabled) {
      setDatesEnabled(false);
      // Clearing keeps an undated one-off clean (and out of the unsaved-changes snapshot).
      setStartDate('');
      setEndDate('');
      return;
    }
    const today = new Date();
    const defaultEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 6,
    );
    setStartDate(toDateInputValue(today.getTime()));
    setEndDate(toDateInputValue(defaultEnd.getTime()));
    setDatesEnabled(true);
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
      requestClose();
    } else {
      animate(sheetY, 0, {
        ...SPRING_MOMENTUM,
        velocity: vy,
      });
    }
  };

  const trimmedName = name.trim();
  // "YYYY-MM-DD" sorts chronologically, so a plain string compare is enough.
  const dateRangeInvalid =
    kind === 'oneOff' &&
    datesEnabled &&
    !!startDate &&
    !!endDate &&
    endDate < startDate;
  const datesIncomplete =
    kind === 'oneOff' && datesEnabled && (!startDate || !endDate);
  const canSubmit =
    trimmedName.length > 0 &&
    !isSaving &&
    !dateRangeInvalid &&
    !datesIncomplete;

  const handleToggleReminders = () => {
    if (remindersEnabled) {
      setRemindersEnabled(false);
      setReminderNotice(null);
      return;
    }
    if (reminderSwitchDisabled) return;

    // Everything up to requestPermission() must run synchronously: iOS only
    // shows the prompt while the tap is still being handled.
    setRemindersEnabled(true);
    setReminderNotice(null);
    setIsEnablingReminders(true);
    const session = reminderSessionRef.current;

    void enablePushNotifications(userId)
      .then((result) => {
        if (reminderSessionRef.current !== session) return;
        if (result === 'granted') {
          setRemindersEnabled(true);
          setReminderNotice(null);
        } else if (result === 'denied') {
          setRemindersEnabled(false);
          setReminderNotice(
            'Notifications are blocked for Ledger. Allow them in your device settings.',
          );
        } else if (result === 'unsupported') {
          setRemindersEnabled(false);
          setReminderNotice("This browser can't show reminders.");
        } else {
          setRemindersEnabled(false);
          setReminderNotice("Couldn't turn on reminders. Try again.");
        }
      })
      .catch(() => {
        if (reminderSessionRef.current !== session) return;
        setRemindersEnabled(false);
        setReminderNotice("Couldn't turn on reminders. Try again.");
      })
      .finally(() => {
        if (reminderSessionRef.current === session) {
          setIsEnablingReminders(false);
        }
      });
  };

  const handleReminderTimeChange = (index: number, time: string) => {
    // Keep row order stable while editing; sorting happens on save.
    setReminderTimes((prev) => prev.map((value, i) => (i === index ? time : value)));
  };

  const handleRemoveReminder = (index: number) => {
    setReminderTimes((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleAddReminder = () => {
    setReminderTimes((prev) => {
      if (prev.length >= REMINDER_MAX_TIMES) return prev;
      // One empty row at a time; the user picks its time.
      if (prev.includes('')) return prev;
      return [...prev, ''];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (isConfirmingDelete) return;
    if (!trimmedName) return;
    if (dateRangeInvalid || datesIncomplete) return;

    const fallbackAmount =
      mode === 'edit' && budget ? budget.amount : DEFAULT_USER_SETTINGS.budget;
    const parsedAmount = parseFloat(amountStr);
    const validAmount =
      Number.isFinite(parsedAmount) && parsedAmount >= 0
        ? roundToCurrency(parsedAmount, currency)
        : fallbackAmount;

    const isOneOff = kind === 'oneOff';
    const includeDates = isOneOff && datesEnabled;
    // An undated one-off has no schedule to spread or remind against.
    const isUndatedOneOff = isOneOff && !datesEnabled;
    const hadReminders =
      mode === 'edit' && budget ? budget.reminders !== undefined : false;
    // Recurring budgets always allow reminders; one-off budgets only when dated.
    const remindersAllowed = !isUndatedOneOff;
    const reminders: BudgetInput['reminders'] =
      remindersAllowed && (remindersEnabled || hadReminders)
        ? {
            enabled: remindersEnabled,
            times: normalizeReminderTimes(reminderTimes),
            timeZone:
              Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          }
        : undefined;

    setIsSaving(true);
    try {
      await onSave({
        kind,
        ...(includeDates ? { startDate, endDate } : {}),
        name: trimmedName,
        amount: validAmount,
        cadence,
        periodStartDay,
        currency,
        dailyTracking: isUndatedOneOff ? false : dailyTracking,
        ...(reminders ? { reminders } : {}),
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

  const selectedCurrencyObj = getCurrencyOption(currency);
  const isWholeUnitCurrency = isZeroDecimalCurrency(currency);
  const quickPickCurrencies = QUICK_PICK_CURRENCY_CODES.map(getCurrencyOption);
  const moreCurrencies = SUPPORTED_CURRENCIES.filter(
    (c) => !QUICK_PICK_CURRENCY_CODES.includes(c.code),
  );
  // Selected currency lives under "More" (or isn't listed at all).
  const isMoreCurrencySelected = !QUICK_PICK_CURRENCY_CODES.includes(currency);

  const title = mode === 'create' ? 'New Budget' : 'Edit Budget';
  const isOneOffKind = kind === 'oneOff';
  const showDailyTracking = isOneOffKind ? datesEnabled : cadence !== 'daily';
  const showReminders = !isOneOffKind || datesEnabled;
  const subtitle =
    mode === 'create'
      ? isOneOffKind
        ? 'Set a total for a trip or one-off spend'
        : 'Set an allowance and when it resets'
      : isOneOffKind
        ? 'Change the total, dates or currency'
        : 'Change the allowance, cycle or currency';
  const submitLabel = isSaving
    ? 'Saving…'
    : mode === 'create'
      ? 'Create Budget'
      : 'Save Changes';

  const HeaderIcon = mode === 'create' ? Plus : SlidersHorizontal;

  const parsedDailyAmount = parseFloat(amountStr);
  const dailyTrackingAmount =
    Number.isFinite(parsedDailyAmount) && parsedDailyAmount >= 0
      ? parsedDailyAmount
      : 0;
  // One-offs spread over their chosen dates; recurring budgets over the active cycle.
  const allowanceWindow = calculatePeriodWindow(
    isOneOffKind
      ? { kind: 'oneOff', startDate, endDate, cadence, periodStartDay }
      : { cadence, periodStartDay },
    new Date(),
  );
  const allowanceDayCount = getCycleDayCount(allowanceWindow);
  const dailyTrackingPerDay = formatCurrency(
    dailyTrackingAmount / allowanceDayCount,
    currency,
  );

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

  const reminderSupportNotice = (() => {
    if (reminderSupport === 'needs-install') {
      return 'Add Ledger to your Home Screen to get reminders on iPhone.';
    }
    if (reminderSupport === 'unsupported') {
      return "This browser can't show reminders.";
    }
    if (reminderSupport === 'unavailable') {
      return userId === 'local-guest'
        ? 'Sign in to get reminders.'
        : "Reminders aren't available yet.";
    }
    if (getNotificationPermission() === 'denied') {
      return 'Notifications are blocked for Ledger. Allow them in your device settings.';
    }
    return null;
  })();

  const reminderHelperText = reminderNotice ?? reminderSupportNotice;

  const reminderAllowanceHelper = isOneOffKind
    ? dailyTracking && datesEnabled
      ? "Each reminder includes what's left of today's allowance."
      : "Each reminder includes what's left of this budget."
    : dailyTracking && cadence !== 'daily'
      ? "Each reminder includes what's left of today's allowance."
      : cadence === 'daily'
        ? "Each reminder includes what's left today."
        : "Each reminder includes what's left this cycle.";

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
            onClick={requestClose}
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
                onClick={requestClose}
                aria-label="Close budget editor"
                className="pressable touch-target w-9 h-9 shrink-0 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-300 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Budget type — chosen once, at creation (the service locks it afterwards). */}
              {mode === 'create' && (
                <div>
                  <span className={LABEL_CLASS}>Budget Type</span>
                  <div className="grid grid-cols-2 p-1 rounded-2xl bg-black/[0.05] dark:bg-white/[0.07] relative">
                    <motion.div
                      aria-hidden="true"
                      initial={false}
                      animate={{ x: `${KIND_OPTIONS.indexOf(kind) * 100}%` }}
                      transition={springTransition}
                      className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/2)] rounded-xl bg-white dark:bg-neutral-600 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10"
                    />
                    {KIND_OPTIONS.map((option) => {
                      const isActive = kind === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setKind(option)}
                          aria-pressed={isActive}
                          className={`pressable relative z-10 py-2.5 text-[13px] font-semibold rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                            isActive
                              ? 'text-neutral-900 dark:text-white'
                              : 'text-neutral-500 dark:text-neutral-400'
                          }`}
                        >
                          {KIND_LABELS[option]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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
                  {isOneOffKind ? 'Total budget' : 'Budget per period'}
                </label>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-4 text-[20px] font-semibold text-neutral-400 dark:text-neutral-500 tabular-nums">
                    {selectedCurrencyObj.symbol}
                  </span>
                  <input
                    id="budget-editor-amount"
                    type="text"
                    inputMode={isWholeUnitCurrency ? 'numeric' : 'decimal'}
                    value={amountStr}
                    onChange={(e) =>
                      setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))
                    }
                    placeholder={isWholeUnitCurrency ? '15000' : '150.00'}
                    // Room for multi-character symbols such as NT$ or CHF.
                    style={{
                      paddingLeft: `max(3rem, calc(1.5rem + ${selectedCurrencyObj.symbol.length}ch))`,
                    }}
                    className="w-full h-14 pr-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] text-[24px] font-bold tabular-nums tracking-tight text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                  />
                </div>
              </div>

              {/* 3+4. Cycle settings (recurring) or dates (one-off); one collapses as the other expands. */}
              <AnimatePresence initial={false} key={`type-sections-${formSession}`}>
              {!isOneOffKind && (
                <CollapsibleSection key="recurring" transition={springTransition}>
                <div className="space-y-5">
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
                    className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl bg-white dark:bg-neutral-600 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10"
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
                </div>
                </CollapsibleSection>
              )}

              {/* One-off: dates replace the cadence and cycle-boundary sections. */}
              {isOneOffKind && (
                <CollapsibleSection key="one-off" transition={springTransition}>
                  <span className={`${LABEL_CLASS} flex items-center gap-1.5`}>
                    <CalendarDays className="w-3.5 h-3.5" />
                    <span>Dates</span>
                  </span>
                  <div className="flex items-center justify-between gap-3 py-0.5">
                    <label
                      htmlFor="budget-editor-dates"
                      className="text-[15px] font-medium text-neutral-800 dark:text-neutral-100"
                    >
                      Set dates
                    </label>
                    <button
                      id="budget-editor-dates"
                      type="button"
                      role="switch"
                      aria-checked={datesEnabled}
                      aria-label="Set dates"
                      onClick={handleToggleDates}
                      className={`pressable relative w-[51px] h-[31px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                        datesEnabled
                          ? 'bg-[#34C759] dark:bg-[#30D158]'
                          : 'bg-black/[0.12] dark:bg-white/[0.16]'
                      }`}
                    >
                      <motion.span
                        aria-hidden="true"
                        initial={false}
                        animate={{ x: datesEnabled ? 20 : 0 }}
                        transition={springTransition}
                        className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-sm"
                      />
                    </button>
                  </div>
                  <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
                    {datesEnabled
                      ? 'For trips, holidays and anything short-term.'
                      : 'No dates — one running total.'}
                  </p>

                  {/* Height follows the date fields; they crossfade in/out like the cadence panel. */}
                  <motion.div
                    initial={false}
                    animate={{
                      height: datesEnabled ? datesPanelHeight ?? 'auto' : 0,
                    }}
                    transition={springTransition}
                    className="-mx-1 overflow-hidden"
                  >
                    <AnimatePresence initial={false}>
                      {datesEnabled && (
                        <motion.div
                          ref={datesPanelRef}
                          key="date-range"
                          initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{
                            opacity: 0,
                            y: prefersReducedMotion ? 0 : -6,
                            transition: { duration: 0.1, ease: 'easeIn' },
                          }}
                          transition={springTransition}
                          className="px-1 pt-3"
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label
                                htmlFor="budget-editor-start-date"
                                className={LABEL_CLASS}
                              >
                                Starts
                              </label>
                              <input
                                id="budget-editor-start-date"
                                type="date"
                                value={startDate}
                                max={endDate || undefined}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[15px] text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 [color-scheme:light] dark:[color-scheme:dark]"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor="budget-editor-end-date"
                                className={LABEL_CLASS}
                              >
                                Ends
                              </label>
                              <input
                                id="budget-editor-end-date"
                                type="date"
                                value={endDate}
                                min={startDate || undefined}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[15px] text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 [color-scheme:light] dark:[color-scheme:dark]"
                              />
                            </div>
                          </div>
                          {dateRangeInvalid && (
                            <p
                              role="alert"
                              className="mt-2 text-[13px] text-[#FF3B30] dark:text-[#FF453A]"
                            >
                              End date must be on or after the start date.
                            </p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </CollapsibleSection>
              )}
              </AnimatePresence>

              {/* 5. Daily Allowance Tracking (recurring weekly/monthly, dated one-offs) */}
              <AnimatePresence initial={false} key={`daily-tracking-${formSession}`}>
                {showDailyTracking && (
                  <CollapsibleSection key="daily-tracking" transition={springTransition}>
                    <span className={`${LABEL_CLASS} flex items-center gap-1.5`}>
                      <CalendarDays className="w-3.5 h-3.5" />
                      <span>Tracking</span>
                    </span>
                    <div className="flex items-center justify-between gap-3 py-0.5">
                      <label
                        htmlFor="budget-editor-daily-tracking"
                        className="text-[15px] font-medium text-neutral-800 dark:text-neutral-100"
                      >
                        Daily allowance
                      </label>
                      <button
                        id="budget-editor-daily-tracking"
                        type="button"
                        role="switch"
                        aria-checked={dailyTracking}
                        aria-label="Daily allowance"
                        onClick={() => setDailyTracking((prev) => !prev)}
                        className={`pressable relative w-[51px] h-[31px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                          dailyTracking
                            ? 'bg-[#34C759] dark:bg-[#30D158]'
                            : 'bg-black/[0.12] dark:bg-white/[0.16]'
                        }`}
                      >
                        <motion.span
                          aria-hidden="true"
                          initial={false}
                          animate={{ x: dailyTracking ? 20 : 0 }}
                          transition={springTransition}
                          className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-sm"
                        />
                      </button>
                    </div>
                    <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
                      {dailyTracking
                        ? `Starts at ≈ ${dailyTrackingPerDay}/day, adjusts as you spend.`
                        : isOneOffKind
                          ? `Spread across ${allowanceDayCount} ${
                              allowanceDayCount === 1 ? 'day' : 'days'
                            }, adjusting as you spend.`
                          : "Splits what's left of the budget across the remaining days in the cycle."}
                    </p>
                  </CollapsibleSection>
                )}
              </AnimatePresence>

              {/* 6. Reminders (recurring always, one-off only when dated) */}
              <AnimatePresence initial={false} key={`reminders-${formSession}`}>
              {showReminders && (
              <CollapsibleSection key="reminders" transition={springTransition}>
                <span className={`${LABEL_CLASS} flex items-center gap-1.5`}>
                  <Bell className="w-3.5 h-3.5" />
                  <span>Reminders</span>
                </span>
                <div className="flex items-center justify-between gap-3 py-0.5">
                  <label
                    htmlFor="budget-editor-reminders"
                    className="text-[15px] font-medium text-neutral-800 dark:text-neutral-100"
                  >
                    Remind me to log expenses
                  </label>
                  <button
                    id="budget-editor-reminders"
                    type="button"
                    role="switch"
                    aria-checked={remindersEnabled}
                    aria-disabled={reminderSwitchDisabled}
                    aria-label="Remind me to log expenses"
                    disabled={reminderSwitchDisabled}
                    onClick={handleToggleReminders}
                    className={`pressable relative w-[51px] h-[31px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                      remindersEnabled
                        ? 'bg-[#34C759] dark:bg-[#30D158]'
                        : 'bg-black/[0.12] dark:bg-white/[0.16]'
                    } ${reminderSwitchDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <motion.span
                      aria-hidden="true"
                      initial={false}
                      animate={{ x: remindersEnabled ? 20 : 0 }}
                      transition={springTransition}
                      className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-sm"
                    />
                  </button>
                </div>

                {reminderHelperText && (
                  <p
                    role={reminderNotice ? 'alert' : undefined}
                    className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400"
                  >
                    {reminderHelperText}
                  </p>
                )}

                {isOneOffKind && (
                  <p className="mt-1 text-[12px] text-neutral-400 dark:text-neutral-500">
                    Only sent between the start and end dates.
                  </p>
                )}

                <AnimatePresence initial={false}>
                  {remindersEnabled && (
                    <motion.div
                      key="reminder-times"
                      initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{
                        opacity: 0,
                        y: prefersReducedMotion ? 0 : -6,
                        transition: { duration: 0.1, ease: 'easeIn' },
                      }}
                      transition={springTransition}
                      className="mt-2 space-y-2"
                    >
                      {reminderTimes.map((time, index) => (
                        <div
                          key={time || 'empty'}
                          className="flex items-center gap-2"
                        >
                          <select
                            aria-label={`Reminder ${index + 1}`}
                            value={time}
                            onChange={(e) =>
                              handleReminderTimeChange(index, e.target.value)
                            }
                            className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[15px] text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                          >
                            {time === '' && (
                              <option value="" disabled>
                                Select time
                              </option>
                            )}
                            {REMINDER_TIME_OPTIONS.map((option) => (
                              <option
                                key={option}
                                value={option}
                                disabled={
                                  option !== time &&
                                  reminderTimes.includes(option)
                                }
                              >
                                {formatReminderTime(option)}
                              </option>
                            ))}
                          </select>
                          {reminderTimes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveReminder(index)}
                              aria-label={
                                time
                                  ? `Remove reminder at ${formatReminderTime(time)}`
                                  : 'Remove empty reminder'
                              }
                              className="pressable touch-target w-9 h-9 shrink-0 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-300 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}

                      {reminderTimes.length < REMINDER_MAX_TIMES && (
                        <button
                          type="button"
                          onClick={handleAddReminder}
                          className="pressable touch-target h-10 px-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white dark:bg-neutral-800 border border-black/[0.055] dark:border-white/[0.08] text-[#007AFF] dark:text-[#0A84FF] text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Add reminder</span>
                        </button>
                      )}

                      <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">
                        {reminderAllowanceHelper}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CollapsibleSection>
              )}
              </AnimatePresence>

              {/* 7. Currency Selector */}
              <div>
                <span className={`${LABEL_CLASS} flex items-center gap-1.5`}>
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Currency</span>
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {quickPickCurrencies.map((c) => {
                    const selected = currency === c.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => {
                          setCurrency(c.code);
                          setIsMoreCurrenciesOpen(false);
                        }}
                        aria-pressed={selected}
                        aria-label={`${c.name} (${c.code})`}
                        className={`${CURRENCY_CHIP_CLASS} ${
                          selected
                            ? CURRENCY_CHIP_SELECTED_CLASS
                            : CURRENCY_CHIP_IDLE_CLASS
                        }`}
                      >
                        <span>{c.code}</span>
                        <span className="opacity-70 text-[11px]">
                          {c.symbol}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setIsMoreCurrenciesOpen((open) => !open)}
                    aria-expanded={isMoreCurrenciesOpen}
                    aria-controls="budget-editor-more-currencies"
                    aria-label={
                      isMoreCurrencySelected
                        ? `More currencies, ${selectedCurrencyObj.name} (${currency}) selected`
                        : 'More currencies'
                    }
                    className={`${CURRENCY_CHIP_CLASS} ${
                      isMoreCurrencySelected
                        ? CURRENCY_CHIP_SELECTED_CLASS
                        : CURRENCY_CHIP_IDLE_CLASS
                    }`}
                  >
                    {isMoreCurrencySelected ? (
                      <>
                        <span>{currency}</span>
                        {selectedCurrencyObj.symbol !== currency && (
                          <span className="opacity-70 text-[11px]">
                            {selectedCurrencyObj.symbol}
                          </span>
                        )}
                      </>
                    ) : (
                      <span>More</span>
                    )}
                    <motion.span
                      aria-hidden="true"
                      initial={false}
                      animate={{ rotate: isMoreCurrenciesOpen ? 180 : 0 }}
                      transition={springTransition}
                      className="flex opacity-70"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </motion.span>
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {isMoreCurrenciesOpen && (
                    <motion.div
                      key="more-currencies"
                      id="budget-editor-more-currencies"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springTransition}
                      className="-mx-1 overflow-hidden"
                    >
                      <div
                        role="group"
                        aria-label="More currencies"
                        className="grid grid-cols-2 gap-1.5 px-1 pt-1.5 pb-1"
                      >
                        {moreCurrencies.map((c) => {
                          const selected = currency === c.code;
                          return (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => {
                                setCurrency(c.code);
                                setIsMoreCurrenciesOpen(false);
                              }}
                              aria-pressed={selected}
                              aria-label={`${c.name} (${c.code})`}
                              className={`pressable min-h-11 py-1.5 px-3 rounded-xl flex items-center gap-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 ${
                                selected
                                  ? CURRENCY_CHIP_SELECTED_CLASS
                                  : CURRENCY_CHIP_IDLE_CLASS
                              }`}
                            >
                              <span className="min-w-0 flex-1 text-left">
                                <span className="flex items-baseline gap-1 text-[13px] font-semibold">
                                  <span>{c.code}</span>
                                  {c.symbol !== c.code && (
                                    <span className="opacity-70 text-[11px]">
                                      {c.symbol}
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={`block truncate text-[11px] ${
                                    selected
                                      ? 'text-white/80'
                                      : 'text-neutral-500 dark:text-neutral-400'
                                  }`}
                                >
                                  {c.name}
                                </span>
                              </span>
                              {selected && (
                                <Check className="w-4 h-4 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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

          {/* Discard-changes confirmation, layered over the sheet so it's visible at any scroll position */}
          <AnimatePresence>
            {isConfirmingDiscard && (
              <motion.div
                key="discard-confirmation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={springTransition}
                onClick={() => setIsConfirmingDiscard(false)}
                className="absolute inset-0 z-20 flex items-center justify-center p-6 rounded-t-[28px] sm:rounded-[28px] bg-black/30"
              >
                <motion.div
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="budget-discard-title"
                  aria-describedby="budget-discard-description"
                  initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.96 }}
                  transition={springTransition}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-[300px] rounded-2xl bg-white dark:bg-neutral-800 p-4 shadow-2xl"
                >
                  <h3
                    id="budget-discard-title"
                    className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-white"
                  >
                    Discard changes?
                  </h3>
                  <p
                    id="budget-discard-description"
                    className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400"
                  >
                    You'll lose the changes you made to this budget.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setIsConfirmingDiscard(false)}
                      className="pressable h-11 rounded-xl bg-black/[0.05] dark:bg-white/[0.08] text-[15px] font-semibold text-neutral-700 dark:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                    >
                      Keep Editing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsConfirmingDiscard(false);
                        onClose();
                      }}
                      className="pressable h-11 rounded-xl bg-[#FF3B30] dark:bg-[#FF453A] text-white text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40"
                    >
                      Discard
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
