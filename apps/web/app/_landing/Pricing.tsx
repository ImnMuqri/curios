'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlanTerms } from '@curios/core/settings';
import { pricingCopy, type Locale } from './copy.js';
import { useReducedMotion } from './useReducedMotion.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import calm from './calm.module.css';
import styles from './pricing.module.css';

const AOVS = [50, 95, 150];

/** The calculator's sums, kept apart from the drawing so they can be tested. */
export function payback(orders: number, aov: number, monthlyCost: number) {
  const revenue = orders * aov;
  return {
    revenue,
    costPercent: Math.max(1.5, Math.min(100, (monthlyCost / Math.max(revenue, 1)) * 100)),
    pays: revenue >= monthlyCost,
    percent: Math.max(1, Math.round((monthlyCost / revenue) * 100)),
    times: Math.floor(revenue / monthlyCost),
    /** Revenue over cost, unrounded: the board's "times over" reads it. */
    ratio: revenue / monthlyCost,
  };
}

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function Tick({ i }: { i: number }) {
  return (
    <svg className={styles.ic} style={{ '--i': i } as CSSProperties} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * Pricing (Landing2 board): Personal is free; Business is the price in force
 * (`terms`, the admin's, read by the page), by the month or the year. Under
 * them, a calculator: orders a month times a typical order, against what
 * Business costs. Every figure comes from `pricingCopy`, never the board's.
 */
export function Pricing({ locale, terms }: { locale: Locale; terms: PlanTerms }) {
  const copy = pricingCopy(locale, terms);
  const reduced = useReducedMotion();
  const [yearly, setYearly] = useState(false);
  const [shownYearly, setShownYearly] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [orders, setOrders] = useState(5);
  const [aov, setAov] = useState(95);
  const [hover, setHover] = useState(false);
  const peek = useRef<LivePeekHandle>(null);
  const swap = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(swap.current), []);
  const cost = yearly ? Number(copy.annualAMonth) : copy.monthlyRinggit;
  const sums = payback(orders, aov, cost);
  const { personal, business, calc } = copy;

  const choose = (y: boolean) => {
    if (y === yearly) return;
    setYearly(y);
    peek.current?.mood('happy', 1500);
    if (reduced) {
      setShownYearly(y);
      return;
    }
    // The price slides out and comes back as the other one (L2:1220).
    setSwapping(true);
    window.clearTimeout(swap.current);
    swap.current = window.setTimeout(() => {
      swap.current = undefined;
      setShownYearly(y);
      setSwapping(false);
    }, 180);
  };

  /* The toggle's thumb, sized to the button that is on. */
  const tog = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<CSSProperties>({});
  useBrowserLayoutEffect(() => {
    const on = tog.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (on) setThumb({ width: on.offsetWidth, transform: `translateX(${on.offsetLeft - 4}px)` });
  }, [yearly, locale]);

  const verdict = sums.pays ? calc.pays(Math.max(1, Math.round((cost / sums.revenue) * 100)), sums.ratio) : calc.under((orders + 1) * aov >= cost);

  return (
    <section id="pricing" className={calm.sec} aria-labelledby="pricing-title">
      <div className={calm.wrap}>
        <p className={`${calm.lbl} ${calm.rv}`} data-rv="">
          {copy.eyebrow}
        </p>
        <h2 id="pricing-title" className={`${calm.h2} ${calm.rv}`} data-rv="">
          {copy.title[0]}
          <br />
          {copy.title[1]}
        </h2>
        <div className={calm.rv} data-rv="">
          <div ref={tog} className={styles.tog} role="group" aria-label={copy.billing}>
            <span className={styles.th} style={thumb} aria-hidden="true" />
            <button type="button" aria-pressed={!yearly} onClick={() => choose(false)}>
              {copy.monthly}
            </button>
            <button type="button" aria-pressed={yearly} onClick={() => choose(true)}>
              {copy.yearly}
              {copy.twoMonths ? <em>{copy.twoMonths}</em> : null}
            </button>
          </div>
        </div>

        <div className={styles.plans}>
          <article className={`${styles.plan} ${calm.rv}`} data-rv="" data-plan="personal">
            <div className={styles.ph1}>
              <b>{personal.name}</b>
              <span className={styles.chip}>{personal.tag}</span>
            </div>
            <p className={styles.pr}>
              {personal.price}
              <small>{personal.per}</small>
            </p>
            <p className={styles.pd}>{personal.body}</p>
            <ul>
              {personal.ticks.map((tick, i) => (
                <li key={tick}>
                  <Tick i={i} />
                  {tick}
                </li>
              ))}
            </ul>
            <a href="/signup" className={`${calm.btn} ${calm.lite} ${calm.wide}`}>
              {personal.cta}
            </a>
          </article>

          <article
            className={`${styles.plan} ${styles.bz} ${calm.rv}`}
            data-rv=""
            data-plan="business"
            style={{ '--d': '120ms' } as CSSProperties}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            <span className={styles.pk}>
              <LivePeek width={96} follow held={hover ? 'happy' : null} ref={peek} />
            </span>
            <div className={styles.ph1}>
              <b>{business.name}</b>
              {business.tag ? <span className={`${styles.chip} ${styles.o}`}>{business.tag}</span> : null}
            </div>
            <p className={styles.pr}>
              <span className={calm.srOnly}>{yearly ? `${business.yearly} ${business.perYear}` : `${business.monthly} ${business.perMonth}`}</span>
              <span aria-hidden="true" className={styles.prN} data-sw={swapping ? '' : undefined}>
                {shownYearly ? business.yearly : business.monthly}
              </span>
              <small aria-hidden="true">{shownYearly ? business.perYear : business.perMonth}</small>
            </p>
            <p className={styles.pd}>{yearly ? business.noteYearly : business.noteMonthly}</p>
            <ul>
              <li className={styles.ev}>{business.plus}</li>
              {business.points.map((point, i) => (
                <li key={point}>
                  <Tick i={i} />
                  {point}
                </li>
              ))}
            </ul>
            <a href="/signup" className={`${calm.btn} ${calm.dark} ${calm.wide} ${styles.bzBtn}`}>
              {business.cta}
            </a>
          </article>
        </div>

        <div className={`${styles.calc} ${calm.rv}`} data-rv="">
          <div>
            <small className={styles.k0}>{calc.eyebrow}</small>
            <h3>{calc.title}</h3>
            <label htmlFor="orders-range" className={styles.cl}>
              <span>{calc.orders}</span>
              <b>{orders}</b>
            </label>
            <input
              id="orders-range"
              className={styles.rng}
              type="range"
              min={1}
              max={60}
              step={1}
              value={orders}
              style={{ '--p': `${((orders - 1) / 59) * 100}%` } as CSSProperties}
              onChange={(event) => setOrders(Number(event.target.value))}
            />
            <p className={styles.cl} style={{ marginTop: 22 }}>
              <span>{calc.typical}</span>
            </p>
            <div className={styles.seg} role="group" aria-label={calc.typicalLabel}>
              {AOVS.map((v) => (
                <button key={v} type="button" aria-pressed={v === aov} onClick={() => setAov(v)}>
                  RM{v}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.cr} aria-live="polite">
            <small className={styles.k0}>{calc.takeIn}</small>
            <p className={styles.big1}>RM{sums.revenue.toLocaleString('en-MY')}</p>
            <div className={styles.cbar} aria-hidden="true" title={calc.yours}>
              <i />
            </div>
            <div className={`${styles.cbar} ${styles.s}`} aria-hidden="true" title={calc.cost(yearly ? copy.annualAMonthText : copy.monthlyText)}>
              <i style={{ width: `${Math.max(2, Math.min(100, (cost / Math.max(sums.revenue, 1)) * 100))}%` }} />
            </div>
            <p>{verdict}</p>
          </div>
        </div>

        <p className={`${calm.fine} ${calm.center} ${calm.rv}`} data-rv="" style={{ marginTop: 18 }}>
          {copy.fine}
        </p>
      </div>
    </section>
  );
}
