'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { COPY, type Locale } from './copy.js';
import { HOLD_MS, advance, scene, stepProgress, stepStart } from './order-scene.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

const Cursor = ({ x, y, o, pressed }: { x: number; y: number; o: number; pressed: boolean }) => (
  <span className={styles.ccur} style={{ left: x, top: y, opacity: o }}>
    {pressed ? <span className={styles.cring} /> : null}
    <svg viewBox="0 0 24 24" width="26" height="26" style={{ transform: `scale(${pressed ? 0.82 : 1})`, transformOrigin: '5px 3px' }}>
      <path d="M5 3l14 8-6.2 1.6L10 19z" fill="var(--ink)" stroke="var(--paper)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  </span>
);

const BANK_COLOURS = ['var(--tj-bank-maybank)', 'var(--tj-bank-cimb)', 'var(--tj-bank-public)', 'var(--tj-bank-rhb)'];
const AVATAR_TONES = ['var(--tj-blob-pink)', 'var(--tj-blob-blue)', 'var(--tj-blob-mint)'];

/**
 * Have a business? The order, played out between the customer's phone and
 * yours: they open the shop from Kek Lina's link in bio, add two items, check out, pick online banking and Maybank2u,
 * approve in the bank and come straight back; it lands in your Orders already
 * paid. It plays while the stage is in view (each step at its own pace, with a
 * progress line), pauses while a phone is hovered, and a step can be clicked
 * to jump to it. With reduced motion (and before JavaScript) it shows the last
 * frame, completed in your Orders; the steps can still be clicked to look at.
 */
