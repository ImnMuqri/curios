'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY, type Locale } from './copy.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

/** Where the bars are: drawn full (server, reduced motion, no observer), held short until seen, or growing in. */
type Grow = 'still' | 'wait' | 'go';

/**
 * No cut, ever (TanyaJe board, 8 Nov 2026): between For business and Pricing,
 * on the board's pink. A RM100 order as two bars, what a marketplace leaves you
 * and what Curios does, then three tiles of what the plan already covers, and
 * the small print behind the marketplace numbers.
 *
 * The bars grow in once, over 900ms, the first time the card is in view; after
 * that they stay. With reduced motion (and on the server, and without an
 * IntersectionObserver) they are drawn full and never move.
 *
 * `monthly` is the plan's price in force, written (RM49), so the line under
 * the heading never quotes a price the pricing section does not.
 */
export function NoCut({ locale, monthly }: { locale: Locale; monthly: string }) {
  const copy = COPY[locale].noCut;
  const reduced = useReducedMotion();
  const [grow, setGrow] = useState<Grow>('still');
  const card = useRef<HTMLDivElement>(null);
  // Once they have grown, the bars stay: nothing hides them to grow again.
  const grown = useRef(false);

  useEffect(() => {
    const el = card.current;
    if (grown.current) return;
    if (reduced || !el || !('IntersectionObserver' in window)) {
      setGrow('still');
      return;
    }
    setGrow('wait');
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry || entry.intersectionRatio < 0.35) return;
        grown.current = true;
        setGrow('go');
        io.disconnect();
      },
      { threshold: [0, 0.35] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <section id="no-cut" className={styles.nc} aria-labelledby="no-cut-title">
      <div className={styles.wrap}>
        <div className={styles.ncTop}>
          <div>
            <p className={`${styles.eyebrow} ${styles.ncEyebrow}`}>{copy.eyebrow}</p>
            <h2 id="no-cut-title" className={`${styles.h2} ${styles.ncH}`}>
              {copy.title[0]}
              <span className={styles.ncZero}>{copy.title[1]}</span>
              {copy.title[2]}
            </h2>
            <p className={styles.ncSub}>{copy.sub(monthly)}</p>
          </div>
          <div ref={card} className={styles.ncCard} role="img" aria-label={copy.chartLabel} data-grow={grow === 'still' ? undefined : grow}>
            <p className={styles.ncOl}>
              {copy.pays} <b>{copy.amount}</b>
            </p>
            <div className={styles.ncBr}>
              <p className={styles.ncBl}>
                {copy.market.label}
                <small>{copy.market.note}</small>
              </p>
              <div className={styles.ncBt}>
                <i className={styles.ncKeep} style={{ flex: 89 }}>
                  {copy.market.keep}
                </i>
                <i className={styles.ncCut} style={{ flex: 11 }}>
                  <span className={styles.ncCutLabel}>{copy.market.cut}</span>
                </i>
              </div>
            </div>
            <div className={styles.ncBr}>
              <p className={styles.ncBl}>
                {copy.curios.label}
                <small>{copy.curios.note}</small>
              </p>
              <div className={styles.ncBt}>
                <i className={`${styles.ncKeep} ${styles.ncCu}`} style={{ flex: 99 }}>
                  {copy.curios.keep}
                </i>
                <i className={`${styles.ncCut} ${styles.ncFee}`} style={{ flex: 1 }} />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.ncTiles}>
          <div className={styles.ncT}>
            <p className={styles.ncTk}>{copy.site.title}</p>
            <div className={styles.ncUrl}>
              <i aria-hidden="true" />
              curios.my/<b>{copy.site.handle}</b>
            </div>
            <p className={styles.ncTx}>{copy.site.body}</p>
          </div>
          <div className={styles.ncT}>
            <p className={styles.ncTk}>{copy.payments.title}</p>
            <div className={styles.ncPays}>
              {copy.payments.ways.map((way) => (
                <span key={way}>{way}</span>
              ))}
            </div>
            <p className={styles.ncTx}>{copy.payments.body}</p>
          </div>
          <div className={styles.ncT}>
            <p className={styles.ncTk}>{copy.google.title}</p>
            <div className={styles.ncSerp}>
              <small>{copy.google.url}</small>
              <b>{copy.google.result}</b>
            </div>
            <p className={styles.ncTx}>{copy.google.body}</p>
          </div>
        </div>

        <p className={styles.ncFine}>{copy.fine}</p>
      </div>
    </section>
  );
}
