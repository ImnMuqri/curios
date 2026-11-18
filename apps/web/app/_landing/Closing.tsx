'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { Claim } from './Claim.js';
import { useReducedMotion } from './useReducedMotion.js';
import { LivePeek } from '../_peek/LivePeek.js';
import calm from './calm.module.css';
import hero from './hero.module.css';
import styles from './closing.module.css';

/** How long each word stays in the pill (Landing2 board, L2:1237). */
export const CLOSING_WORD_MS = 2000;

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The close (Landing2 board): a waving Peek, "Tanya je.", then "One page for"
 * with a word pill rolling through the kinds of owner every 2s, only while
 * the card is in view, and the claim field once more (no Peek on this one).
 */
export function Closing({ locale }: { locale: Locale }) {
  const copy = COPY[locale].closing;
  const { claimLabel, placeholder } = COPY[locale].hero;
  const reduced = useReducedMotion();
  const [word, setWord] = useState(0);
  const [inView, setInView] = useState(false);
  const card = useRef<HTMLElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [widths, setWidths] = useState<number[] | null>(null);

  useEffect(() => {
    const el = card.current;
    if (reduced || !el || typeof window.IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (e) setInView(e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced || !inView) return;
    const t = window.setInterval(() => setWord((w) => (w + 1) % copy.words.length), CLOSING_WORD_MS);
    return () => window.clearInterval(t);
  }, [reduced, inView, copy.words.length]);

  useBrowserLayoutEffect(() => {
    const read = () => {
      const box = measure.current;
      if (box) setWidths([...box.children].map((c) => c.getBoundingClientRect().width));
    };
    read();
    document.fonts?.ready.then(read).catch(() => {});
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [locale]);

  const n = (word % 6) + 1;
  const pill = {
    background: `var(--cl-word-${n})`,
    color: `var(--cl-word-${n}-ink)`,
    ...(widths?.[word] ? { width: `calc(${widths[word]}px + 0.44em)` } : {}),
  } as CSSProperties;

  return (
    <div className={calm.wrap}>
      <section ref={card} className={`${styles.closing} ${calm.rv}`} data-rv="" aria-labelledby="closing-title">
        <div className={`${calm.dotbg} ${styles.dots}`} aria-hidden="true" />
        <span className={styles.pk}>
          <LivePeek width={124} pose="wave" follow />
        </span>
        <p className={calm.lbl}>{copy.label}</p>
        <h2 id="closing-title" className={calm.h2} aria-label={`${copy.onePageFor} ${copy.words[0]}`}>
          {copy.onePageFor}{' '}
          <span className={hero.rot} style={pill} aria-hidden="true" data-word={word}>
            <span className={hero.sizer}>{copy.words[word]}</span>
            <span className={hero.rotC} style={{ transform: `translateY(-${word * 1.14}em)` }}>
              {copy.words.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </span>
          </span>
          <span ref={measure} className={hero.measure} aria-hidden="true">
            {copy.words.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </span>
        </h2>
        <div className={styles.claim}>
          <Claim id="claim-end" variant="end" label={claimLabel} placeholder={placeholder} button={copy.button} />
        </div>
        <p className={`${calm.fine} ${calm.center}`}>{copy.note}</p>
      </section>
    </div>
  );
}
