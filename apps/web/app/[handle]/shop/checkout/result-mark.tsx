'use client';

import { LivePeek } from '../../../_peek/LivePeek.js';
import styles from './result-mark.module.css';

/**
 * The Curios mascot on the paid and failed screens (More board, `.rpk` with a round badge): Curios' own
 * chrome on the owner's page, so it wears Curios' tokens, not the page's accent. A tick on the paid and
 * placed screens, "!" when the payment did not go through. The one file under app/[handle] that imports
 * Peek (peek.test.tsx pins that).
 */
export function ResultMark({ tone }: { tone: 'ok' | 'bad' }) {
  return (
    <span className={styles.mark} aria-hidden="true">
      <LivePeek width={140} held={tone === 'ok' ? 'happy' : 'sad'} />
      <span className={styles.badge} data-tone={tone}>
        {tone === 'ok' ? '✓' : '!'}
      </span>
    </span>
  );
}
