'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { useScene, type Scene } from './scene.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import { PERSONAS } from './personas.js';
import calm from './calm.module.css';
import styles from './how.module.css';

type Segment = string | { fact: number; text: string };
const plain = (segs: readonly Segment[]) => segs.map((s) => (typeof s === 'string' ? s : s.text)).join('');
const MARKS = 4;
const AISYAH = PERSONAS.aisyah;

/* ---------- 1. Tell it about you: the paste, its facts marked ---------- */

export interface PasteState {
  /** Characters typed so far; null once the whole text is in with its marks. */
  typed: number | null;
  marks: number;
  found: boolean;
}

export const pasteScene: Scene<PasteState, { text: readonly Segment[] }> = {
  still: () => ({ typed: null, marks: MARKS, found: true }),
  start: () => ({ typed: 0, marks: 0, found: false }),
  async run(p, set, wait) {
    const full = plain(p.text);
    set({ typed: 0, marks: 0, found: false });
    for (let i = 1; i <= full.length; i += 2) {
      set({ typed: i, marks: 0, found: false });
      await wait(16);
    }
    set({ typed: null, marks: 0, found: false });
    await wait(500);
    for (let m = 1; m <= MARKS; m++) {
      set({ typed: null, marks: m, found: false });
      await wait(420);
    }
    set({ typed: null, marks: MARKS, found: true });
    await wait(3600);
  },
};

