'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './new-version.module.css';

/** How often a visible dashboard asks which build is live. */
export const VERSION_POLL_MS = 5 * 60 * 1000;
/** The longest wait after repeated failures. */
export const VERSION_POLL_MAX_MS = 30 * 60 * 1000;
/** Where the running build is told (app/api/version/route.ts). */
export const VERSION_URL = '/api/version';
/** sessionStorage: the newest version the owner dismissed, so the same one does not come back this session. */
export const DISMISSED_KEY = 'curios:dismissed-version';

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string) {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Private mode or blocked storage: the toast may return on the next check, which is harmless.
  }
}

/**
 * Asks /api/version while the tab is visible (every 5 minutes, when it becomes visible again, and
 * when the connection returns; never while hidden), backing off on errors. Returns the newer build's
 * id once there is one the owner has not dismissed, and stops asking while it is showing.
 * `current` is the build this page was rendered by; "development" never asks unless `force`.
 */
export function useNewVersion(current: string, force = false): { newer: string | null; dismiss: () => void } {
  const [newer, setNewer] = useState<string | null>(null);
  const active = force || current !== 'development';

  useEffect(() => {
    if (!active || newer) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let failures = 0;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped) return;
      const wait = Math.min(VERSION_POLL_MS * 2 ** failures, VERSION_POLL_MAX_MS);
      timer = setTimeout(() => void check(), wait);
    };

    async function check() {
      if (stopped || busy) return;
      // A hidden tab does not ask; becoming visible does.
      if (document.visibilityState === 'hidden') return schedule();
      busy = true;
      try {
        const res = await fetch(VERSION_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { version?: unknown };
        failures = 0;
        const live = typeof body.version === 'string' ? body.version : '';
        if (stopped) return;
        if (live && live !== 'development' && live !== current && live !== readDismissed()) {
          stopped = true;
          clearTimeout(timer);
          setNewer(live);
          return;
        }
      } catch {
        failures += 1;
      } finally {
        busy = false;
      }
      schedule();
    }

    const soon = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', soon);
    window.addEventListener('online', soon);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', soon);
      window.removeEventListener('online', soon);
    };
  }, [active, newer, current]);

  const dismiss = useCallback(() => {
    if (newer) writeDismissed(newer);
    setNewer(null);
  }, [newer]);

  return { newer, dismiss };
}

/**
 * "A new version of Curios is ready": a card at the foot of the dashboard with Refresh and Dismiss.
 * The live region is in the page from the start and only its card comes and goes, so it is read once
 * when it appears. The frame renders it before its layer host (which stays the last child); it sits at the right, so the centred toast pill does not cover it.
 */
export function NewVersion({ version, force = false }: { version: string; force?: boolean }) {
  const { newer, dismiss } = useNewVersion(version, force);

  return (
      <div className={styles.slot} role="status" aria-live="polite">
        {newer ? (
          <div className={styles.card} data-new-version={newer}>
            <svg className={styles.tile} viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="var(--sky)" />
              <ellipse cx="10.8" cy="16" rx="4.9" ry="5.8" fill="white" />
              <ellipse cx="21.2" cy="16" rx="4.9" ry="5.8" fill="white" />
              <circle cx="11.7" cy="17.2" r="2.9" fill="var(--light-ink)" />
              <circle cx="22.1" cy="17.2" r="2.9" fill="var(--light-ink)" />
            </svg>
            <div className={styles.words}>
              <p className={styles.title}>A new version of Curios is ready</p>
              <p className={styles.sub}>Refresh to get the latest.</p>
            </div>
            <button type="button" className={styles.refresh} onClick={() => window.location.reload()}>
              Refresh
            </button>
            <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={dismiss}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
  );
}
