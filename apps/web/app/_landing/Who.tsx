'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { PERSONAS, WHO } from './personas.js';
import { useScene, type Scene } from './scene.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import calm from './calm.module.css';
import styles from './who.module.css';

/** How long a question's answers stay up, and after a visitor picks one (Landing2 board, L2:1023). */
export const SQ_HOLD_MS = 4600;
export const SQ_USER_HOLD_MS = 15000;

export interface WhoState {
  /** The question in the ask bar. */
  q: number;
  /** The ask bar's text as far as it has been typed. */
  typed: string;
  pressed: boolean;
  /** Dots on every card. */
  thinking: boolean;
  /** Which question the cards are answering, and how many have answered. */
  ans: number;
  shown: number;
  /** Bumped when Peek should hop. */
  hop: number;
}

interface WhoProps {
  cursor: { q: number; ans: number; held: boolean };
  questions: string[];
}

/** One question to five pages (Landing2 board, L2:1010–1023). */
export const whoScene: Scene<WhoState, WhoProps> = {
  // The question the cursor is on, all five answered: a chip picked under reduced motion shows its answers.
  still: (p) => ({ q: p.cursor.q, typed: p.questions[p.cursor.q] ?? '', pressed: false, thinking: false, ans: p.cursor.q, shown: WHO.length, hop: 0 }),
  start: (p) => ({ q: p.cursor.q, typed: '', pressed: false, thinking: false, ans: p.cursor.ans, shown: WHO.length, hop: 0 }),
  async run(p, set, wait) {
    const q = p.cursor.q;
    const text = p.questions[q] ?? '';
    set((s) => ({ ...s, q, typed: '' }));
    for (let c = 1; c <= text.length; c++) {
      const typed = text.slice(0, c);
      set((s) => ({ ...s, typed }));
      await wait(38);
    }
    await wait(250);
    set((s) => ({ ...s, pressed: true }));
    await wait(150);
    set((s) => ({ ...s, pressed: false, thinking: true, shown: 0 }));
    await wait(700);
    for (let k = 1; k <= WHO.length; k++) {
      set((s) => ({ ...s, thinking: false, ans: q, shown: k }));
      await wait(260);
    }
    p.cursor.ans = q;
    set((s) => ({ ...s, hop: s.hop + 1 }));
    const held = p.cursor.held;
    p.cursor.held = false;
    await wait(held ? SQ_USER_HOLD_MS : SQ_HOLD_MS);
    p.cursor.q = (q + 1) % p.questions.length;
  },
};

/**
 * Who it's for (Landing2 board): the same question asked of five pages, each
 * answering in its own words. The question types into the ask bar, the
 * cards think, then answer one after another. A question chip jumps to that
 * question and holds it longer. The server, and reduced motion, show all
 * five answers to the first question (or to the chip picked). The answers
 * are no live region: the loop would read itself aloud every few seconds.
 */
export function Who({ locale }: { locale: Locale }) {
  const copy = COPY[locale].who;
  const [jump, setJump] = useState(0);
  const cursor = useRef({ q: 0, ans: 0, held: false });
  const five = useRef<HTMLDivElement>(null);
  const s = useScene(whoScene, { cursor: cursor.current, questions: copy.questions }, five, jump);
  const peek = useRef<LivePeekHandle>(null);

  useEffect(() => {
    if (s.hop > 0) peek.current?.mood('hop', 520);
  }, [s.hop]);

  const pick = (i: number) => {
    cursor.current.q = i;
    cursor.current.held = true;
    setJump((n) => n + 1);
  };

  return (
    <section className={calm.sec} id="who" aria-labelledby="who-title">
      <div className={calm.wrap}>
        <p className={`${calm.lbl} ${calm.rv}`} data-rv="">
          {copy.eyebrow}
        </p>
        <h2 id="who-title" className={`${calm.h2} ${calm.rv}`} data-rv="">
          {copy.title[0]}
          <span className={calm.hl}>{copy.title[1]}</span>
          {copy.title[2]}
        </h2>
        <p className={`${calm.s2} ${calm.rv}`} data-rv="" style={{ '--d': '120ms' } as CSSProperties}>
          {copy.lede}
        </p>
        <div className={`${styles.sq} ${calm.rv}`} data-rv="" style={{ '--d': '200ms' } as CSSProperties}>
          <div className={styles.ask} aria-hidden="true">
            <span className={styles.typed}>{s.typed}</span>
            <em>{copy.asking(WHO.length)}</em>
            <i data-press={s.pressed ? '' : undefined}>
              <svg viewBox="0 0 24 24">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </i>
          </div>
          <span className={styles.pk}>
            <LivePeek width={82} follow ref={peek} />
          </span>
        </div>
        <div className={`${styles.sw} ${calm.rv}`} data-rv="" style={{ '--d': '240ms' } as CSSProperties} role="group" aria-label={copy.questionsLabel}>
          {copy.questions.map((q, i) => (
            <button key={q} type="button" aria-pressed={s.q === i} data-on={s.q === i ? '' : undefined} onClick={() => pick(i)}>
              {q}
            </button>
          ))}
        </div>
        <div ref={five} className={`${styles.five} ${calm.rv}`} data-rv="" style={{ '--d': '300ms' } as CSSProperties}>
          {WHO.map((key, k) => {
            const person = PERSONAS[key];
            const answered = k < s.shown;
            return (
              <article key={key} className={styles.fc} data-k={key}>
                <div className={styles.fa} style={{ backgroundColor: person.tint }}>
                  <small>
                    <i style={{ background: person.accent }} />
                    {copy.pageOf(person.name)}
                  </small>
                  {answered ? (
                    <p key={`${s.ans}-${k}`} data-in="">
                      {copy.answers[key][s.ans]}
                    </p>
                  ) : (
                    <p>
                      {s.thinking ? (
                        <span className={calm.tdots} aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : null}
                    </p>
                  )}
                </div>
                <div className={styles.fb}>
                  <span className={styles.av} style={{ background: person.warm, color: person.accent }} aria-hidden="true">
                    {person.name.charAt(0)}
                  </span>
                  <div>
                    <b>{person.name}</b>
                    <small>{copy.roles[key]}</small>
                    <em>curios.my/{person.handle}</em>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
