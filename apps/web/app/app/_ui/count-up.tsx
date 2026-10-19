'use client';

import { useLayoutEffect, useState } from 'react';
import styles from './count-up.module.css';

/** The boards' count: 1.1 seconds, easing out. */
const COUNT_MS = 1100;

/**
 * A number that counts up from nothing when the screen opens, as the boards'
 * figures do. The server renders the real value, kept out of sight until the
 * count takes over (count-up.module.css), so it never shows and then drops to
 * 0; anyone who asked for less motion, or a browser that cannot say, simply
 * sees it.
 */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [live, setLive] = useState(false);

  useLayoutEffect(() => {
    setLive(true);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    if (still || value <= 0) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / COUNT_MS);
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    setShown(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={styles.n} data-live={live || undefined}>
      {shown.toLocaleString('en-MY')}
    </span>
  );
}
