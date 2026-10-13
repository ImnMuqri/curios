'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { LandingCopy } from './copy.js';
import type { Demo } from './demo.js';
import { LeadPhones } from './LeadPhones.js';
import styles from './leads.module.css';

const STEP_MS = 1900;

/**
 * Five steps, two phones. The steps are a real sequence, so they are an
 * ordered list, and each is a button: a visitor can jump to any step, and the
 * story plays itself once when it first scrolls into view.
 *
 * On a phone only one of the two phones fits, so the stage shows whichever
 * one the current step is happening on -- the customer's for steps one to
 * three, the owner's for four and five -- instead of shrinking both.
 *
 * Reduced motion: nothing plays by itself; the last step is shown, with
 * everything that led up to it already on the customer's phone.
 *
 * The capture card and the email reproduce the real product's words
 * (packages/ui CaptureCard, apps/workers notify.ts). SWAP: replace with real
 * screenshots once there is a production lead to show, if preferred.
 */
export function LeadsStory({ copy, shop }: { copy: LandingCopy['leads']; shop: Demo }) {
  const total = copy.steps.length;
  const [step, setStep] = useState(1);
  const [playing, setPlaying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const played = useRef(false);

  const play = useCallback(() => {
    setStep(1);
    setPlaying(true);
  }, []);

  // Autoplay once, the first time the stage is mostly on screen.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(total);
      return;
    }
    // No observer (an old browser): the story waits for the play button.
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || played.current) return;
        played.current = true;
        observer.disconnect();
        play();
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [play, total]);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, step, total]);

  const jump = (n: number) => {
    setPlaying(false);
    setStep(n);
  };

  const status = copy.stepStatus.replace('{n}', String(step)).replace('{total}', String(total));

  return (
    <div ref={root} className={styles.story} data-step={step}>
      <ol className={styles.steps}>
        {copy.steps.map((s, i) => {
          const n = i + 1;
          return (
            <li key={s.title} className={styles.step} data-state={n < step ? 'done' : n === step ? 'now' : 'next'}>
              <button type="button" className={styles.stepButton} onClick={() => jump(n)} aria-current={n === step ? 'step' : undefined}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {n}
                  {/* While it plays, a ring fills round the current step for as long as the step lasts. Keyed so it restarts. */}
                  {playing && n === step && n < total ? (
                    <svg key={step} className={styles.ring} viewBox="0 0 36 36" style={{ '--step-ms': `${STEP_MS}ms` } as CSSProperties}>
                      <circle cx="18" cy="18" r="16.5" pathLength={100} />
                    </svg>
                  ) : null}
                </span>
                <span className={styles.stepText}>
                  <span className={styles.stepTitle}>{s.title}</span>
                  <span className={styles.stepBody}>{s.body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Phones only: the current step, spelled out under the row of numbers. The list above already says it to a screen reader. */}
      <p className={styles.caption} aria-hidden="true">
        <span className={styles.stepTitle}>{copy.steps[step - 1]?.title}</span>
        <span className={styles.stepBody}>{copy.steps[step - 1]?.body}</span>
      </p>

      <div className={styles.controls}>
        {playing ? (
          <p className={styles.playing} aria-hidden="true">
            <span className={styles.playingDot} />
            {copy.playing}: {status}
          </p>
        ) : (
          <button type="button" className={styles.replay} onClick={play}>
            {copy.replay}
          </button>
        )}
        <p className={styles.srOnly} role="status" aria-live="polite">
          {status}: {copy.steps[step - 1]?.title}
        </p>
      </div>

      <LeadPhones step={step} copy={copy} shop={shop} />
    </div>
  );
}
