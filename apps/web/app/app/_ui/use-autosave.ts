'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const SAVE_DEBOUNCE_MS = 600;

/**
 * Saves the latest value once the owner stops typing, and says how it went.
 * No Save button in My Curios or Store -- this is what stands in for it. A
 * failure keeps the value, so retry() sends exactly what the owner last
 * typed. flushPending() sends a save that is still waiting, at once (an item
 * editor's Done).
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = SAVE_DEBOUNCE_MS) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // The failure itself, not just that one happened: SaveState needs it to
  // show an ApiError's own message and to know whether a 4xx makes Retry
  // pointless.
  const [error, setError] = useState<unknown>(null);
  const latest = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  /** Resolves true once saved, false when the save failed. */
  const flush = useCallback(async () => {
    if (!latest.current) return true;
    const { value } = latest.current;
    setStatus('saving');
    try {
      await saveRef.current(value);
      setStatus('saved');
      setError(null);
      return true;
    } catch (failure) {
      setStatus('error');
      setError(failure);
      return false;
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      latest.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, delay);
    },
    [delay, flush],
  );

  /** Null when nothing was waiting; otherwise whether the waiting save went through. */
  const flushPending = useCallback(async (): Promise<boolean | null> => {
    if (!timer.current) return null;
    clearTimeout(timer.current);
    timer.current = null;
    return flush();
  }, [flush]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { status, error, schedule, retry: () => void flush(), flushPending };
}
