'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY, type Locale } from './copy.js';
import { scene } from './order-scene.js';
import { PERSONAS } from './personas.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

const PLAY_MS = 12000;
const HOLD_MS = 2200;

const Cursor = ({ x, y, o, pressed }: { x: number; y: number; o: number; pressed: boolean }) => (
  <span className={styles.ccur} style={{ left: x, top: y, opacity: o }}>
    {pressed ? <span className={styles.cring} /> : null}
    <svg viewBox="0 0 24 24" width="26" height="26" style={{ transform: `scale(${pressed ? 0.82 : 1})`, transformOrigin: '5px 3px' }}>
      <path d="M5 3l14 8-6.2 1.6L10 19z" fill="var(--ink)" stroke="var(--paper)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  </span>
);

/**
 * Have a business? The order, played out between the customer's phone and
 * yours: it plays once the stage is fully in view, and loops while it stays
 * there. With reduced motion (and before JavaScript) it shows the last frame:
 * the order received, confirmed in your Orders.
 *
 * SLICE 18: checkout, QR payment and Orders are not built yet.
 */
export function Business({ locale }: { locale: Locale }) {
  const copy = COPY[locale].business;
  const reduced = useReducedMotion();
  const [p, setP] = useState(1);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) {
      setP(1);
      return;
    }
    const el = stage.current;
    // Without a way to tell when the stage is in view, show the finished frame rather than play unseen.
    if (!el || !('IntersectionObserver' in window)) {
      setP(1);
      return;
    }
    let frame = 0;
    let last = 0;
    let progress = 0;
    let hold = 0;
    const step = (now: number) => {
      const dt = Math.min(64, now - (last || now));
      last = now;
      if (hold > 0) {
        hold -= dt;
        if (hold <= 0) progress = 0;
      } else {
        progress += dt / PLAY_MS;
        if (progress >= 1) {
          progress = 1;
          hold = HOLD_MS;
        }
      }
      setP(progress);
      frame = requestAnimationFrame(step);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    setP(0);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= 0.92 && !frame) {
          last = 0;
          frame = requestAnimationFrame(step);
        } else if (entry.intersectionRatio < 0.15 && frame) {
          stop();
          progress = 0;
          setP(0);
        }
      },
      { threshold: [0, 0.15, 0.92, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, [reduced]);

  const s = scene(p);
  const items = copy.items;

  return (
    <section id="business" className={styles.biz}>
      <div className={styles.bizPin}>
        <div className={`${styles.wrap} ${styles.bizGrid}`}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h2 className={styles.h2}>{copy.title}</h2>
            <ol className={styles.steps}>
              {copy.caps.map((cap, i) => (
                <li key={cap.title} data-state={i === s.step ? 'now' : i < s.step ? 'done' : undefined}>
                  <span className={styles.stepDot}>{i + 1}</span>
                  <span>
                    <b className={styles.stepH}>{cap.title}</b>
                    <span className={styles.stepP}>{cap.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div ref={stage} className={styles.bizStage} role="img" aria-label={copy.stage}>
            <div className={styles.cust}>
              {PERSONAS.lina.photo ? (
                <span className={styles.custPhoto}>
                  <img src={PERSONAS.lina.photo.src} alt="" style={{ objectPosition: PERSONAS.lina.photo.focus }} loading="lazy" />
                </span>
              ) : null}
              <p className={`${styles.abs} ${styles.custName}`}>Kek Lina</p>
              <p className={`${styles.abs} ${styles.custHandle}`}>curios.my/keklina</p>
              <span className={`${styles.abs} ${styles.pcTabs} ${styles.custTabs}`}>
                <span>Links</span>
                <span>Ask</span>
                <span data-on>Shop</span>
              </span>
              <p className={`${styles.abs} ${styles.custNote}`}>{copy.shopNote}</p>
              {items.map((item, i) => {
                const row = s.rows[i]!;
                return (
                  <div key={item.name} className={`${styles.abs} ${styles.crow}`} style={{ top: 244 + i * 56 }} data-in={row.qty > 0 || undefined}>
                    <span className={styles.thumb} style={{ background: row.tone }} />
                    <span className={styles.rowText}>
                      <b>{item.name}</b>
                      <span>{item.price}</span>
                    </span>
                    {row.qty > 0 ? <span className={styles.qty}>{row.qty}×</span> : null}
                    <span className={styles.add} style={{ transform: `scale(${row.pressed ? 1.18 : 1})` }}>+</span>
                  </div>
                );
              })}
              <div className={`${styles.abs} ${styles.cbar}`} data-full={s.basketCount > 0 || undefined}>
                <span>{s.basketCount ? copy.basket(s.basketCount, s.basketTotal) : copy.basketEmpty}</span>
                <span>{copy.checkout}</span>
              </div>

              <div className={styles.sheet} style={{ transform: `translateY(${100 - s.sheet}%)` }}>
                {s.view === 'form' ? (
                  <>
                    <p className={`${styles.abs} ${styles.sheetTitle}`}>{copy.checkout}</p>
                    <p className={`${styles.abs} ${styles.sheetSide}`}>3 · RM235</p>
                    <p className={`${styles.abs} ${styles.flabel}`} style={{ top: 50 }}>{copy.name}</p>
                    <p className={`${styles.abs} ${styles.field}`} style={{ top: 66 }} data-on={s.nameFocused || undefined}>
                      {s.name}
                      {s.nameFocused ? <span className={styles.caret} /> : null}
                    </p>
                    <p className={`${styles.abs} ${styles.flabel}`} style={{ top: 118 }}>{copy.phone}</p>
                    <p className={`${styles.abs} ${styles.field}`} style={{ top: 134 }} data-on={s.phoneFocused || undefined}>
                      {s.phone}
                      {s.phoneFocused ? <span className={styles.caret} /> : null}
                    </p>
                    <div className={`${styles.abs} ${styles.seg}`} style={{ top: 190 }}>
                      <span data-on={s.pickup || undefined}>{copy.pickup}</span>
                      <span>{copy.delivery}</span>
                    </div>
                    <span className={`${styles.abs} ${styles.cta}`}>{copy.continueToPay}</span>
                  </>
                ) : (
                  <>
                    <p className={`${styles.abs} ${styles.sheetTitle}`}>#1042</p>
                    <span className={`${styles.abs} ${styles.payChip}`} data-paid={s.receipt || undefined}>
                      {s.receipt ? copy.receipt : copy.waiting}
                    </span>
                    <div className={`${styles.abs} ${styles.lines}`}>
                      <p><span>2× {items[0]!.name}</span><b>RM190</b></p>
                      <p><span>1× {items[1]!.name}</span><b>RM45</b></p>
                      <p className={styles.linesTotal}><span>{copy.pickup}</span><b>RM235</b></p>
                    </div>
                    <div className={`${styles.abs} ${styles.payto}`}>
                      <span className={styles.qr} aria-hidden="true">
                        {Array.from({ length: 81 }, (_, i) => <i key={i} />)}
                      </span>
                      <span>
                        {copy.scan}
                        <b>Maybank</b>
                        Lina binti Kamal
                        <code>1642 3378 9021</code>
                      </span>
                    </div>
                    {s.uploading ? (
                      <span className={`${styles.abs} ${styles.proof}`}>
                        <span className={styles.proofThumb} />
                        <span style={{ flex: 1, display: 'grid', gap: 4 }}>
                          <b style={{ fontSize: 12.5 }}>receipt-rm235.jpg</b>
                          <span className={styles.proofBar}>
                            <span style={{ width: `${s.uploadPercent}%` }} />
                          </span>
                        </span>
                      </span>
                    ) : (
                      <span className={`${styles.abs} ${styles.upload}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
                        </svg>
                        {copy.upload}
                      </span>
                    )}
                    <span className={`${styles.abs} ${styles.cta}`} style={{ opacity: s.placeReady ? 1 : 0.4 }}>{copy.place}</span>
                  </>
                )}
              </div>

              <div className={styles.succ} style={{ opacity: s.success }}>
                <div style={{ position: 'relative', width: 120, height: 120 }}>
                  {s.burst.map((b, i) => (
                    <span key={i} className={styles.bit} style={{ transform: `translate(${b.x}px, ${b.y}px) rotate(${b.r}deg)`, opacity: b.o, background: b.c }} />
                  ))}
                  <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" style={{ position: 'relative' }}>
                    <circle cx="60" cy="60" r="44" fill="var(--hijau)" style={{ transformOrigin: '60px 60px', transform: `scale(${s.successCircle})` }} />
                    <path d="M40 61l13 13 27-29" fill="none" stroke="var(--paper)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70" strokeDashoffset={s.successCheck} />
                  </svg>
                </div>
                <p className={styles.succTitle}>{copy.received}</p>
                <p className={styles.succNote}>{copy.receivedNote}</p>
              </div>

              <Cursor {...s.cursor} />
            </div>

            <span className={styles.token} style={{ transform: `translate(${s.token.x}px, ${s.token.y}px) scale(${s.token.s})`, opacity: s.token.o }}>
              <b>#1042</b> RM235
            </span>

            <div className={styles.own}>
              <div className={styles.ownScreen}>
                <p className={styles.osStatus}>
                  <span>11:42</span>
                  <span aria-hidden="true">●●●</span>
                </p>
                <div className={styles.oHead}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b className={styles.oTitle}>{copy.orders}</b>
                    <span className={styles.oSub}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>RM{s.today}</span> {copy.paidToday}
                      <span className={styles.oPlus} style={{ opacity: s.plus }}>+RM235</span>
                    </span>
                  </span>
                  <span className={styles.bell} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="17" height="17">
                      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
                      <path d="M10 20a2 2 0 0 0 4 0" />
                    </svg>
                    <i style={{ opacity: s.bell ? 1 : 0 }} />
                  </span>
                </div>
                <div className={styles.oTabs} aria-hidden="true">
                  <span>
                    {copy.tabs[0]}
                    {s.card.isNew ? <i>1</i> : null}
                  </span>
                  <span>{copy.tabs[1]}</span>
                  <span>{copy.tabs[2]}</span>
                </div>
                <div className={styles.oList}>
                  <div style={{ display: 'grid', gridTemplateRows: `${s.card.inserted}fr`, opacity: s.card.inserted, transform: `translateY(${-12 + 12 * s.card.inserted}px)` }}>
                    <div style={{ minHeight: 0, overflow: 'hidden', padding: 2 }}>
                      <div className={styles.oCard} style={{ boxShadow: `0 0 0 1.5px ${s.card.ring ? 'var(--biru)' : 'transparent'}` }}>
                        <p className={styles.oR1}>
                          <span className={styles.av} style={{ background: 'var(--tj-blob-pink)' }}>M</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <b>Mira</b>
                            <span>#1042 · {copy.now}</span>
                          </span>
                          <span className={styles.badge} data-done={s.confirmed || undefined}>
                            {s.confirmed ? copy.tabs[1] : copy.tabs[0]}
                          </span>
                        </p>
                        <p className={styles.oItems}>
                          2× {items[0]!.name}
                          <br />
                          1× {items[1]!.name}
                        </p>
                        <p className={styles.oMeta}>
                          <span>{copy.pickup}</span>
                          <span>·</span>
                          <span>{copy.proof}</span>
                        </p>
                        <p className={styles.oTotal}>
                          <span>{copy.total}</span>
                          <b>RM235</b>
                        </p>
                        <span className={styles.oBtn} data-done={s.confirmed || undefined}>
                          {s.confirmed ? copy.confirmed : copy.confirm}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.oRow}>
                    <span className={styles.av} style={{ background: 'var(--tj-blob-peach)' }}>H</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>Hakim</b>
                      <span>2 · {copy.delivery.split(' ')[0]}</span>
                    </span>
                    <span className={styles.oAmt}>
                      <b>RM50</b>
                      <span style={{ color: 'var(--hijau)' }}>{copy.tabs[1]}</span>
                    </span>
                  </div>
                  <div className={styles.oRow}>
                    <span className={styles.av} style={{ background: 'var(--biru-muda)' }}>W</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>Wei Ling</b>
                      <span>1 · {copy.pickup.split(' ')[0]}</span>
                    </span>
                    <span className={styles.oAmt}>
                      <b>RM30</b>
                      <span>{copy.tabs[2]}</span>
                    </span>
                  </div>
                </div>

                <div className={styles.notif} style={{ transform: `translateY(${s.notif.y}%)`, opacity: s.notif.o }}>
                  <p>
                    <span className={styles.notifIcon}>c</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span>
                        <b>Curios</b>
                        <span>{copy.now}</span>
                      </span>
                      <b className={styles.notifText}>{copy.newOrder}</b>
                    </span>
                  </p>
                </div>

                <Cursor {...s.owner} />
              </div>
            </div>

            <p className={`${styles.abs} ${styles.stageLabel}`} style={{ left: 0, width: 300 }}>{copy.customer}</p>
            <p className={`${styles.abs} ${styles.stageLabel}`} style={{ left: 372, width: 280 }}>{copy.yours}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
