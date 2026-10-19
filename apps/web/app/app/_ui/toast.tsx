'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './toast.module.css';

/** How long a toast stays, as the boards time it. */
export const TOAST_MS = 2400;

/**
 * The boards' toast: a dark pill at the foot of the screen with a tick and
 * one sentence ("Saved.", "Marked contacted."), gone after a moment.
 *
 * The live region is always in the page and only its words change, so a
 * screen reader hears each one; a region that appears together with its text
 * is often not read at all. `say` replaces whatever is showing and restarts
 * the clock; `say('')` clears it.
 */
export function useToast(ms = TOAST_MS): { say: (text: string) => void; toast: ReactNode } {
  const [text, setText] = useState('');
  // A new toast with the same words still has to play again.
  const [nth, setNth] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const say = useCallback(
    (next: string) => {
      clearTimeout(timer.current);
      setText(next);
      setNth((n) => n + 1);
      if (next) timer.current = setTimeout(() => setText(''), ms);
    },
    [ms],
  );

  const toast = (
    <div className={styles.slot} role="status">
      {text ? (
        <p key={nth} className={styles.toast}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          {text}
        </p>
      ) : null}
    </div>
  );

  return { say, toast };
}
