'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { Claim } from './Claim.js';
import { PageCard } from './PageCard.js';
import { DECK, PERSONAS } from './personas.js';
import { useScene, type Scene } from './scene.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import calm from './calm.module.css';
import styles from './hero.module.css';

const PEOPLE = DECK.map((key) => PERSONAS[key]);
const N = PEOPLE.length;

export interface HeroState {
  front: number;
  asking: boolean;
  q: boolean;
  dots: boolean;
  /** The answer as far as it has been typed. */
  answer: string;
  typing: boolean;
  /** Bumped when Peek should be happy. */
  cheer: number;
}

interface HeroProps {
  /**
   * Which page is in front, and whether it is already answered; the run moves
   * it on, and a click sets it. The page opens on Aisyah answered, as the
   * server draws her.
   */
  cursor: { front: number; answered: boolean };
  answers: string[];
}

/** The front page, asked and fully answered. */
const answeredFrame = (p: HeroProps): HeroState => ({
  front: p.cursor.front,
  asking: true,
  q: true,
  dots: false,
  answer: p.answers[p.cursor.front] ?? '',
  typing: false,
  cheer: 0,
});

/**
 * The hero deck's turn (Landing2 board, L2:982–989): ask the front page, type
 * its answer, move on. The first turn starts on the server's frame (Aisyah
 * answered) and only holds it, so hydrating changes nothing on screen.
 */
export const heroScene: Scene<HeroState, HeroProps> = {
  still: answeredFrame,
  start: (p) =>
    p.cursor.answered ? answeredFrame(p) : { front: p.cursor.front, asking: false, q: false, dots: false, answer: '', typing: false, cheer: 0 },
  async run(p, set, wait) {
    const front = p.cursor.front;
    if (!p.cursor.answered) {
      const text = p.answers[front] ?? '';
      await wait(1700);
      set((s) => ({ ...s, front, asking: true }));
      await wait(450);
      set((s) => ({ ...s, q: true }));
      await wait(650);
      set((s) => ({ ...s, dots: true }));
      await wait(900);
      for (let i = 1; i <= text.length; i++) {
        const answer = text.slice(0, i);
        set((s) => ({ ...s, dots: false, typing: true, answer }));
        await wait(22);
      }
      await wait(500);
      p.cursor.answered = true;
      set((s) => ({ ...s, typing: false, cheer: s.cheer + 1 }));
    }
    await wait(2300);
    const next = (front + 1) % N;
    p.cursor.front = next;
    p.cursor.answered = false;
    set((s) => ({ ...s, front: next, asking: false, q: false, dots: false, answer: '', typing: false }));
    await wait(500);
  },
};

/** A card's slot in the deck, -2…2, the front at 0. */
function slotOf(i: number, front: number): number {
  let s = i - front;
  if (s > N / 2) s -= N;
  if (s < -N / 2) s += N;
  return Math.max(-2, Math.min(2, s));
}

// useLayoutEffect warns on the server; the measuring only matters in a browser.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * "Don’t read the bio. Ask Aisyah." (Landing2 board): the name pill rolls to
 * the front page of the deck, in that owner's colours. Each turn the front
 * page is asked and its answer types out, then the next page comes forward.
 * A click on a side page brings it to the front. The server, and reduced
 * motion, draw the front page asked and answered (Aisyah, until a click).
 */
export function Hero({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [jump, setJump] = useState(0);
  const deck = useRef<HTMLDivElement>(null);
  const cursor = useRef({ front: 0, answered: true });
  const answers = PEOPLE.map((p) => copy.personas[p.key].a);
  const s = useScene(heroScene, { cursor: cursor.current, answers }, deck, jump);
  const peek = useRef<LivePeekHandle>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  const measure = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (s.cheer > 0) peek.current?.mood('happy', 1900);
  }, [s.cheer]);

  // The pill is as wide as the name it shows, measured in the face that loaded.
  useBrowserLayoutEffect(() => {
    const read = () => {
      const box = measure.current;
      if (!box) return;
      setWidths([...box.children].map((child) => child.getBoundingClientRect().width));
    };
    read();
    document.fonts?.ready.then(read).catch(() => {});
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  const front = PEOPLE[s.front]!;
  const pill = {
    background: front.warm,
    color: front.accent,
    ...(widths?.[s.front] ? { width: `calc(${widths[s.front]}px + 0.44em)` } : {}),
  } as CSSProperties;
  const labels = { links: copy.hero.linksTab, ask: copy.hero.askTab, askAnything: copy.hero.askAnything, reply: copy.hero.replyLabel };

  return (
    <section className={styles.hero}>
      <div className={calm.dotbg} aria-hidden="true" />
      <div className={styles.hin}>
        <h1 className={`${styles.h1} ${calm.rv}`} data-rv="">
          {copy.hero.line}
          <br />
          {copy.hero.ask}{' '}
          {/* Read once, as the first name; the roll is for the eye. */}
          <span className={calm.srOnly}>{PEOPLE[0]!.short}.</span>
          <span aria-hidden="true">
            <span className={styles.rot} style={pill}>
              {/* Sizes the pill to the front name before it is measured, so the first paint does not shift. */}
              <span className={styles.sizer}>{front.short}</span>
              <span className={styles.rotC} style={{ transform: `translateY(-${s.front * 1.14}em)` }}>
                {PEOPLE.map((p) => (
                  <span key={p.key}>{p.short}</span>
                ))}
              </span>
            </span>
            .
          </span>
          <span ref={measure} className={styles.measure} aria-hidden="true">
            {PEOPLE.map((p) => (
              <span key={p.key}>{p.short}</span>
            ))}
          </span>
        </h1>
        <p className={`${styles.sub} ${calm.rv}`} data-rv="" style={{ '--d': '120ms' } as CSSProperties}>
          {copy.hero.lede}
        </p>
        <div className={calm.rv} data-rv="" style={{ '--d': '220ms' } as CSSProperties}>
          <Claim id="claim-hero" label={copy.hero.claimLabel} placeholder={copy.hero.placeholder} button={copy.hero.button} />
        </div>
        <p className={`${calm.fine} ${calm.center} ${calm.rv}`} data-rv="" style={{ '--d': '300ms' } as CSSProperties}>
          {copy.hero.note}
        </p>
      </div>
      <div className={`${styles.stage} ${calm.rv}`} data-rv="" style={{ '--d': '380ms' } as CSSProperties}>
        <span className={`${styles.stagePk} ${styles.left}`}>
          <LivePeek width={132} pose="whistle" />
        </span>
        <div ref={deck} className={styles.deck} role="group" aria-label={copy.hero.deck}>
          {PEOPLE.map((person, i) => {
            const slot = slotOf(i, s.front);
            const isFront = slot === 0;
            const words = copy.personas[person.key];
            return (
              <PageCard
                key={person.key}
                persona={person}
                words={words}
                kind={copy.hero.kinds[person.kind]}
                labels={labels}
                ask={isFront && s.asking}
                q={isFront && s.q}
                dots={isFront && s.dots}
                answer={isFront ? s.answer : ''}
                typing={isFront && s.typing}
                slot={slot}
                label={isFront ? undefined : copy.hero.show(person.name)}
                onPick={
                  isFront
                    ? undefined
                    : () => {
                        cursor.current.front = i;
                        cursor.current.answered = false;
                        setJump((n) => n + 1);
                      }
                }
              />
            );
          })}
        </div>
        <span className={`${styles.stagePk} ${styles.right}`}>
          <LivePeek width={132} follow ref={peek} />
        </span>
      </div>
    </section>
  );
}
