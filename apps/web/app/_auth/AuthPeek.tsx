'use client';

import { LivePeek } from '../_peek/LivePeek.js';
import styles from '../auth.module.css';

/**
 * Peek peeking over the first pill (the Site board's `.apk`): full body, his
 * eyes on the pointer. `shy` puts his hands over his eyes (a password is being
 * typed), `wave` is the check-your-email hello. Place it first inside the
 * `PillField` wrapper that holds the pill; the pill covers his lower half.
 */
export function AuthPeek({ shy = false, wave = false }: { shy?: boolean; wave?: boolean }) {
  return (
    <span className={styles.apk} aria-hidden="true" data-auth-peek={shy ? 'shy' : wave ? 'wave' : 'follow'}>
      <LivePeek width={78} follow pose={wave ? 'wave' : 'idle'} held={shy ? 'shy' : null} />
    </span>
  );
}
