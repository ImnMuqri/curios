'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY, type Locale } from './copy.js';
import { Claim } from './Claim.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

/**
 * The close: "Tanya je." rising letter by letter as it comes into view, the
 * kinds of owner rolling past, and the claim field once more.
 */
export function Closing({ locale }: { locale: Locale }) {
  const copy = COPY[locale].closing;
  const { claimLabel, placeholder } = COPY[locale].hero;
  const reduced = useReducedMotion();
  const [inView, setInView] = useState(false);
  const [rot, setRot] = useState({ i: 0, animate: true });
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    if (reduced) return;
    const el = section.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio > 0.35) setInView(true);
        else if (entry.intersectionRatio === 0) setInView(false);
      },
      { threshold: [0, 0.35] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setRot((r) => ({ i: r.i + 1, animate: true })), 1900);
    return () => window.clearInterval(timer);
  }, [reduced]);

  useEffect(() => {
    if (rot.i !== copy.words.length) return;
    const t = window.setTimeout(() => setRot({ i: 0, animate: false }), 560);
    return () => window.clearTimeout(t);
  }, [rot.i, copy.words.length]);

  const words = [...copy.words, copy.words[0]!];

  return (
    <section ref={section} className={styles.closing} aria-labelledby="closing-title">
      <div className={`${styles.blobs} ${styles.dark}`} aria-hidden="true">
        <span className={`${styles.blob} ${styles.b1}`} style={{ background: 'radial-gradient(circle, var(--biru) 0%, transparent 62%)' }} />
        <span className={`${styles.blob} ${styles.b2}`} style={{ background: 'radial-gradient(circle, var(--tj-rose) 0%, transparent 62%)' }} />
        <span className={`${styles.blob} ${styles.b3}`} style={{ background: 'radial-gradient(circle, var(--kuning) 0%, transparent 62%)' }} />
        <span className={`${styles.blob} ${styles.b4}`} style={{ background: 'radial-gradient(circle, var(--hijau) 0%, transparent 62%)' }} />
        <svg className={styles.grain}>
          <filter id="grain-close">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain-close)" />
        </svg>
      </div>
      <div className={`${styles.wrap} ${styles.closingFront}`}>
        <h2 id="closing-title" className={styles.split} aria-label={copy.title} data-in={reduced || inView || undefined}>
          {copy.title.split('').map((ch, i) => (
            <span key={i} className={styles.sl} aria-hidden="true">
              <span style={{ transitionDelay: `${i * 60}ms` }}>{ch === ' ' ? ' ' : ch}</span>
            </span>
          ))}
        </h2>
        <p className={styles.rot}>
          {copy.onePageFor}
          <span className={styles.srOnly}>{copy.words.join(', ')}</span>
          <span className={styles.reel} aria-hidden="true">
            <span style={{ transform: `translateY(-${rot.i * 1.2}em)`, transition: rot.animate ? 'transform 520ms cubic-bezier(0.34, 1.35, 0.64, 1)' : 'none' }}>
              {words.map((word, i) => (
                <span key={i}>{word}</span>
              ))}
            </span>
          </span>
        </p>
        <Claim id="claim-end" variant="end" label={claimLabel} placeholder={placeholder} button={copy.button} />
        <p className={styles.endNote}>{copy.note}</p>
      </div>
    </section>
  );
}
