'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PlanTerms } from '@curios/core/settings';
import { pricingCopy, type Locale } from './copy.js';
import { PERSONAS } from './personas.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

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
  };
}

function spotlight(event: PointerEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--sx', `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty('--sy', `${event.clientY - box.top}px`);
}

/**
 * Personal is free; Business is the price in force (`terms`, the admin's, read
 * by the page), by the month or the year. Under them, a calculator: orders a
 * month times a typical order, against what Business costs. An illustration,
 * and it says so.
 */
export function Pricing({ locale, terms }: { locale: Locale; terms: PlanTerms }) {
  const copy = pricingCopy(locale, terms);
  const reduced = useReducedMotion();
  const [yearly, setYearly] = useState(false);
  const [orders, setOrders] = useState(5);
  const [aov, setAov] = useState(95);
  const [dragging, setDragging] = useState(false);
  const cost = yearly ? Number(copy.annualAMonth) : copy.monthlyRinggit;
  const sums = payback(orders, aov, cost);
  const [shown, setShown] = useState(sums.revenue);
  const frame = useRef(0);

  // The total counts up to its new value, rather than jumping.
  useEffect(() => {
    if (reduced) {
      setShown(sums.revenue);
      return;
    }
    const from = shown;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 520);
      setShown(Math.round(from + (sums.revenue - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
    // Only a new target starts a new count; `shown` is where it starts from, not a reason to restart.
  }, [sums.revenue, reduced]);

  const fill = ((orders - 1) / 39) * 100;
  const { personal, business, calc } = copy;

  return (
    <section id="pricing" className={styles.pricing}>
      <div className={styles.wrap}>
        <div className={styles.pricingHead}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h2 className={styles.h2}>{copy.title}</h2>
          </div>
          <div role="group" aria-label={copy.billing} className={styles.tog}>
            <span className={styles.togThumb} style={{ transform: `translateX(${yearly ? '100%' : '0%'})` }} />
            <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>
              {copy.monthly}
            </button>
            <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>
              {copy.yearly} {copy.twoMonths ? <em>{copy.twoMonths}</em> : null}
            </button>
          </div>
        </div>

        <div className={styles.prGrid}>
          <article className={`${styles.spot} ${styles.personal}`} onPointerMove={spotlight}>
            <p className={styles.planHead}>
              <span className={styles.planName}>{personal.name}</span>
              <span className={styles.planTag}>{personal.tag}</span>
            </p>
            <p className={styles.planPrice}>
              <span className={styles.bigPrice}>{personal.price}</span>
              <span className={styles.per}>{personal.per}</span>
            </p>
            <p className={styles.planBody}>{personal.body}</p>
            <div className={styles.chipRow} aria-hidden="true">
              <span>
                <img className={styles.chipFace} src={PERSONAS.aisyah.face} alt="" />curios.my/aisyahdraws
              </span>
              <span>Links</span>
              <span data-on>Ask</span>
            </div>
            <ul className={styles.ticks}>
              {personal.ticks.map((tick) => (
                <li key={tick}>{tick}</li>
              ))}
            </ul>
            <a href="/signup" className={`${styles.btn} ${styles.planCta}`}>
              {personal.cta}
            </a>
          </article>

          <div className={styles.star}>
            <span className={styles.starA} aria-hidden="true" />
            <span className={styles.starB} aria-hidden="true" />
            <article className={`${styles.spot} ${styles.business}`} onPointerMove={spotlight}>
              <p className={styles.planHead}>
                <span className={styles.planName}>{business.name}</span>
                <span className={styles.planTag}>{business.tag}</span>
              </p>
              <p className={styles.planPrice}>
                <span className={styles.srOnly}>
                  {yearly ? `${business.yearly} ${business.perYear}` : `${business.monthly} ${business.perMonth}`}
                </span>
                <span aria-hidden="true" className={`${styles.bigPrice} ${styles.roll}`}>
                  <span className={styles.rollStrip} style={{ transform: `translateY(-${yearly ? 0.92 : 0}em)` }}>
                    <span>{business.monthly}</span>
                    <span>{business.yearly}</span>
                  </span>
                </span>
                <span className={styles.per} aria-hidden="true">
                  {yearly ? business.perYear : business.perMonth}
                </span>
              </p>
              <p className={styles.planBody}>{yearly ? business.noteYearly : business.noteMonthly}</p>
              <div className={styles.chipRow} aria-hidden="true">
                <span>
                  <img className={styles.chipFace} src={PERSONAS.lina.photo!.src} alt="" style={{ objectPosition: PERSONAS.lina.photo!.focus }} />curios.my/keklina
                </span>
                <span>Links</span>
                <span>Ask</span>
                <span data-on>Shop</span>
              </div>
              <ul className={styles.ticks}>
                <li data-plus>
                  <b>{business.plus}</b>
                </li>
                {business.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <a href="/signup" className={`${styles.btn} ${styles.planCta}`}>
                {business.cta}
              </a>
            </article>
          </div>
        </div>

        <div className={styles.calc}>
          <div>
            <p className={styles.eyebrow}>{calc.eyebrow}</p>
            <p className={styles.calcTitle}>{calc.title}</p>
            <label htmlFor="orders-range" className={styles.calcLabel}>
              <span>{calc.orders}</span>
              <b>{orders}</b>
            </label>
            <div className={styles.el} style={{ '--fill': `${fill}%`, '--stretch': dragging ? 1.8 : 1 } as React.CSSProperties}>
              <div className={styles.elTrack}>
                <span className={styles.elFill} />
              </div>
              <input
                id="orders-range"
                type="range"
                min={1}
                max={40}
                step={1}
                value={orders}
                onChange={(event) => {
                  setOrders(Number(event.target.value));
                  setDragging(true);
                }}
                onPointerUp={() => setDragging(false)}
                onPointerLeave={() => setDragging(false)}
                onBlur={() => setDragging(false)}
              />
              <span className={styles.elBubble} aria-hidden="true" style={{ left: `${fill}%`, transform: `translateX(-50%) scale(${dragging ? 1.15 : 1})` }}>
                {orders}
              </span>
            </div>
            <p className={styles.aovLabel}>{calc.typical}</p>
            <div className={styles.aov} role="group" aria-label={calc.typicalLabel}>
              {AOVS.map((v) => (
                <button key={v} type="button" aria-pressed={v === aov} onClick={() => setAov(v)}>
                  RM{v}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.calcOut} aria-live="polite">
            <p className={styles.takeIn}>{calc.takeIn}</p>
            <p className={styles.revenue}>RM{shown.toLocaleString('en-MY')}</p>
            <div className={styles.bars} aria-hidden="true">
              <span className={styles.bar}>
                <span className={styles.barOrders} style={{ width: '100%' }} />
                <em>{calc.yours}</em>
              </span>
              <span className={styles.bar}>
                <span className={styles.barCost} style={{ width: `${sums.costPercent}%` }} />
                <em>{calc.cost(yearly ? copy.annualAMonth : String(copy.monthlyRinggit))}</em>
              </span>
            </div>
            <p className={styles.verdict}>{sums.pays ? calc.pays(sums.percent, sums.times) : calc.under}</p>
          </div>
        </div>

        <p className={styles.fine}>
          {copy.payment} {copy.disclaimer}
        </p>
      </div>
    </section>
  );
}
