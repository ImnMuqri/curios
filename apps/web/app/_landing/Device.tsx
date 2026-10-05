import type { ReactNode } from 'react';
import styles from './device.module.css';

/**
 * A phone, drawn to read as a real one rather than a rounded box: a thin
 * bezel with side buttons, a camera island, a status bar (time, signal,
 * wifi, battery), the app's own top bar, and the home indicator. Every phone
 * on the landing page uses it, so they all look like the same make.
 *
 * Server-safe (no hooks), so client components can render it too.
 *
 * - `chrome="browser"`: a browser address bar, for a Curios page.
 * - `chrome="mail"`: a mail app's top bar, for the lead email.
 * - `tone="dark"`: status bar in light text, for a lock screen.
 * - `overlay`: drawn over the whole screen, status bar included (the lock screen).
 */
export function Device({
  time,
  chrome = 'none',
  url,
  mailTitle,
  tone = 'light',
  overlay,
  className,
  children,
}: {
  time: string;
  chrome?: 'browser' | 'mail' | 'none';
  url?: string;
  mailTitle?: string;
  tone?: 'light' | 'dark';
  overlay?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={[styles.device, className].filter(Boolean).join(' ')} data-tone={tone}>
      <div className={styles.screen}>
        <div className={styles.status} aria-hidden="true">
          <span className={styles.time}>{time}</span>
          <span className={styles.island} />
          <span className={styles.icons}>
            <svg viewBox="0 0 18 12" width="17" height="11">
              <rect x="0" y="8" width="3" height="4" rx="1" />
              <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
              <rect x="10" y="3" width="3" height="9" rx="1" />
              <rect x="15" y="0" width="3" height="12" rx="1" />
            </svg>
            <svg viewBox="0 0 16 12" width="15" height="11">
              <path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0L8 11.5Zm-4.2-4.3L2.3 5.6a8 8 0 0 1 11.4 0l-1.5 1.6a5.8 5.8 0 0 0-8.4 0ZM.8 4.2-.7 2.6a12.3 12.3 0 0 1 17.4 0l-1.5 1.6a10.1 10.1 0 0 0-14.4 0Z" />
            </svg>
            <svg viewBox="0 0 27 12" width="25" height="11">
              <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.4" />
              <rect x="2" y="2" width="16" height="8" rx="1.5" />
              <rect x="24" y="4" width="2" height="4" rx="1" opacity="0.4" />
            </svg>
          </span>
        </div>

        {chrome === 'browser' ? (
          <div className={styles.browser} aria-hidden="true">
            <span className={styles.address}>
              <svg viewBox="0 0 10 12" width="9" height="11">
                <path d="M2 5V3.5a3 3 0 0 1 6 0V5h.5A1.5 1.5 0 0 1 10 6.5v4A1.5 1.5 0 0 1 8.5 12h-7A1.5 1.5 0 0 1 0 10.5v-4A1.5 1.5 0 0 1 1.5 5H2Zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0V5Z" />
              </svg>
              {url}
            </span>
          </div>
        ) : null}

        {chrome === 'mail' ? (
          <div className={styles.mail} aria-hidden="true">
            <span className={styles.back}>‹ Inbox</span>
            <span className={styles.mailTitle}>{mailTitle}</span>
          </div>
        ) : null}

        <div className={styles.body}>{children}</div>

        {overlay ? <div className={styles.overlay}>{overlay}</div> : null}
        <span className={styles.home} aria-hidden="true" />
      </div>
    </div>
  );
}