export function Business({ locale }: { locale: Locale }) {
  const copy = COPY[locale].business;
  const badgeId = useId();
  const reduced = useReducedMotion();
  const [p, setP] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const hold = useRef(0);
  const paused = useRef(false);

  const goTo = useCallback((i: number) => {
    progress.current = stepStart(i);
    hold.current = 0;
    setP(progress.current);
  }, []);
  const pause = () => {
    paused.current = true;
  };
  const resume = () => {
    paused.current = false;
  };

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
    const step = (now: number) => {
      const dt = Math.min(64, now - (last || now));
      last = now;
      if (hold.current > 0) {
        hold.current -= dt;
        if (hold.current <= 0) {
          progress.current = 0;
          setP(0);
        }
      } else if (!paused.current) {
        const next = advance(progress.current, dt);
        if (next >= 1) {
          progress.current = 1;
          hold.current = HOLD_MS;
        } else {
          progress.current = next;
        }
        setP(progress.current);
      }
      frame = requestAnimationFrame(step);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    progress.current = 0;
    hold.current = 0;
    setP(0);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= 0.3 && !frame) {
          last = 0;
          frame = requestAnimationFrame(step);
        } else if (entry.intersectionRatio < 0.04 && frame) {
          stop();
          progress.current = 0;
          hold.current = 0;
          setP(0);
        }
      },
      { threshold: [0, 0.04, 0.3, 0.6, 1] },
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
                  <button type="button" className={styles.stepBtn} aria-current={i === s.step ? 'step' : undefined} onClick={() => goTo(i)}>
                    <span className={styles.stepDot}>{i + 1}</span>
                    <span>
                      <b className={styles.stepH}>{cap.title}</b>
                      <span className={styles.stepP}>{cap.body}</span>
                      <span className={styles.stepBar} data-bar aria-hidden="true">
                        <i style={{ width: `${i === s.step ? stepProgress(p, i).toFixed(1) : i < s.step ? 100 : 0}%` }} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div ref={stage} className={styles.bizStage} role="img" aria-label={copy.stage}>
            <div className={styles.cust} data-phone onMouseEnter={pause} onMouseLeave={resume}>
              <p className={`${styles.abs} ${styles.csTop}`}>
                <span className={styles.csBack} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </span>
                <span>{copy.shopPath}</span>
              </p>
              <span className={`${styles.abs} ${styles.csOpen}`}>
                <i />
                {copy.open}
              </span>
              <p className={`${styles.abs} ${styles.csName}`}>Kek Lina</p>
              <p className={`${styles.abs} ${styles.csFacts}`}>{copy.facts}</p>
              <span className={`${styles.abs} ${styles.csCats}`}>
                {copy.cats.map((cat, i) => (
                  <span key={cat} data-on={i === 0 || undefined}>{cat}</span>
                ))}
              </span>
              {items.map((item, i) => {
                const row = s.rows[i]!;
                return (
                  <div key={item.name} className={`${styles.abs} ${styles.csCard}`} style={{ top: 196 + Math.floor(i / 2) * 176, left: 18 + (i % 2) * 138 }}>
                    <span className={styles.csPh} style={{ background: row.tone }}>
                      {i === 0 ? <span className={styles.csTag}>{copy.bestSeller}</span> : null}
                      <span className={styles.csAdd} data-in={row.qty > 0 || undefined} style={{ transform: `scale(${row.pressed ? 1.18 : 1})` }}>
                        {row.qty > 0 ? row.qty : '+'}
                      </span>
                    </span>
                    <b>{item.name}</b>
                    <span>{item.price}</span>
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
                    <p className={`${styles.abs} ${styles.sheetSide}`}>{copy.itemsTotal}</p>
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
                    <p className={`${styles.abs} ${styles.sheetTitle}`}>{copy.howPay}</p>
                    <p className={`${styles.abs} ${styles.sheetSide}`}>RM235</p>
                    <div className={`${styles.abs} ${styles.pway}`}>
                      {copy.ways.map((way, i) => (
                        <span key={way.label} className={styles.pwRow}>
                          <i className={styles.pwRd} data-on={(i === 0 && s.wayPicked) || undefined} />
                          <span className={styles.pwTx}>
                            <b>{way.label}</b>
                            <small>{way.sub}</small>
                          </span>
                          <em className={styles.pwMark} data-mark={way.mark}>{way.mark}</em>
                        </span>
                      ))}
                    </div>
                    <div className={`${styles.abs} ${styles.pbanks}`} style={{ opacity: s.wayPicked ? 1 : 0 }}>
                      <p>{copy.yourBank}</p>
                      <span className={styles.pbGrid}>
                        {copy.banks.map((bank, i) => (
                          <span key={bank} className={styles.pb} data-on={(i === 0 && s.bankPicked) || undefined}>
                            <i style={{ background: BANK_COLOURS[i] }}>{bank[0]}</i>
                            {bank}
                          </span>
                        ))}
                      </span>
                    </div>
                    <span className={`${styles.abs} ${styles.cta}`} data-pay style={{ opacity: s.bankPicked ? 1 : 0.45 }}>
                      {s.bankPicked ? copy.payWith : copy.pay}
                    </span>
                    {s.chip ? (
                      <div className={styles.chipv}>
                        <span className={styles.goBank}>M</span>
                        {s.approved ? (
                          <>
                            <p className={styles.goT}>{copy.approved}</p>
                            <p className={styles.goS}>{copy.approvedNote}</p>
                            <span className={styles.goOk}>
                              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                              {copy.paidChip}
                            </span>
                          </>
                        ) : (
                          <>
                            <p className={styles.goT}>{copy.opening}</p>
                            <p className={styles.goS}>{copy.openingNote}</p>
                            <span className={styles.goSpin} aria-hidden="true" />
                          </>
                        )}
                        <p className={styles.goF}>{copy.processed}</p>
                      </div>
                    ) : null}
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

              <div className={styles.csLib} style={{ transform: `translateX(${s.lib.x}%)` }}>
                <p className={`${styles.abs} ${styles.csTop}`} style={{ justifyContent: 'center' }}>
                  <span>{copy.shopPath.replace(/\/shop$/, '')}</span>
                </p>
                <span className={`${styles.abs} ${styles.lbAv}`}>K</span>
                <p className={`${styles.abs} ${styles.lbNm}`}>Kek Lina</p>
                <p className={`${styles.abs} ${styles.lbHd}`}>{copy.lib.bio}</p>
                <span className={`${styles.abs} ${styles.lbTabs}`}>
                  <span data-on>{COPY[locale].hero.linksTab}</span>
                  <span>{COPY[locale].hero.askTab}</span>
                </span>
                <span className={`${styles.abs} ${styles.lbShop}`} style={{ transform: `scale(${s.lib.pressed ? 0.97 : 1})` }}>
                  <span className={styles.lbTh}>
                    <i style={{ background: 'var(--tj-card-rose)' }} />
                    <i>
                      <img src="/landing/hero-baker.webp" alt="" style={{ objectPosition: '72% 80%' }} />
                    </i>
                    <i style={{ background: 'var(--tj-blob-pink)' }} />
                  </span>
                  <span className={styles.lbSt}>
                    <b>{copy.lib.shop}</b>
                    <small>{copy.lib.shopSub}</small>
                  </span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
                {copy.lib.links.map((link, i) => (
                  <span key={link} className={`${styles.abs} ${styles.lbL}`} style={{ top: 318 + i * 54 }}>
                    {link}
                  </span>
                ))}
                <p className={`${styles.abs} ${styles.lbFt}`}>{copy.lib.foot}</p>
              </div>

              <Cursor {...s.cursor} />
            </div>

            <span className={styles.token} style={{ transform: `translate(${s.token.x}px, ${s.token.y}px) scale(${s.token.s})`, opacity: s.token.o }}>
              <b>#14</b> RM235
            </span>

            <div className={styles.own} data-phone onMouseEnter={pause} onMouseLeave={resume}>
              <div className={styles.ownScreen}>
                <p className={styles.osStatus}>
                  <span>11:42</span>
                  <span aria-hidden="true">●●●</span>
                </p>

                <div className={styles.o3Head}>
                  <b>{copy.orders}</b>
                  <span>{copy.seeShop}</span>
                </div>
                <div className={styles.o3Kpi}>
                  <span>
                    <b>1</b>
                    <small>{copy.toCheck}</small>
                  </span>
                  <span>
                    <b>
                      RM{s.today}
                      <em style={{ opacity: s.plus }}>+235</em>
                    </b>
                    <small>{copy.paidWeek}</small>
                  </span>
                </div>
                <div className={styles.o3Seg} aria-hidden="true">
                  <span data-on>{copy.seg[0]}</span>
                  <span>
                    {copy.seg[1]}
                    <i data-amber>1</i>
                  </span>
                  <span>
                    {copy.seg[2]}
                    <i>{s.paidCount}</i>
                  </span>
                  <span>{copy.seg[3]}</span>
                </div>
                <div className={styles.o3List}>
                  <div style={{ display: 'grid', gridTemplateRows: `${s.card.inserted}fr`, opacity: s.card.inserted, transform: `translateY(${-12 + 12 * s.card.inserted}px)` }}>
                    <div style={{ minHeight: 0, overflow: 'hidden', padding: 2 }}>
                      <div className={styles.o3New} style={{ boxShadow: `0 0 0 1.5px ${s.card.ring ? 'var(--biru)' : 'transparent'}` }}>
                        <p className={styles.o3Row}>
                          <span className={styles.o3Av} style={{ background: AVATAR_TONES[0] }}>M</span>
                          <span className={styles.o3Tx}>
                            <b>{copy.mira}</b>
                            <span>{copy.miraSub}</span>
                          </span>
                          <span className={styles.o3Amt}>
                            <b>RM235</b>
                            <em data-tone="green">{s.completed ? copy.completed : copy.paidOnline}</em>
                          </span>
                        </p>
                        <div className={styles.o3Act}>
                          <p>
                            <b>{copy.actTitle}</b>
                            <span>{copy.actNote}</span>
                          </p>
                          <span className={styles.o3Btn} data-done={s.completed || undefined}>
                            {s.completed ? copy.done : copy.markDone}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className={styles.o3Row}>
                    <span className={styles.o3Av} style={{ background: AVATAR_TONES[1] }}>H</span>
                    <span className={styles.o3Tx}>
                      <b>{copy.hakim}</b>
                      <span>{copy.hakimSub}</span>
                    </span>
                    <span className={styles.o3Amt}>
                      <b>RM180</b>
                      <em data-tone="grey">{copy.awaiting}</em>
                    </span>
                  </p>
                  <p className={styles.o3Row}>
                    <span className={styles.o3Av} style={{ background: AVATAR_TONES[2] }}>W</span>
                    <span className={styles.o3Tx}>
                      <b>{copy.weiLing}</b>
                      <span>{copy.weiLingSub}</span>
                    </span>
                    <span className={styles.o3Amt}>
                      <b>RM70</b>
                      <em>{copy.paid}</em>
                    </span>
                  </p>
                </div>

                <div className={styles.notif} style={{ transform: `translateY(${s.notif.y}%)`, opacity: s.notif.o }}>
                  <p>
                    <span className={styles.notifIcon}><svg width="100%" height="100%" style={{ display: 'block' }} viewBox="0 0 32 32" aria-hidden="true"><defs><clipPath id={`${badgeId}-crf`}><rect width="32" height="32" rx="8" /></clipPath></defs><g clipPath={`url(#${badgeId}-crf)`}><rect width="32" height="32" fill="#2340c8" /><path d="M4 33V21.5a12 12 0 0 1 24 0V33z" fill="#fafbfc" /><circle cx="12" cy="20.6" r="3.8" fill="#191f2c" /><circle cx="20" cy="20.6" r="3.8" fill="#191f2c" /><circle cx="13.1" cy="19.1" r="1.2" fill="#fafbfc" /><circle cx="21.1" cy="19.1" r="1.2" fill="#fafbfc" /></g></svg></span>
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
