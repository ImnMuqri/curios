'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LayerPortal } from './overlay-context.js';
import { LAYER_STOP } from './use-modal.js';
import styles from './toast.module.css';

/** How long a toast stays, as the boards time it. */
export const TOAST_MS = 2400;

/** The one fallback sentence for a failure with no words of its own: the inbox's moves, saves and confirms. */
export const FAILED = 'That did not go through. Try again.';

/** What a failed move says: the API's words, or the fallback (a page with something more specific passes its own). */
export function failureText(failure: unknown, fallback = FAILED): string {
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

/** How long a failure stays when nobody dismisses it: long enough to read twice. */
export const TOAST_ERROR_MS = 10000;

/**
 * The boards' toast: a dark pill at the foot of the screen with a tick and
 * one sentence ("Saved.", "Marked contacted."), gone after a moment.
 *
 * `fail` is its error tone: the soft red pill with an alert mark instead of the
 * tick, in a `role="alert"` region put in with it (read at once), staying until it is
 * dismissed (its ✕) or `TOAST_ERROR_MS` passes. A success clears a failure
 * still showing, and the other way round, so only one pill is ever up.
 *
 * In the dashboard the pill renders in the frame's layer host (_ui/overlay-context), above any open
 * sheet or dialog (its z-index is over the dialog's), and its Dismiss is a stop of an open modal's Tab
 * trap, so a failure raised under a layer can be read and dismissed. A sheet's own failure line is still
 * preferred while the sheet holds focus.
 *
 * `note` is the neutral tone: the same pill without the tick, for news that is not a success ("That
 * order is no longer in this list.").
 *
 * Each live region is always in the page and only its words change, so a
 * screen reader hears each one; a region that appears together with its text
 * is often not read at all. `say` replaces whatever is showing and restarts
 * the clock; `say('')` clears it.
 */
export function useToast(ms = TOAST_MS): { say: (text: string) => void; note: (text: string) => void; fail: (text: string) => void; toast: ReactNode } {
  const [shown, setShown] = useState<{ text: string; tone: 'ok' | 'note' | 'error' }>({ text: '', tone: 'ok' });
  // A new toast with the same words still has to play again.
  const [nth, setNth] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback((text: string, tone: 'ok' | 'note' | 'error') => {
    clearTimeout(timer.current);
    setShown({ text, tone });
    setNth((n) => n + 1);
    if (text) timer.current = setTimeout(() => setShown({ text: '', tone }), tone === 'error' ? TOAST_ERROR_MS : ms);
  }, [ms]);
  const say = useCallback((next: string) => show(next, 'ok'), [show]);
  const note = useCallback((next: string) => show(next, 'note'), [show]);
  const fail = useCallback((next: string) => show(next, 'error'), [show]);
  const dismiss = () => {
    clearTimeout(timer.current);
    setShown({ text: '', tone: 'error' });
  };

  const ok = shown.tone !== 'error' && shown.text;
  const error = shown.tone === 'error' && shown.text;
  const toast = (
    <LayerPortal>
      <div className={styles.slot} role="status">
        {ok ? (
          <p key={nth} className={styles.toast}>
            {shown.tone === 'ok' ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : null}
            {shown.text}
          </p>
        ) : null}
      </div>
      {/* Only while a failure shows: role="alert" is read as it appears (unlike status), and a second
          empty alert region on every screen would stand in the way of the screens' own alerts. */}
      {error ? (
        <div className={styles.slot} role="alert">
          <p key={nth} className={styles.toast} data-tone="error">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5M12 16.5v.01" />
            </svg>
            {shown.text}
            <button type="button" className={styles.dismiss} aria-label="Dismiss" {...{ [LAYER_STOP]: '' }} onClick={dismiss}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>
          </p>
        </div>
      ) : null}
    </LayerPortal>
  );

  return { say, note, fail, toast };
}
