'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { LandingCopy } from './copy.js';
import type { Demo } from './demo.js';
import { LeadPhones } from './LeadPhones.js';
import { paidStepAt } from './timeline.js';
import { useScrub } from './useScrub.js';
import base from './landing.module.css';
import styles from './paid.module.css';

/**
 * Scrubs the paid moment and tells the phones which step to show. Starts on
 * step 5, so without motion (no JS, reduced motion) the finished lead -- the
 * email and the reply -- is what shows.
 *
 * The progress line is drawn only with motion (CSS hides it otherwise): without
 * scrubbing there is no position to report, and a bar stuck on 5 of 5 over a
 * list that shows all five steps would claim a state nobody scrolled to.
 */
export function PaidStage({
  captions,
  leads,
  shop,
  progressLabel,
}: {
  captions: ReactNode;
  leads: LandingCopy['leads'];
  shop: Demo;
  progressLabel: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(5);
  const onProgress = useCallback((p: number) => setStep(paidStepAt(p)), []);
  useScrub(stage, { scrub: 0.8, onProgress });

  return (
    <div ref={stage} className={styles.stage} data-paid-stage data-step={step}>
      <div className={styles.inner}>
        <div className={styles.progress} role="progressbar" aria-label={progressLabel} aria-valuemin={1} aria-valuemax={5} aria-valuenow={step} />
        <div className={`${base.wrap} ${styles.grid}`}>
          {captions}
          <LeadPhones step={step} copy={leads} shop={shop} />
        </div>
      </div>
    </div>
  );
}
