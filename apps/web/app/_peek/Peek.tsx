import { useId } from 'react';
import styles from './peek.module.css';

/**
 * Peek, the Curios mascot, peeking over a field. Curios's own pages only:
 * nothing under app/[handle] may import this (peek.test.tsx pins it), because a
 * shop's page is the owner's, not ours.
 *
 * Render it inside a `position: relative` wrapper around the field. It draws
 * two layers: the body behind the field (z 0) and the hands in front (z 3),
 * with the field's input lifted to z 1 between them. Which way Peek looks is
 * CSS (peek.module.css), driven by the form's focus.
 */
export function Peek({
  width,
  right,
  top,
  variant,
}: {
  /** px */
  width: number;
  /** px from the wrapper's right edge */
  right: number;
  /** px from the wrapper's top edge (negative: above it) */
  top: number;
  variant: 'auth' | 'claim';
}) {
  // Two Peeks can share a page (the landing's hero and closing).
  const clipId = `pk-clip-${useId().replace(/:/g, '')}`;
  const place = { width, right, top };
  const tone = variant === 'auth' ? styles.auth : styles.claim;

  return (
    <>
      <span className={`${styles.pk} ${tone}`} data-peek="body" aria-hidden="true" style={place}>
        <svg viewBox="0 0 120 96">
          <defs>
            <clipPath id={clipId}>
              <ellipse cx="60" cy="71" rx="51" ry="50" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <rect x="0" y="10" width="120" height="90" fill="var(--peek-shade)" />
            <ellipse cx="53" cy="63" rx="51" ry="49" fill="var(--peek-body)" />
          </g>
          <g className={styles.eyes}>
            <ellipse cx="47" cy="43" rx="10.5" ry="12.5" fill="#fff" />
            <ellipse cx="73" cy="43" rx="10.5" ry="12.5" fill="#fff" />
            <g className={styles.pupils}>
              <circle cx="48" cy="46" r="6" fill="var(--ink)" />
              <circle cx="74" cy="46" r="6" fill="var(--ink)" />
              <circle cx="50" cy="43.4" r="1.9" fill="#fff" />
              <circle cx="76" cy="43.4" r="1.9" fill="#fff" />
            </g>
          </g>
          <g className={styles.happy}>
            <path
              d="M38 46q9-10.5 18 0M64 46q9-10.5 18 0"
              fill="none"
              stroke="#fff"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </span>
      <span
        className={`${styles.pk} ${styles.front} ${tone}`}
        data-peek="front"
        aria-hidden="true"
        style={place}
      >
        <svg viewBox="0 0 120 96">
          <g className={styles.hands}>
            <circle cx="24" cy="64" r="8.5" />
            <circle cx="96" cy="64" r="8.5" />
          </g>
          <g className={styles.cover}>
            <circle cx="46" cy="45" r="12.5" />
            <circle cx="74" cy="45" r="12.5" />
          </g>
        </svg>
      </span>
    </>
  );
}
