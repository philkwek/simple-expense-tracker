import { AnimatePresence, motion } from 'framer-motion';

/**
 * Full-screen splash shown until the user's data has loaded. Its markup and
 * `.splash*` styles mirror the static copy in index.html, so the hand-off from
 * the pre-React splash to this one is invisible.
 */
export function LoadingScreen({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          className="splash"
          role="status"
          aria-label="Loading your budgets"
          initial={false}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
        >
          <img className="splash-icon" src="/favicon.svg" alt="" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
