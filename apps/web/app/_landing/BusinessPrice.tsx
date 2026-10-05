'use client';

import { useState } from 'react';
import type { LandingCopy } from './copy.js';
import styles from './pricing.module.css';

type Business = LandingCopy['pricing']['business'];

/**
 * The Business price with a Monthly / Yearly switch. Switching rolls the
 * figure: the old one slides up and out, the new one slides up into place
 * (keyed, so the animation restarts on every change).
 */
export function BusinessPrice({ business }: { business: Business }) {
  const [yearly, setYearly] = useState(false);
  const b = business.billing;

  return (
    <>
      <div className={styles.switch} role="group" aria-label={b.label}>
        <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)} className={styles.switchOption}>
          {b.monthly}
        </button>
        <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)} className={styles.switchOption}>
          {b.yearly}
        </button>
        <span className={styles.switchThumb} data-yearly={yearly} aria-hidden="true" />
      </div>
      <p className={styles.price} aria-live="polite">
        <span key={yearly ? 'y' : 'm'} className={`${styles.tag} ${styles.roll}`}>
          {yearly ? b.yearPrice : business.price}
        </span>
        <span className={styles.per}>{yearly ? b.perYear : business.per}</span>
      </p>
      <p className={styles.annual}>{yearly ? b.yearNote : business.annual}</p>
    </>
  );
}
