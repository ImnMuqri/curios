'use client';

import { forwardRef, useEffect, useState } from 'react';
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
 * A button, not an input. Tapping it switches the page into chat mode, which
 * is where typing happens -- and a button is tabbable and fires on Enter
 * without any of the work a div would need to fake both.
 *
 * Forwards its ref to the underlying button so the caller can return focus
 * to it when chat mode closes -- the one piece of chat mode's own DOM this
 * component has no way to reach itself.
 */
export const AskBar = forwardRef<HTMLButtonElement, { questions: string[]; onOpen: () => void }>(
  function AskBar({ questions, onOpen }, ref) {
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
        ref={ref}
        type="button"
        className={styles.bar}
        // A plain attribute, not the (hashed) CSS-module class: BentoPage's
        // own stylesheet hides this element in chat mode by reaching for
        // `[data-ask-bar]` directly, since the composer is meant to read as
        // this same control settling into place rather than a new one
        // appearing elsewhere.
        data-ask-bar
        // A fixed name, because the visible text rotates. Without it, what this
        // control announces itself as changes every four seconds.
        aria-label="Ask a question about this page"
        onClick={() => onOpen()}
      >
        {/* Keyed by content so React remounts it and the wipe replays. */}
        <span key={showing} className={styles.question}>
          {showing}
        </span>
      </button>
    );
  },
);