export function PasteArt({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  const ref = useRef<HTMLDivElement>(null);
  const s = useScene(pasteScene, { text: copy.pastedText }, ref);
  return (
    <div ref={ref} className={styles.art} data-tone="1">
      <span className={styles.step}>1</span>
      <div className={styles.paste}>
        <small>{copy.pasted}</small>
        <p>
          {s.typed !== null ? (
            <>
              {plain(copy.pastedText).slice(0, s.typed)}
              <span className={calm.caret} />
            </>
          ) : (
            copy.pastedText.map((seg, i) =>
              typeof seg === 'string' ? (
                seg
              ) : (
                <mark key={i} data-on={seg.fact < s.marks ? '' : undefined}>
                  {seg.text}
                </mark>
              ),
            )
          )}
        </p>
      </div>
      <span className={styles.found} data-in={s.found ? '' : undefined}>
        {copy.found(MARKS)}
      </span>
    </div>
  );
}

/* ---------- 2. Approve what's right: the facts, one by one ---------- */

export interface FactsState {
  /** The fact on top; FACTS.length once all are approved. */
  cur: number;
  pressed: boolean;
  /** The fact just sent off, still flying. */
  gone: number | null;
  approved: number;
  done: boolean;
}

const FACT_COUNT = 4;

export const factsScene: Scene<FactsState, null> = {
  still: () => ({ cur: FACT_COUNT, pressed: false, gone: null, approved: FACT_COUNT, done: true }),
  start: () => ({ cur: 0, pressed: false, gone: null, approved: 0, done: false }),
  async run(_p, set, wait) {
    set({ cur: 0, pressed: false, gone: null, approved: 0, done: false });
    for (let i = 0; i < FACT_COUNT; i++) {
      await wait(1300);
      set((s) => ({ ...s, pressed: true }));
      await wait(170);
      set({ cur: i + 1, pressed: false, gone: i, approved: i + 1, done: false });
    }
    await wait(500);
    set((s) => ({ ...s, gone: null, done: true }));
    await wait(2600);
  },
};

export function FactsArt({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  const ref = useRef<HTMLDivElement>(null);
  const s = useScene(factsScene, null, ref);
  const card = (i: number, role: 'cur' | 'next' | 'gone') => {
    const fact = copy.facts[i]!;
    return (
      <div key={i} className={styles.fact} data-role={role} aria-hidden={role !== 'cur' || undefined}>
        <small>
          {copy.factOf(i + 1, FACT_COUNT)} · {copy.from}
        </small>
        <b>{fact.text}</b>
        <p>{copy.usedFor(fact.topic)}</p>
        <div className={styles.fbtns}>
          <span className={`${calm.btn} ${calm.lite} ${calm.xs}`}>{copy.fix}</span>
          <span className={`${calm.btn} ${calm.dark} ${calm.xs}`} data-press={role === 'cur' && s.pressed ? '' : undefined}>
            {copy.approve}
          </span>
        </div>
      </div>
    );
  };
  return (
    <div ref={ref} className={styles.art} data-tone="2">
      <span className={styles.step}>2</span>
      <span className={styles.fcount}>{copy.approved(s.approved)}</span>
      <div className={styles.fstack}>
        {s.cur + 1 < FACT_COUNT ? card(s.cur + 1, 'next') : null}
        {s.cur < FACT_COUNT ? card(s.cur, 'cur') : null}
        {s.gone !== null ? card(s.gone, 'gone') : null}
        {s.done ? (
          <div className={`${styles.fact} ${styles.done}`} data-role="cur">
            <i aria-hidden="true">✓</i>
            <b>{copy.allApproved.title}</b>
            <p>{copy.allApproved.body}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- 3. Put the link in your bio: tap it, ask, answered ---------- */

export interface BioState {
  tap: 'off' | 'in' | 'there' | 'down';
  hot: boolean;
  go: boolean;
  /** The ask bar's typed text; null shows the placeholder. */
  typing: string | null;
  pressed: boolean;
  q: boolean;
  dots: boolean;
  a: string;
  time: boolean;
  up: boolean;
  cheer: number;
}

export const bioScene: Scene<BioState, { q: string; a: string }> = {
  still: (p) => ({ tap: 'off', hot: false, go: true, typing: null, pressed: false, q: true, dots: false, a: p.a, time: true, up: true, cheer: 0 }),
  start: () => ({ tap: 'off', hot: false, go: false, typing: null, pressed: false, q: false, dots: false, a: '', time: false, up: false, cheer: 0 }),
  async run(p, set, wait) {
    set((s) => ({ ...bioScene.start(p), cheer: s.cheer }));
    await wait(900);
    set((s) => ({ ...s, tap: 'in' }));
    await wait(60);
    set((s) => ({ ...s, tap: 'there' }));
    await wait(980);
    set((s) => ({ ...s, tap: 'down', hot: true, pressed: true }));
    await wait(180);
    set((s) => ({ ...s, pressed: false }));
    await wait(260);
    set((s) => ({ ...s, tap: 'off', go: true }));
    await wait(850);
    for (let i = 1; i <= p.q.length; i++) {
      const typing = p.q.slice(0, i);
      set((s) => ({ ...s, typing }));
      await wait(30);
    }
    await wait(250);
    set((s) => ({ ...s, pressed: true }));
    await wait(150);
    set((s) => ({ ...s, pressed: false, typing: null, q: true }));
    await wait(500);
    set((s) => ({ ...s, dots: true, time: true }));
    await wait(850);
    for (let i = 1; i <= p.a.length; i++) {
      const a = p.a.slice(0, i);
      set((s) => ({ ...s, dots: false, a }));
      await wait(16);
    }
    set((s) => ({ ...s, up: true, cheer: s.cheer + 1 }));
    await wait(3800);
  },
};

export function BioArt({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  const ref = useRef<HTMLDivElement>(null);
  const s = useScene(bioScene, { q: copy.chat.q, a: copy.chat.a }, ref);
  const peek = useRef<LivePeekHandle>(null);
  useEffect(() => {
    if (s.cheer > 0) peek.current?.mood('happy', 1700);
  }, [s.cheer]);
  return (
    <div ref={ref} className={styles.art} data-tone="3" style={{ '--pc-deep': AISYAH.deep, '--pc-accent': AISYAH.accent } as CSSProperties}>
      <span className={styles.step}>3</span>
      <div className={styles.bio} data-go={s.go ? '' : undefined}>
        <div className={`${styles.bioS} ${styles.bioIg}`}>
          <div className={styles.bioTop}>
            <span className={styles.igav} aria-hidden="true">
              {copy.chat.name.charAt(0)}
            </span>
            <div>
              <b>{copy.bio.handle}</b>
              <small>{copy.bio.role}</small>
            </div>
          </div>
          <p>{copy.bio.text}</p>
          <span className={styles.iglink} data-hot={s.hot ? '' : undefined} data-press={s.tap === 'down' && s.pressed ? '' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
            </svg>
            {copy.bio.link}
          </span>
          <div className={styles.bioSt}>
            <span>
              <b>{copy.bio.posts[0]}</b> {copy.bio.posts[1]}
            </span>
            <span>
              <b>{copy.bio.followers[0]}</b> {copy.bio.followers[1]}
            </span>
          </div>
        </div>
        <div className={`${styles.bioS} ${styles.bioCp}`}>
          <div className={styles.bcpH}>
            <b>{copy.chat.name}</b>
            <small>{copy.bio.link}</small>
          </div>
          <div className={styles.bcpM}>
            <span className={styles.bcpQ} data-in={s.q ? '' : undefined}>
              {copy.chat.q}
            </span>
            <span className={styles.bcpA} data-in={s.dots || s.a ? '' : undefined}>
              {s.dots ? (
                <span className={calm.tdots}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                s.a
              )}
            </span>
          </div>
          <div className={styles.bcpIn} data-ty={s.typing !== null ? '' : undefined}>
            <span>{s.typing ?? copy.chat.placeholder}</span>
            <i data-press={s.go && s.pressed ? '' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </i>
          </div>
        </div>
        <span className={styles.tap} data-tap={s.tap} />
      </div>
      <span className={styles.bioTime} data-in={s.time ? '' : undefined}>
        {copy.chat.time}
      </span>
      <span className={styles.artPk} data-up={s.up ? '' : undefined}>
        <LivePeek width={80} follow ref={peek} />
      </span>
    </div>
  );
}
