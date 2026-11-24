'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import styles from './save-status.module.css';

export type SaveTrack = <T>(work: Promise<T>) => Promise<T>;
export type SaveStatusState = 'saving' | 'failed' | 'saved';

/**
 * Every save in My Curios, counted in one place, so the top bar can say
 * "Saving…" while any is in flight and "Saved" once they have all landed.
 * A failure is shown where it happened (the field or section); the top bar
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

  /** Forget an earlier failure, for a screen that starts afresh (an item opened). */
  const reset = useCallback(() => setFailed(false), []);

  const state: SaveStatusState = pending > 0 ? 'saving' : failed ? 'failed' : 'saved';
  return { state, track, reset };
}

const WORDS = { saving: 'Saving…', failed: 'Not saved', saved: 'Saved' } as const;

/** The status: a spinner while saving, a cloud with a tick once saved, as plain text, not a pill. */
export function SaveStatus({ state }: { state: SaveStatusState }) {
  return (
    <span className={styles.status} data-state={state} role="status" aria-live="polite">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* Not saved is a ringed "!": a bare stroke and dot read as a speck beside the tick. */}
        {state === 'saving' ? (
          <path d="M12 3a9 9 0 1 0 9 9" className={styles.spin} />
        ) : state === 'failed' ? (
          <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7.5v5.5M12 16.6v.4" />
        ) : (
          <>
            <path d="M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18z" />
            <path d="M9.5 13.2l1.8 1.8 3.4-3.6" />
          </>
        )}
      </svg>
      <span className={styles.words}>{WORDS[state]}</span>
    </span>
  );
}

type Slot = { state: SaveStatusState | null; publish: (state: SaveStatusState | null) => void };
const SaveStatusContext = createContext<Slot | null>(null);

/**
 * The dashboard frame's one place for "Saved" (the top bar, just before Help). A screen that saves as
 * its owner types publishes its status here (usePublishSaveStatus); every other screen publishes
 * nothing, so the top bar shows nothing.
 */
export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [state, publish] = useState<SaveStatusState | null>(null);
  const value = useMemo(() => ({ state, publish }), [state]);
  return <SaveStatusContext.Provider value={value}>{children}</SaveStatusContext.Provider>;
}

/** What the screen has published, drawn where the frame puts it; nothing when no screen has. */
export function SaveStatusSlot() {
  const slot = useContext(SaveStatusContext);
  return slot?.state ? <SaveStatus state={slot.state} /> : null;
}

/** Show this status in the top bar while the calling screen is mounted; null shows none. A no-op outside the frame. */
export function usePublishSaveStatus(state: SaveStatusState | null) {
  const publish = useContext(SaveStatusContext)?.publish;
  useEffect(() => {
    publish?.(state);
  }, [publish, state]);
  useEffect(() => () => publish?.(null), [publish]);
}
