import type { ReactNode } from 'react';
import styles from './wordmark.module.css';

/**
 * The wordmark: "curios" in Bricolage, the o drawn as a ring with two eyes that
 * look around, and a happy ^^ that replaces them on hover. The board's markup,
 * copied; the o's colours come from --mo-ring / --mo-eye (ghost tone for the
 * footer). `children` render inside the o's box, for the footer's Peek.
 */
export function Wordmark({
  className,
  tone = 'ink',
  children,
}: {
  className?: string;
  tone?: 'ink' | 'ghost';
  children?: ReactNode;
}) {
  // No ids in the markup, so two wordmarks on a page cannot collide.
  return (
    <span className={[styles.mark, className].filter(Boolean).join(' ')} data-tone={tone} role="img" aria-label="curios">
      curi
      <span className={styles.mo} aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <circle className={styles.ring} cx="20" cy="20" r="15.6" />
          <g className={styles.eyes}>
            <circle cx="14.8" cy="16" r="4.1" />
            <circle cx="25.2" cy="16" r="4.1" />
          </g>
          <g className={styles.happy}>
            <path d="M11 18.5q3.8-5.4 7.6 0M21.4 18.5q3.8-5.4 7.6 0" />
          </g>
        </svg>
        {children}
      </span>
      s
    </span>
  );
}
