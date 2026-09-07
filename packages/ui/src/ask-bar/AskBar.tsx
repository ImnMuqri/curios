'use client';

import { useEffect, useState } from 'react';
import styles from './AskBar.module.css';

const CYCLE_MS = 4000;

/**
 * Shown only when this page has no questions at all -- every fact predates the
 * question column, or the page has no facts yet. FRONTEND.md's founding
 * constraint is that the bar never presents an empty prompt with no
 * suggestion, so there has to be something here.
 */
const FALLBACK = 'Ask about anything on this page';

/**
 * The signature. DESIGN.md: everything else stays quiet so this can be loud.
 *
 * A button, not an input. Tapping it opens the sheet, which is where typing
 * happens -- and a button is tabbable and fires on Enter without any of the
 * work a div would need to fake both.
 */
export function AskBar({
  questions,
  onOpen,
}: {
  questions: string[];
  onOpen: (seed: string) => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (questions.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => setIndex((i) => (i + 1) % questions.length), CYCLE_MS);
    return () => clearInterval(timer);
  }, [questions.length]);

  const showing = questions[index] ?? FALLBACK;

  return (
    <button
      type="button"
      className={styles.bar}
      // A fixed name, because the visible text rotates. Without it, what this
      // control announces itself as changes every four seconds.
      aria-label="Ask a question about this page"
      onClick={() => onOpen(showing)}
    >
      {/* Keyed by content so React remounts it and the wipe replays. */}
      <span key={showing} className={styles.question}>
        {showing}
      </span>
    </button>
  );
}
