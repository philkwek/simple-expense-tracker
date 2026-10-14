import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import {
  X,
  Eye,
  EyeOff,
  Cloud,
  CheckCircle2,
  LogOut,
  UserCheck,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { SyncState, UserProfile } from '../types/expense';
import {
  signInWithEmail,
  signUpWithEmail,
  signOutUser,
  updateUserDisplayName,
} from '../services/authService';
import {
  SPRING_CRITICALLY_DAMPED,
  SPRING_MOMENTUM,
  applyRubberbandBounds,
} from '../lib/motion';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  syncState: SyncState;
  onUserUpdated: (updated: UserProfile) => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  user,
  syncState,
  onUserUpdated,
}) => {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
      setErrorMsg(null);
      setSuccessMsg(null);
      setDisplayName(user.displayName || '');
    }
  }, [isOpen, user.displayName, sheetY]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

    // 1:1 downward tracking, progressive rubber-band when pulling upward past 0
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

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      if (mode === 'signup') {
        const updated = await signUpWithEmail(email, password, displayName);
        onUserUpdated(updated);
        setSuccessMsg('Account linked! Your expenses are synced to Firebase.');
        setPassword('');
      } else {
        const updated = await signInWithEmail(email, password);
        onUserUpdated(updated);
        setSuccessMsg('Signed in! Your cloud budget is active.');
        setPassword('');
      }
    } catch (err: unknown) {
      setErrorMsg(
        (err as { message?: string })?.message || 'Could not complete sign in.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const updated = await updateUserDisplayName(displayName);
      onUserUpdated(updated);
      setSuccessMsg('Display name updated.');
    } catch (err: unknown) {
      setErrorMsg(
        (err as { message?: string })?.message || 'Could not update profile.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await signOutUser();
      onClose();
    } catch (err: unknown) {
      setErrorMsg(
        (err as { message?: string })?.message || 'Could not sign out.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-modal-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          {/* Translucent Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING_CRITICALLY_DAMPED}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Mobile Bottom Sheet / Desktop Modal Surface */}
          <motion.div
            style={{ y: sheetY }}
            initial={{ opacity: 0, y: 120, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 120, scale: 0.98 }}
            transition={SPRING_CRITICALLY_DAMPED}
            className="relative z-10 w-full max-w-md rounded-t-[28px] sm:rounded-[28px] material-glass bg-white/95 dark:bg-neutral-900/95 p-5 pb-8 sm:pb-6 shadow-2xl max-h-[90dvh] overflow-y-auto"
          >
            {/* Bottom Sheet Grab Handle (1:1 pointer drag-to-dismiss) */}
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
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-[#007AFF]/12 dark:bg-[#0A84FF]/20 text-[#007AFF] dark:text-[#0A84FF] flex items-center justify-center">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="account-modal-title"
                    className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white"
                  >
                    Account & Cloud Sync
                  </h2>
                  <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                    {syncState === 'synced'
                      ? 'Synced with Firebase Cloud Firestore'
                      : syncState === 'syncing'
                        ? 'Syncing changes...'
                        : 'Saved on device'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close account sheet"
                className="pressable touch-target w-9 h-9 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-300 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {user.isAnonymous ? (
              <div className="space-y-4">
                {/* Guest Upgrade Notice Banner */}
                <div className="rounded-2xl bg-[#007AFF]/[0.07] dark:bg-[#0A84FF]/[0.12] border border-[#007AFF]/15 p-3.5 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF] shrink-0 mt-0.5" />
                  <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                    You’re currently browsing in <strong>Guest Mode</strong>.
                    Create an account or sign in to back up your budget and
                    expenses across all your devices without losing current data.
                  </p>
                </div>

                {/* Segmented Mode Switcher: Create Account vs Sign In */}
                <div className="grid grid-cols-2 p-1 rounded-2xl bg-black/[0.05] dark:bg-white/[0.07] relative">
                  {(['signup', 'signin'] as const).map((tab) => {
                    const active = mode === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          setMode(tab);
                          setErrorMsg(null);
                          setSuccessMsg(null);
                        }}
                        className={`pressable relative z-10 py-2 text-[13px] font-semibold rounded-xl transition-colors ${
                          active
                            ? 'text-neutral-900 dark:text-white'
                            : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                      >
                        {active && (
                          <motion.div
                            layoutId="accountAuthTab"
                            transition={SPRING_CRITICALLY_DAMPED}
                            className="absolute inset-0 rounded-xl bg-white dark:bg-neutral-800 shadow-sm -z-10"
                          />
                        )}
                        {tab === 'signup' ? 'Create Account' : 'Sign In'}
                      </button>
                    );
                  })}
                </div>

                {/* Semantic Autofill-Compliant Form (modern-web-guidance) */}
                <form onSubmit={handleAuthSubmit} className="space-y-3">
                  {mode === 'signup' && (
                    <div>
                      <label
                        htmlFor="account-name"
                        className="block text-[12px] font-medium text-neutral-600 dark:text-neutral-300 mb-1"
                      >
                        Name (optional)
                      </label>
                      <input
                        id="account-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        placeholder="Alex"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[16px] text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                      />
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="account-email"
                      className="block text-[12px] font-medium text-neutral-600 dark:text-neutral-300 mb-1"
                    >
                      Email Address
                    </label>
                    <input
                      id="account-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[16px] text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="account-password"
                      className="block text-[12px] font-medium text-neutral-600 dark:text-neutral-300 mb-1"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="account-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={
                          mode === 'signup' ? 'new-password' : 'current-password'
                        }
                        minLength={6}
                        required
                        placeholder={
                          mode === 'signup'
                            ? 'At least 6 characters'
                            : 'Enter your password'
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[16px] text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        aria-pressed={showPassword}
                        className="pressable touch-target absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 flex items-center justify-center"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {errorMsg && (
                    <div
                      role="alert"
                      className="rounded-xl bg-[#FF3B30]/10 text-[#FF3B30] dark:text-[#FF453A] px-3 py-2 text-[13px] font-medium"
                    >
                      {errorMsg}
                    </div>
                  )}

                  {successMsg && (
                    <div
                      role="status"
                      className="rounded-xl bg-[#34C759]/12 text-[#248A3D] dark:text-[#30D158] px-3 py-2 text-[13px] font-medium flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{successMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="pressable w-full h-11 rounded-2xl bg-[#007AFF] dark:bg-[#0A84FF] text-white text-[15px] font-semibold shadow-sm disabled:opacity-50"
                  >
                    {isLoading
                      ? 'Saving...'
                      : mode === 'signup'
                        ? 'Save Account & Sync Data'
                        : 'Sign In & Sync'}
                  </button>
                </form>
              </div>
            ) : (
              /* Signed-In Permanent Account View */
              <div className="space-y-4">
                <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] p-4 border border-black/[0.05] dark:border-white/[0.07] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#34C759] dark:text-[#30D158]">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Cloud Backup Active</span>
                    </div>
                    <div className="text-[15px] font-semibold text-neutral-900 dark:text-white truncate mt-0.5">
                      {user.email}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-[#007AFF]/12 text-[#007AFF] dark:bg-[#0A84FF]/20 dark:text-[#0A84FF] flex items-center justify-center font-semibold text-[15px] shrink-0">
                    {(user.displayName || user.email || 'U')
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                </div>

                <form onSubmit={handleUpdateDisplayName} className="space-y-2.5">
                  <label
                    htmlFor="profile-display-name"
                    className="block text-[12px] font-medium text-neutral-600 dark:text-neutral-300"
                  >
                    Display Name
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="profile-display-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      placeholder="Your name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="flex-1 h-11 px-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[16px] text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                    />
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="pressable h-11 px-4 rounded-xl bg-black/[0.06] dark:bg-white/[0.1] text-[14px] font-semibold text-neutral-900 dark:text-white inline-flex items-center gap-1.5"
                    >
                      <UserCheck className="w-4 h-4" />
                      <span>Update</span>
                    </button>
                  </div>
                </form>

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-xl bg-[#FF3B30]/10 text-[#FF3B30] dark:text-[#FF453A] px-3 py-2 text-[13px] font-medium"
                  >
                    {errorMsg}
                  </div>
                )}

                {successMsg && (
                  <div
                    role="status"
                    className="rounded-xl bg-[#34C759]/12 text-[#248A3D] dark:text-[#30D158] px-3 py-2 text-[13px] font-medium flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-black/[0.06] dark:border-white/[0.08]">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={isLoading}
                    className="pressable w-full h-11 rounded-2xl bg-[#FF3B30]/10 hover:bg-[#FF3B30]/15 text-[#FF3B30] dark:text-[#FF453A] text-[14px] font-semibold inline-flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
