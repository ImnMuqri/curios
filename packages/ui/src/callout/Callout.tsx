import type { ReactNode } from 'react';
import styles from './Callout.module.css';

/**
 * Three tones, and the role follows the tone rather than the colour.
 *
 * `error` interrupts, because a failed submit is news the owner needs now.
 * `info` and `action` are polite: "Reading your website…" announced
 * assertively on every poll would make onboarding unusable with a screen
 * reader.
 */
export function Callout({
  children,
  tone,
  role,
}: {
  children: ReactNode;
  tone: 'error' | 'info' | 'action';
  /** Overrides the role the tone gives: `none` for a message already on the page that should not be announced. */
  role?: 'alert' | 'status' | 'none';
}) {
  return (
    <p className={`${styles.callout} ${styles[tone]}`} role={role ?? (tone === 'error' ? 'alert' : 'status')}>
      {tone === 'error' ? (
        // The owner's pick (26 Nov): the item editor's price-problem line, pink with an alert mark.
        <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8v5M12 16.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
        </svg>
      ) : null}
      {tone === 'error' ? <span className={styles.words}>{children}</span> : children}
    </p>
  );
}
