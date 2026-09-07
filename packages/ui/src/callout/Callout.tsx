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
}: {
  children: ReactNode;
  tone: 'error' | 'info' | 'action';
}) {
  return (
    <p className={`${styles.callout} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
