'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { useReducedMotion } from './useReducedMotion.js';
import calm from './calm.module.css';
import styles from './ask.module.css';

/** How long each word stays lit (Landing2 board, L2:992). */
export const ASK_WORD_MS = 1700;

/**
 * "Ask about my rates, services, hours…" (Landing2 board): one word lit at a
 * time, every 1.7s. Under reduced motion only the first word is lit, as the
 * board's still state shows.
 */
export function AskStrip({ locale }: { locale: Locale }) {
  const copy = COPY[locale].askStrip;
  const reduced = useReducedMotion();
  const [on, setOn] = useState(0);

  useEffect(() => {
    if (reduced) {
      setOn(0);
      return;
    }
    const timer = window.setInterval(() => setOn((f) => (f + 1) % copy.words.length), ASK_WORD_MS);
    return () => window.clearInterval(timer);
  }, [reduced, copy.words.length]);

  return (
    <section className={calm.sec} aria-labelledby="ask-label">
      <div className={calm.wrap}>
        <p id="ask-label" className={`${calm.lbl} ${calm.rv}`} data-rv="">
          {copy.eyebrow}
        </p>
        <h2 className={`${styles.askh} ${calm.rv}`} data-rv="">
          {copy.lead}{' '}
          {copy.words.map((word, i) => (
            <span key={word}>
              <span className={styles.w} data-on={i === on ? '' : undefined}>
                {i === copy.words.length - 1 ? `${word}.` : `${word},`}
              </span>
              {i < copy.words.length - 1 ? ' ' : null}
            </span>
          ))}
        </h2>
        <p className={`${calm.s2} ${calm.rv}`} data-rv="" style={{ '--d': '120ms' } as CSSProperties}>
          {copy.body}
        </p>
      </div>
    </section>
  );
}
