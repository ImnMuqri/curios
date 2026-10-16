'use client';

import { useCallback, useState } from 'react';
import styles from './editor.module.css';

export type SaveTrack = <T>(work: Promise<T>) => Promise<T>;

/**
 * Every save in My Curios, counted in one place, so the header can say
 * "Saving…" while any is in flight and "Saved" once they have all landed.
 * A failure is shown where it happened (the field or section); the header
 * only says "Not saved" until the next save succeeds.
 */
export function useSaveStatus() {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);

  const track: SaveTrack = useCallback((work) => {
    setPending((n) => n + 1);
    work.then(
      () => {
        setPending((n) => n - 1);
        setFailed(false);
      },
      () => {
        setPending((n) => n - 1);
        setFailed(true);
      },
    );
    return work;
  }, []);

  const state: 'saving' | 'failed' | 'saved' = pending > 0 ? 'saving' : failed ? 'failed' : 'saved';
  return { state, track };
}

const WORDS = { saving: 'Saving…', failed: 'Not saved', saved: 'Saved' } as const;

/** The header's pill: a spinner while saving, a tick once saved. */
export function SaveStatus({ state }: { state: keyof typeof WORDS }) {
  return (
    <span className={styles.status} data-state={state} aria-live="polite">
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        {state === 'saving' ? <path d="M12 3a9 9 0 1 0 9 9" className={styles.spin} /> : state === 'failed' ? <path d="M12 7v6M12 17h.01" /> : <path d="M5 12.5l4.5 4.5L19 7.5" />}
      </svg>
      {WORDS[state]}
    </span>
  );
}
