'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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

  // useScrub switches motion on (and --p to 0) once the motion library has loaded; until the first scroll update the step is the true one for that progress, not the no-motion default.
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new MutationObserver(() => {
      if (node.dataset.motion === 'on') setStep(paidStepAt(parseFloat(node.style.getPropertyValue('--p')) || 0));
    });
    observer.observe(node, { attributes: true, attributeFilter: ['data-motion'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={stage} className={styles.stage} data-step={step}>
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
