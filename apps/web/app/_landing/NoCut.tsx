'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { useScene, type Scene } from './scene.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import calm from './calm.module.css';
import styles from './nocut.module.css';

/** The running totals after each fee, to the sen: keepAfter(100, [5, 4, 2.16]) is [95, 91, 88.84]. */
export function keepAfter(start: number, fees: number[]): number[] {
  let k = Math.round(start * 100);
  return fees.map((f) => {
    k -= Math.round(f * 100);
    return k / 100;
  });
}

const money = (v: number) => `RM${v.toFixed(2)}`;

/** What the owner's phone shows for the same RM100 cake: the marketplace's payout, Curios's payment, and the difference. */
export function lockFigures(sample: { start: number; fees: number[]; bank: number }) {
  const marketplace = keepAfter(sample.start, sample.fees).at(-1) ?? sample.start;
  const curios = keepAfter(sample.start, [sample.bank])[0]!;
  return { marketplace, curios, more: Math.round((curios - marketplace) * 100) / 100 };
}

export interface LockState {
  /** How many of the three notifications are showing. */
  shown: number;
  hop: number;
  cheer: number;
}

/** The bank dings twice (Landing2 board, L2:1249–1259), then the pill says what the difference is. */
export const lockScene: Scene<LockState, null> = {
  still: () => ({ shown: 3, hop: 0, cheer: 0 }),
  start: () => ({ shown: 0, hop: 0, cheer: 0 }),
  async run(_p, set, wait) {
    set((s) => ({ ...s, shown: 0 }));
    await wait(900);
    set((s) => ({ ...s, shown: 1 }));
    await wait(1600);
    set((s) => ({ ...s, shown: 2, hop: s.hop + 1 }));
    await wait(1200);
    set((s) => ({ ...s, shown: 3, cheer: s.cheer + 1 }));
    await wait(9000);
  },
};

function Bank() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
    </svg>
  );
}

/**
 * No cut, ever (Landing2 board, 24 Nov): the same RM100 cake sold two ways,
 * and the owner's lock screen. The marketplace pays out RM88.84 after three
 * fees; the same sale on Curios comes straight from the customer's bank as
 * RM99.00, less only the bank's RM1. The figures are a fixed sample, not
 * prices from PlanTerms. The server, and reduced motion, show all three
 * alerts, still.
 */
export function NoCut({ locale }: { locale: Locale }) {
  const copy = COPY[locale].noCut;
  const ref = useRef<HTMLDivElement>(null);
  const s = useScene(lockScene, null, ref);
  const peek = useRef<LivePeekHandle>(null);
  useEffect(() => {
    if (s.hop > 0) peek.current?.mood('hop', 520);
  }, [s.hop]);
  useEffect(() => {
    if (s.cheer > 0) peek.current?.mood('happy', 2000);
  }, [s.cheer]);
  const fig = lockFigures(copy.sample);
  const on = (n: number) => (s.shown >= n ? '' : undefined);

  return (
    <section className={calm.sec} aria-labelledby="nc-title">
      <div className={calm.wrap}>
        <p className={`${calm.lbl} ${calm.rv}`} data-rv="">
          {copy.eyebrow}
        </p>
        <h2 id="nc-title" className={`${calm.h2} ${calm.rv}`} data-rv="">
          {copy.title}
        </h2>
        <p className={`${calm.s2} ${calm.rv}`} data-rv="" style={{ '--d': '120ms' } as CSSProperties}>
          {copy.sub}
        </p>
        <div ref={ref} className={`${styles.bk} ${calm.rv}`} data-rv="" style={{ '--d': '200ms' } as CSSProperties}>
          <div className={styles.ph}>
            <p className={styles.t}>9:41</p>
            <p className={styles.dt}>{copy.lock.date}</p>
            <div className={styles.list}>
              <div className={styles.n} data-in={on(1)}>
                <span className={styles.i}>
                  <Bank />
                </span>
                <div className={styles.x}>
                  <div className={styles.r}>
                    <b>{copy.lock.bank}</b>
                    <small>{copy.lock.earlier}</small>
                  </div>
                  <p>
                    {copy.lock.payout} <span className={styles.a} data-amount="marketplace">{money(fig.marketplace)}</span>
                  </p>
                </div>
              </div>
              <div className={styles.n} data-in={on(2)}>
                <span className={`${styles.i} ${styles.cu}`}>
                  <Bank />
                </span>
                <div className={styles.x}>
                  <div className={styles.r}>
                    <b>{copy.lock.bank}</b>
                    <small>{copy.lock.now}</small>
                  </div>
                  <p>
                    {copy.lock.fpx} <span className={`${styles.a} ${styles.cu}`} data-amount="curios">{money(fig.curios)}</span>
                  </p>
                </div>
              </div>
              <div className={`${styles.n} ${styles.diff}`} data-in={on(3)}>
                <p data-amount="more">{copy.lock.more(money(fig.more))}</p>
              </div>
            </div>
          </div>
          <span className={styles.pk}>
            <LivePeek width={104} follow ref={peek} />
          </span>
        </div>
        <div className={styles.incl}>
          {copy.incl.map((f, i) => (
            <div key={f.title} className={calm.rv} data-rv="" style={{ '--d': `${i * 120}ms` } as CSSProperties}>
              <small>{f.kicker}</small>
              <b>{f.title}</b>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
        <p className={`${calm.fine} ${calm.center} ${styles.fine} ${calm.rv}`} data-rv="">
          {copy.fine}
        </p>
      </div>
    </section>
  );
}
