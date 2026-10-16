'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY, type Locale } from './copy.js';
import { Found, Stack, Tilt } from './HowParts.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

/**
 * Where the rooms stand at `p`, the section's scroll progress from 0 to 1:
 * each room holds for a while, then the next slides in. `at` is in rooms
 * (0 to 2), so the track moves by thirds and the rail fills by halves.
 */
export function howAt(p: number): { at: number; step: number } {
  const ease = (a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
  const at = ease(0.14, 0.36) + ease(0.64, 0.86);
  return { at, step: p < 0.3 ? 0 : p < 0.8 ? 1 : 2 };
}

/**
 * How it works, in three rooms. Where motion is welcome the section pins
 * (tanya.module.css) and the rooms slide sideways as the page scrolls: one
 * reading of the scroll moves the track, fills the rail and marks the dot, so
 * the three always agree. With reduced motion they are a row to swipe.
 */
export function How({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  const [one, two, three] = copy.steps;
  const reduced = useReducedMotion();
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const el = section.current;
    if (reduced || !el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const travel = box.height - window.innerHeight;
      const p = travel > 0 ? Math.min(1, Math.max(0, -box.top / travel)) : 0;
      const { at, step: now } = howAt(p);
      if (track.current) track.current.style.transform = `translateX(${(-at * 100) / 3}%)`;
      if (fill.current) fill.current.style.transform = `scaleX(${at / 2})`;
      setStep(now);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (track.current) track.current.style.transform = '';
    };
  }, [reduced]);

  return (
    <section id="how" ref={section} className={styles.how}>
      <div className={styles.howPin}>
        <div className={styles.wrap}>
          <div className={styles.howHead}>
            <div>
              <p className={styles.eyebrow}>{copy.eyebrow}</p>
              <h2 className={styles.h2}>{copy.title}</h2>
            </div>
            <div className={styles.howDots} aria-hidden="true">
              <span className={styles.howRail}>
                <span ref={fill} className={styles.howFill} />
              </span>
              {[0, 1, 2].map((i) => (
                <span key={i} className={styles.howDot} data-on={i <= step || undefined}>
                  {i + 1}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.howView}>
            <ol ref={track} className={styles.howTrack}>
              <li className={styles.howSlide}>
                <div className={`${styles.room} ${styles.room1}`}>
                  <span className={styles.roomN} aria-hidden="true">01</span>
                  <div className={styles.roomText}>
                    <h3 className={styles.roomH}>{one!.title}</h3>
                    <p className={styles.roomP}>{one!.body}</p>
                  </div>
                  <div className={styles.roomStage}>
                    <Found locale={locale} />
                  </div>
                </div>
              </li>

              <li className={styles.howSlide}>
                <div className={`${styles.room} ${styles.room2}`}>
                  <span className={styles.roomN} aria-hidden="true">02</span>
                  <div className={styles.roomText}>
                    <h3 className={styles.roomH}>{two!.title}</h3>
                    <p className={styles.roomP}>{two!.body}</p>
                  </div>
                  <div className={styles.roomStage}>
                    <Stack locale={locale} />
                  </div>
                </div>
              </li>

              <li className={styles.howSlide}>
                <div className={`${styles.room} ${styles.room3}`}>
                  <span className={styles.roomN} aria-hidden="true">03</span>
                  <div className={styles.roomText}>
                    <h3 className={styles.roomH}>{three!.title}</h3>
                    <p className={styles.roomP}>{three!.body}</p>
                  </div>
                  <div className={`${styles.roomStage} ${styles.bioStage}`}>
                    <div className={styles.ring} aria-hidden="true">
                      <svg viewBox="0 0 200 200">
                        <path id="ring-path" d="M100,100 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0" fill="none" />
                        <text>
                          <textPath href="#ring-path">{copy.ring}</textPath>
                        </text>
                      </svg>
                      <span className={styles.ringFace}>A</span>
                    </div>
                    <Tilt>
                      <p className={styles.bioWho}>
                        <span className={styles.bioFace} aria-hidden="true">A</span>
                        <span>
                          <b>{copy.card.name}</b>
                          <span>{copy.card.role}</span>
                        </span>
                      </p>
                      <p className={styles.bioText}>{copy.card.bio}</p>
                      <p className={styles.bioLink}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                        </svg>
                        curios.my/aisyahdraws
                      </p>
                    </Tilt>
                  </div>
                </div>
              </li>
            </ol>
          </div>
          <p className={styles.keep} aria-hidden="true">{copy.keep}</p>
        </div>
      </div>
    </section>
  );
}
