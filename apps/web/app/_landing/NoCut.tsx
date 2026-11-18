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

export interface ReceiptsState {
  mk: boolean;
  fees: number;
  dim: boolean;
  cu: boolean;
  /** 0 nothing, 1 the commission row, 2 and the bank fee. */
  rows: number;
  stamp: boolean;
  keepMk: number;
  keepCu: number;
  hop: number;
  cheer: number;
}

interface ReceiptsProps {
  start: number;
  fees: number[];
  bank: number;
}

/** The two receipts print (Landing2 board, L2:1206–1213). */
export const receiptsScene: Scene<ReceiptsState, ReceiptsProps> = {
  still: (p) => ({
    mk: true,
    fees: p.fees.length,
    dim: true,
    cu: true,
    rows: 2,
    stamp: true,
    keepMk: keepAfter(p.start, p.fees).at(-1) ?? p.start,
    keepCu: keepAfter(p.start, [p.bank])[0]!,
    hop: 0,
    cheer: 0,
  }),
  start: (p) => ({ mk: false, fees: 0, dim: false, cu: false, rows: 0, stamp: false, keepMk: p.start, keepCu: p.start, hop: 0, cheer: 0 }),
  async run(p, set, wait) {
    set((s) => ({ ...receiptsScene.start(p), hop: s.hop, cheer: s.cheer }));
    await wait(500);
    set((s) => ({ ...s, mk: true }));
    await wait(900);
    const totals = keepAfter(p.start, p.fees);
    let k = p.start;
    for (let f = 0; f < p.fees.length; f++) {
      set((s) => ({ ...s, fees: f + 1 }));
      await wait(250);
      const to = totals[f]!;
      for (let i = 1; i <= 24; i++) {
        const keepMk = Math.round((k + ((to - k) * i) / 24) * 100) / 100;
        set((s) => ({ ...s, keepMk }));
        await wait(380 / 24);
      }
      k = to;
      await wait(250);
    }
    set((s) => ({ ...s, dim: true }));
    await wait(500);
    set((s) => ({ ...s, cu: true }));
    await wait(900);
    set((s) => ({ ...s, rows: 1 }));
    await wait(700);
    set((s) => ({ ...s, stamp: true, hop: s.hop + 1 }));
    await wait(600);
    set((s) => ({ ...s, rows: 2 }));
    await wait(250);
    const end = keepAfter(p.start, [p.bank])[0]!;
    for (let i = 1; i <= 24; i++) {
      const keepCu = Math.round((p.start + ((end - p.start) * i) / 24) * 100) / 100;
      set((s) => ({ ...s, keepCu }));
      await wait(380 / 24);
    }
    set((s) => ({ ...s, cheer: s.cheer + 1 }));
    await wait(9000);
  },
};

/**
 * No cut, ever (Landing2 board): the same RM100 cake on two receipts. The
 * marketplace one prints, loses three fees and dims; the Curios one prints,
 * takes no commission (stamped 0%) and only the bank's FPX fee. The figures
 * are a fixed sample, not prices from PlanTerms. The server, and reduced
 * motion, show both printed and totalled.
 */
export function NoCut({ locale }: { locale: Locale }) {
  const copy = COPY[locale].noCut;
  const ref = useRef<HTMLDivElement>(null);
  const props = { start: copy.market.line[1], fees: copy.market.fees.map((f) => f[1]), bank: copy.curios.bank[1] };
  const s = useScene(receiptsScene, props, ref);
  const peek = useRef<LivePeekHandle>(null);
  useEffect(() => {
    if (s.hop > 0) peek.current?.mood('hop', 520);
  }, [s.hop]);
  useEffect(() => {
    if (s.cheer > 0) peek.current?.mood('happy', 2000);
  }, [s.cheer]);

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
        <div ref={ref} className={`${styles.rcp} ${calm.rv}`} data-rv="" style={{ '--d': '200ms' } as CSSProperties}>
          <div className={`${styles.rc} ${styles.mk}`} data-receipt="" data-in={s.mk ? '' : undefined} data-dim={s.dim ? '' : undefined}>
            <h3>{copy.market.title}</h3>
            <p className={styles.sm}>{copy.market.ref}</p>
            <div className={styles.rl}>
              <span>{copy.market.line[0]}</span>
              <b>{money(copy.market.line[1])}</b>
            </div>
            {copy.market.fees.map(([label, fee], i) => (
              <div key={label} className={`${styles.rl} ${styles.rf}`} data-in={i < s.fees ? '' : undefined}>
                <span>{label}</span>
                <b>−{money(fee)}</b>
              </div>
            ))}
            <div className={styles.rt}>
              <span>{copy.market.keep}</span>
              <b data-keep="">{money(s.keepMk)}</b>
            </div>
          </div>
          <div className={`${styles.rc} ${styles.cu}`} data-receipt="" data-in={s.cu ? '' : undefined}>
            <h3>{copy.curios.title}</h3>
            <p className={styles.sm}>{copy.curios.ref}</p>
            <span className={styles.stamp} data-stamp="" data-in={s.stamp ? '' : undefined}>
              {copy.curios.stamp}
            </span>
            <div className={styles.rl}>
              <span>{copy.curios.line[0]}</span>
              <b>{money(copy.curios.line[1])}</b>
            </div>
            <div className={`${styles.rl} ${styles.rz} ${styles.rf}`} data-in={s.rows >= 1 ? '' : undefined}>
              <span>{copy.curios.commission}</span>
              <b>{money(0)}</b>
            </div>
            <div className={`${styles.rl} ${styles.rf}`} data-in={s.rows >= 2 ? '' : undefined}>
              <span>{copy.curios.bank[0]}</span>
              <b>−{money(copy.curios.bank[1])}</b>
            </div>
            <div className={styles.rt}>
              <span>{copy.curios.keep}</span>
              <b data-keep="">{money(s.keepCu)}</b>
            </div>
          </div>
          <span className={styles.pk}>
            <LivePeek width={96} follow ref={peek} />
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
