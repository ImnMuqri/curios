'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { Claim } from './Claim.js';
import { PageCard } from './PageCard.js';
import { DECK, PERSONAS } from './personas.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

const PEOPLE = DECK.map((key) => PERSONAS[key]);
/** The names the chip rolls through, with the first again at the end so the roll can wrap without a jump. */
const NAMES = [...PEOPLE.map((p) => p.short), PEOPLE[0]!.short];

// useLayoutEffect warns on the server; the measuring only matters in a browser.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * "Don't read the bio. Ask Aisyah." The name rolls to the front page of the
 * deck beside it, in that page's own colour. Each turn, a cursor taps the
 * front page's Ask tab and its answer types out; then the next page comes to
 * the front. Pressing the deck moves it on. With reduced motion it holds on
 * the first page, answered.
 */
export function Hero({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const reduced = useReducedMotion();
  const [p, setP] = useState(0);
  const [rot, setRot] = useState({ i: 0, animate: true });
  const [intro, setIntro] = useState(3);
  const [typed, setTyped] = useState(Number.MAX_SAFE_INTEGER);
  const [widths, setWidths] = useState<number[] | null>(null);
  const timers = useRef<number[]>([]);
  const measure = useRef<HTMLSpanElement>(null);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const advance = useCallback(() => {
    clear();
    setP((current) => (current + 1) % PEOPLE.length);
    setRot((current) => ({ i: current.i + 1, animate: true }));
  }, []);

  // The roll wraps: past the last real name it shows the first again, then snaps back without moving.
  useEffect(() => {
    if (rot.i !== PEOPLE.length) return;
    const t = window.setTimeout(() => setRot({ i: 0, animate: false }), 560);
    return () => window.clearTimeout(t);
  }, [rot.i]);

  // One turn of the front page: the cursor arrives, taps Ask, and the answer types out.
  useEffect(() => {
    if (reduced) {
      setIntro(3);
      setTyped(Number.MAX_SAFE_INTEGER);
      return;
    }
    clear();
    setIntro(0);
    setTyped(0);
    later(() => setIntro(1), 600);
    later(() => setIntro(2), 1650);
    later(() => {
      setIntro(3);
      const answer = copy.personas[PEOPLE[p]!.key].a;
      let n = 0;
      const tick = () => {
        n += 1;
        setTyped(n);
        if (n < answer.length) later(tick, 26);
        else later(advance, 2600);
      };
      later(tick, 26);
    }, 2050);
    return clear;
  }, [p, reduced, advance, copy.personas]);

  // The chip is as wide as the name it shows, so it is measured in the face that loaded.
  useBrowserLayoutEffect(() => {
    const read = () => {
      const box = measure.current;
      if (!box) return;
      const size = parseFloat(getComputedStyle(box).fontSize) || 1;
      setWidths([...box.children].map((child) => child.getBoundingClientRect().width / size + 0.02));
    };
    read();
    document.fonts?.ready.then(read).catch(() => {});
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  const front = PEOPLE[p]!;
  const chip: CSSProperties = {
    background: front.accent,
    ...(widths ? { width: `${widths[Math.min(rot.i, NAMES.length - 1)]}em` } : {}),
  };
  const labels = { links: copy.hero.linksTab, ask: copy.hero.askTab, askAnything: copy.hero.askAnything };

  return (
    <section className={styles.hero}>
      <div className={styles.blobs} aria-hidden="true">
        <span className={`${styles.blob} ${styles.b1}`} style={{ background: 'radial-gradient(circle, var(--tj-blob-blue) 0%, transparent 65%)' }} />
        <span className={`${styles.blob} ${styles.b2}`} style={{ background: 'radial-gradient(circle, var(--tj-blob-pink) 0%, transparent 65%)' }} />
        <span className={`${styles.blob} ${styles.b3}`} style={{ background: 'radial-gradient(circle, var(--tj-blob-peach) 0%, transparent 65%)' }} />
        <span className={`${styles.blob} ${styles.b4}`} style={{ background: 'radial-gradient(circle, var(--tj-blob-mint) 0%, transparent 65%)' }} />
        <svg className={styles.grain}>
          <filter id="grain-hero">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain-hero)" />
        </svg>
      </div>

      <div className={`${styles.wrap} ${styles.heroGrid}`}>
        <div>
          <p className={styles.eyebrow}>{copy.hero.eyebrow}</p>
          <h1 className={styles.heroTitle}>
            {copy.hero.line}
            <br />
            {copy.hero.ask}{' '}
            {/* Read once, as the first name; the roll is for the eye. */}
            <span className={styles.srOnly}>{PEOPLE[0]!.short}.</span>
            <span aria-hidden="true">
              <span className={styles.nameChip} style={chip}>
                <span
                  className={styles.nameReel}
                  style={{
                    transform: `translateY(-${rot.i * 1.08}em)`,
                    transition: rot.animate && !reduced ? 'transform 520ms cubic-bezier(0.34, 1.35, 0.64, 1)' : 'none',
                  }}
                >
                  {NAMES.map((name, i) => (
                    <span key={i}>{name}</span>
                  ))}
                </span>
              </span>
              .
              <span ref={measure} className={styles.nameMeasure}>
                {NAMES.map((name, i) => (
                  <span key={i}>{name}</span>
                ))}
              </span>
            </span>
          </h1>
          <p className={styles.heroLede}>{copy.hero.lede}</p>
          <Claim id="claim-hero" label={copy.hero.claimLabel} placeholder={copy.hero.placeholder} button={copy.hero.button} />
          <p className={styles.claimNote}>{copy.hero.note}</p>
        </div>

        <div className={styles.deckStage} role="group" aria-label={copy.hero.deck}>
          <button type="button" className={styles.deckButton} aria-label={copy.hero.next} onClick={advance}>
            {PEOPLE.map((person, k) => {
              const pos = (k - p + PEOPLE.length) % PEOPLE.length;
              const isFront = pos === 0;
              const asking = isFront && intro >= 3;
              const words = copy.personas[person.key];
              return (
                <PageCard
                  key={person.key}
                  persona={person}
                  words={words}
                  view={asking ? 'ask' : 'links'}
                  labels={labels}
                  answer={isFront ? words.a.slice(0, typed) : words.a}
                  typing={isFront && asking && typed < words.a.length}
                  kind={copy.hero.kinds[person.kind]}
                  className={styles.deckCard}
                  style={{
                    transform: `translate(${pos * 30}px, ${-pos * 6}px) rotate(${pos * 4.5}deg) scale(${1 - pos * 0.05})`,
                    zIndex: PEOPLE.length - pos,
                    opacity: pos >= 3 ? 0 : 1,
                  }}
                  tabExtra={
                    isFront && intro < 3 && !reduced ? (
                      <>
                        {intro === 2 ? <span className={styles.ripple} /> : null}
                        <span
                          className={styles.cursor}
                          style={{
                            transform: `translate(${intro >= 1 ? -4 : 70}px, ${intro >= 1 ? -2 : 150}px) scale(${intro === 2 ? 0.82 : 1})`,
                            opacity: intro >= 1 ? 1 : 0,
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="24" height="24">
                            <path d="M5 3l14 8-6.2 1.6L10 19z" fill="var(--ink)" stroke="var(--paper)" strokeWidth="1.6" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </>
                    ) : null
                  }
                />
              );
            })}
          </button>
        </div>
      </div>
    </section>
  );
}
