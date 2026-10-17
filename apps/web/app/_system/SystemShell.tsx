import type { ReactNode } from 'react';
import { Wordmark } from '../_landing/Wordmark.js';
import styles from './system.module.css';

export { styles as systemStyles };

/**
 * The frame for the account and system screens -- forgot and reset password,
 * email confirmation, not found, something broke -- from the design
 * handoff's System board: the wordmark on paper, slow blobs and a little
 * grain, and the screen centred in what is left.
 *
 * Server-safe, so client screens render it directly.
 */
export function SystemShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.sy}>
      <div className={styles.blobs} aria-hidden="true">
        <span className={styles.blob} />
        <span className={styles.blob} />
        <span className={styles.blob} />
        <svg className={styles.grain}>
          <filter id="system-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#system-grain)" />
        </svg>
      </div>
      <div className={styles.top}>
        <a className={styles.brand} href="/" aria-label="Curios home">
          <Wordmark />
        </a>
      </div>
      <main className={styles.mid}>{children}</main>
    </div>
  );
}

/**
 * One screen on the board: a small drawing, the headline, a line under it,
 * and whatever comes next (a field, a button, a link).
 */
export function SystemCard({
  art,
  title,
  lede,
  ledeRole,
  children,
}: {
  art: ReactNode;
  title: string;
  lede?: ReactNode;
  /** "status" where the line is what changes, as "Confirming your address…" is. */
  ledeRole?: 'status';
  children?: ReactNode;
}) {
  return (
    <div className={styles.card}>
      {art}
      <h1 className={styles.h}>{title}</h1>
      {lede ? (
        <p className={styles.l} role={ledeRole}>
          {lede}
        </p>
      ) : null}
      {children}
    </div>
  );
}
