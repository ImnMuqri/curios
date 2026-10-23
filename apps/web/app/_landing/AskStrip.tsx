'use client';

import { useEffect, useState } from 'react';
import { COPY, type Locale } from './copy.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

/**
 * "Ask about my rates, services, hours…": one word in focus at a time, ringed,
 * the rest dimmed. With reduced motion every word is lit.
 */
export function AskStrip({ locale }: { locale: Locale }) {
  const copy = COPY[locale].askStrip;
  const reduced = useReducedMotion();
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setFocus((f) => (f + 1) % copy.words.length), 1500);
    return () => window.clearInterval(timer);
  }, [reduced, copy.words.length]);

  return (
    <section className={styles.askStrip} aria-label={copy.eyebrow}>
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <p className={styles.focusLine}>
          <span className={styles.focusLead}>{copy.lead}</span>
          {copy.words.map((word, i) => (
            <span key={word} className={styles.focusWord} data-on={reduced || i === focus || undefined}>
              {i === copy.words.length - 1 ? `${word}.` : `${word},`}
            </span>
          ))}
        </p>
        <p className={styles.askBody}>{copy.body}</p>
      </div>
    </section>
  );
}
