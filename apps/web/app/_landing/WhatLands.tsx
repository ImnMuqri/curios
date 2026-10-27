'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { COPY, type Locale, type WhatLandsPersona } from './copy.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

export type Side = 'service' | 'products';

/** Each side's colours and the two picks' swatches, from design/prototypes/what-lands.html. */
const LOOKS: Record<Side, { dark: string; tint: string; acc: string; acc2: string; bar: string; swatches: [string, string] }> = {
  service: {
    dark: '#16324a',
    tint: '#e9eef6',
    acc: '#5aa0d8',
    acc2: '#2340c8',
    bar: '#2340c8',
    swatches: ['linear-gradient(135deg,#9db6cc,#3c5a75)', 'linear-gradient(135deg,#c9b89a,#6b5a3e)'],
  },
  products: {
    dark: '#542339',
    tint: '#f5e9ec',
    acc: '#e06a8c',
    acc2: '#b5294e',
    bar: '#542339',
    swatches: ['linear-gradient(135deg,#7a3b2a,#3d1a12 60%,#f6c9d5)', 'linear-gradient(135deg,#d9b48a,#5a3a22 70%)'],
  },
};

export type Wait = (ms: number) => Promise<void>;

/**
 * Plays `scene` over and over until the returned stop is called. Stopping
 * clears the pending waits and they never resolve, so nothing after them runs.
 */
export function play(scene: (wait: Wait) => Promise<void>): () => void {
  const timers = new Set<number>();
  let stopped = false;
  const wait: Wait = (ms) =>
    new Promise((resolve) => {
      if (stopped) return;
      const id = window.setTimeout(() => {
        timers.delete(id);
        resolve();
      }, ms);
      timers.add(id);
    });
  void (async () => {
    for (;;) await scene(wait);
  })();
  return () => {
    stopped = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
}

interface Scene<S> {
  /** The finished frame: the server, reduced motion and no IntersectionObserver. */
  still: (p: WhatLandsPersona) => S;
  /** The first frame, held until the section is in view. */
  start: (p: WhatLandsPersona) => S;
  run: (p: WhatLandsPersona, set: Dispatch<SetStateAction<S>>, wait: Wait) => Promise<void>;
}

/** A tile's state: still, held at its start, or playing its scene round and round. */
function useScene<S>(scene: Scene<S>, p: WhatLandsPersona, still: boolean, playing: boolean): S {
  const [s, set] = useState(() => scene.still(p));
  useEffect(() => {
    if (still) {
      set(scene.still(p));
      return;
    }
    set(scene.start(p));
    if (!playing) return;
    return play((wait) => scene.run(p, set, wait));
  }, [scene, p, still, playing]);
  return s;
}

type Stage = 'inbox' | 'replying' | 'sorting' | 'landed';

export interface TallState {
  stage: Stage;
  /** Rows popped in, flipped over, turned into page chats, and sorted. */
  shown: number;
  flipped: number;
  turned: number;
  sorted: number;
  unread: number[];
  /** How often each row's count has ticked up, so its pop plays again. */
  bumps: number[];
  /** The first caption's words, and whether it is hidden while the rows turn. */
  words: 'inbox' | 'replying';
  hush: boolean;
}

/** The big tile, about 12 s a round: the inbox fills, the page answers it, and what is worth calling lands. */
export const TALL: Scene<TallState> = {
  still: (p) => ({ stage: 'landed', shown: 8, flipped: 8, turned: 8, sorted: 8, unread: p.chats.map((c) => c.unread), bumps: p.chats.map(() => 0), words: 'replying', hush: false }),
  start: (p) => ({ stage: 'inbox', shown: 0, flipped: 0, turned: 0, sorted: 0, unread: p.chats.map((c) => c.unread), bumps: p.chats.map(() => 0), words: 'inbox', hush: false }),
  async run(p, set, wait) {
    const rows = p.chats.length;
    set(TALL.start(p));
    await wait(500);
    for (let i = 1; i <= rows; i++) {
      set((s) => ({ ...s, shown: i }));
      await wait(230);
    }
    for (let k = 0; k < 5; k++) {
      await wait(420);
      const r = (k * 3 + 1) % rows;
      set((s) => ({ ...s, unread: s.unread.map((n, i) => (i === r ? n + 1 : n)), bumps: s.bumps.map((n, i) => (i === r ? n + 1 : n)) }));
    }
    await wait(700);
    set((s) => ({ ...s, stage: 'replying', hush: true }));
    for (let i = 1; i <= rows; i++) {
      set((s) => ({ ...s, flipped: i }));
      await wait(90);
    }
    await wait(150);
    set((s) => ({ ...s, words: 'replying', hush: false }));
    for (let i = 1; i <= rows; i++) {
      set((s) => ({ ...s, turned: i }));
      await wait(90);
    }
    await wait(500);
    set((s) => ({ ...s, stage: 'sorting' }));
    await wait(600);
    for (let i = 1; i <= rows; i++) {
      set((s) => ({ ...s, sorted: i }));
      await wait(200);
    }
    await wait(1400);
    set((s) => ({ ...s, stage: 'landed' }));
    await wait(5200);
  },
};

/** 0 empty, 1 asked, 2 typing, 3 answered, 4 picks in, 5 pressed, 6 tapped; `out` fades it all before the next round. */
export interface ChatState {
  step: number;
  out: boolean;
}

export const CHAT: Scene<ChatState> = {
  still: () => ({ step: 6, out: false }),
  start: () => ({ step: 0, out: false }),
  async run(_p, set, wait) {
    set({ step: 0, out: false });
    for (const [ms, step] of [
      [500, 1],
      [700, 2],
      [1100, 3],
      [250, 4],
      [1300, 5],
      [160, 6],
    ] as const) {
      await wait(ms);
      set({ step, out: false });
    }
    await wait(3000);
    set({ step: 6, out: true });
    await wait(500);
  },
};

/** How many alerts have landed; the first is pushed back when the second arrives; then both go. */
export interface AlertsState {
  landed: number;
  gone: boolean;
}

export const ALERTS: Scene<AlertsState> = {
  still: () => ({ landed: 2, gone: false }),
  start: () => ({ landed: 0, gone: false }),
  async run(_p, set, wait) {
    set({ landed: 0, gone: false });
    await wait(900);
    set({ landed: 1, gone: false });
    await wait(2200);
    set({ landed: 2, gone: false });
    await wait(3600);
    set({ landed: 2, gone: true });
    await wait(600);
  },
};

export interface BarsState {
  grown: boolean[];
  counts: number[];
  flagged: boolean;
}

export const BARS: Scene<BarsState> = {
  still: (p) => ({ grown: p.asked.map(() => true), counts: p.asked.map((a) => a.n), flagged: true }),
  start: (p) => ({ grown: p.asked.map(() => false), counts: p.asked.map(() => 0), flagged: false }),
  async run(p, set, wait) {
    set(BARS.start(p));
    await wait(700);
    p.asked.forEach((bar, i) => {
      void (async () => {
        await wait(i * 180);
        set((s) => ({ ...s, grown: s.grown.map((g, j) => g || j === i) }));
        for (let n = 1; n <= bar.n; n++) {
          await wait(800 / bar.n);
          set((s) => ({ ...s, counts: s.counts.map((c, j) => (j === i ? n : c)) }));
        }
      })();
    });
    await wait(1900);
    set((s) => ({ ...s, flagged: true }));
    await wait(4200);
  },
};

/**
 * "What lands in your hands", the first half of For business (Business.tsx),
 * under its label: what an owner gets, not the features, for someone offering a service (Hafiz) or
 * selling products (Kek Lina). A bento of four tiles, each playing its own
 * round while the section is in view; switching side restarts them all. With
 * reduced motion (and on the server) every tile is on its finished frame.
 */
export function WhatLands({ locale }: { locale: Locale }) {
  const copy = COPY[locale].whatLands;
  const reduced = useReducedMotion();
  const [side, setSide] = useState<Side>('service');
  const [inView, setInView] = useState(false);
  const [canWatch, setCanWatch] = useState(true);
  const section = useRef<HTMLDivElement>(null);
  const p = copy[side];
  const look = LOOKS[side];

  useEffect(() => {
    const el = section.current;
    if (reduced || !el) return;
    // Without a way to tell when the section is in view, show the finished frames rather than play unseen.
    if (!('IntersectionObserver' in window)) {
      setCanWatch(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= 0.15) setInView(true);
        else if (!entry.isIntersecting) setInView(false);
      },
      { threshold: [0, 0.15] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const still = reduced || !canWatch;
  const playing = !still && inView;
  const vars = {
    '--wl-dark': look.dark,
    '--wl-tint': look.tint,
    '--wl-acc': look.acc,
    '--wl-acc2': look.acc2,
    '--wl-bar': look.bar,
  } as CSSProperties;

  return (
    <div id="what-lands" ref={section} className={styles.wl} style={vars}>
      <div className={styles.wrap}>
        <div className={styles.wlHead}>
          <div>
            <p className={styles.eyebrow}>{COPY[locale].business.eyebrow}</p>
            <h2 className={styles.h2}>{copy.title}</h2>
            <p className={styles.lede}>{copy.lede}</p>
          </div>
          <div className={styles.wlSwitch} role="group" aria-label={copy.switchLabel}>
            {(['service', 'products'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={s === side} onClick={() => setSide(s)}>
                {copy[s].label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.wlBento}>
          <Tall p={p} still={still} playing={playing} />
          <Suggestions p={p} swatches={look.swatches} still={still} playing={playing} />
          <Alerts p={p} still={still} playing={playing} />
          <Asked p={p} still={still} playing={playing} />
        </div>
      </div>
    </div>
  );
}

interface TileProps {
  p: WhatLandsPersona;
  still: boolean;
  playing: boolean;
}

function Caption({ title, body, hidden, className }: { title: string; body: string; hidden?: boolean; className?: string }) {
  return (
    <div className={className} aria-hidden={hidden || undefined}>
      <b>{title}</b>
      <span>{body}</span>
    </div>
  );
}

function Tall({ p, still, playing }: TileProps) {
  const s = useScene(TALL, p, still, playing);
  const tag = s.stage === 'inbox' ? p.tags.inbox : s.stage === 'landed' ? p.tags.landed : p.tags.replying;
  const first = s.words === 'inbox' ? p.captions.inbox : p.captions.replying;
  const landed = s.stage === 'landed';
  const card = p.card;

  return (
    <div className={`${styles.wlTile} ${styles.wlTall}`} data-stage={s.stage}>
      <div className={styles.wlVis} aria-hidden="true">
        <span className={styles.wlTag}>
          <i />
          <span>{tag}</span>
        </span>
        <div className={`${styles.wlLayer} ${styles.wlBefore}`}>
          {p.chats.map((c, i) => {
            const turned = i < s.turned;
            const sort = i < s.sorted ? (c.keep ? 'keep' : 'done') : undefined;
            return (
              <div
                key={i}
                className={styles.wlRow}
                data-in={i < s.shown || undefined}
                data-inbox={!turned || undefined}
                data-flip={(i < s.flipped && !turned) || undefined}
                data-sort={sort}
              >
                <i />
                {turned ? (
                  <>
                    <span className={styles.wlRowX}>
                      <b>“{c.text}”</b>
                      <span>{p.visitorFrom(c.from)}</span>
                    </span>
                    <span className={styles.wlRowR}>
                      <small>{c.time}</small>
                    </span>
                    <span className={styles.wlOk}>{c.keep ? p.kept : p.answered}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.wlRowX}>
                      <b>{c.phone}</b>
                      <span>{c.text}</span>
                    </span>
                    <span className={styles.wlRowR}>
                      <small>{c.time}</small>
                      <em key={s.bumps[i]} data-pop={s.bumps[i]! > 0 || undefined}>
                        {s.unread[i]}
                      </em>
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className={`${styles.wlLayer} ${styles.wlAfter}`}>
          <div className={styles.wlBig}>
            <div className={styles.wlBigTop}>
              <span>{card.who}</span>
              <span className={styles.wlPill} data-tone={card.kind === 'lead' ? 'hot' : 'paid'}>
                {card.pill}
              </span>
            </div>
            {card.kind === 'lead' ? (
              <>
                <p className={styles.wlBigN}>{card.phone}</p>
                <div className={styles.wlSlots}>
                  {card.slots.map(([k, v]) => (
                    <span key={k}>
                      <small>{k}</small>
                      {v}
                    </span>
                  ))}
                </div>
                <span className={styles.wlWa}>{card.button}</span>
              </>
            ) : (
              <>
                <p className={styles.wlBigN}>{card.total}</p>
                {card.lines.map(([k, v]) => (
                  <div key={k} className={styles.wlLine}>
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
                <div className={`${styles.wlLine} ${styles.wlTotal}`}>
                  <span>{card.foot[0]}</span>
                  <span>{card.foot[1]}</span>
                </div>
              </>
            )}
          </div>
          {p.rows.map((r) => (
            <div key={r.name} className={styles.wlLi}>
              <i>{r.initial}</i>
              <span className={styles.wlLiX}>
                {r.name}
                <small>{r.sub}</small>
              </span>
              <span className={styles.wlPill} data-tone={r.tone}>
                {r.pill}
              </span>
            </div>
          ))}
        </div>
        <PeekAtLaptop />
      </div>
      <div className={styles.wlCap}>
        <div className={styles.wlCapFirst} data-hush={s.hush || undefined} aria-hidden={landed || s.hush || undefined}>
          <b>{first.title}</b>
          <span>{first.body}</span>
        </div>
        <Caption className={styles.wlCapLanded} title={p.captions.landed.title} body={p.captions.landed.body} hidden={!landed} />
      </div>
    </div>
  );
}

function Suggestions({ p, swatches, still, playing }: TileProps & { swatches: [string, string] }) {
  const { step, out } = useScene(CHAT, p, still, playing);
  const chat = p.chat;
  const on = (n: number) => (step >= n && !out) || undefined;

  return (
    <div className={`${styles.wlTile} ${styles.wlSuggest}`}>
      <div className={styles.wlVis} aria-hidden="true">
        <div className={styles.wlChat}>
          <span className={styles.wlQ} data-in={on(1)}>
            {chat.q}
          </span>
          <span className={styles.wlA} data-in={on(2)}>
            <span className={styles.wlPage}>{chat.page}</span>
            {step >= 3 ? (
              chat.a
            ) : (
              <span className={styles.wlDots}>
                <i />
                <i />
                <i />
              </span>
            )}
          </span>
          <div className={styles.wlPicks} data-in={on(4)}>
            {chat.picks.map((pick, i) => {
              const tapped = i === chat.tapped;
              return (
                <span key={pick.name} className={styles.wlPick}>
                  <u style={{ background: swatches[i] }} />
                  <b>{pick.name}</b>
                  {pick.price}
                  <em data-press={(tapped && step === 5) || undefined} data-on={(tapped && step >= 6) || undefined}>
                    {tapped && step >= 6 ? chat.done : pick.button}
                  </em>
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <div className={styles.wlCap}>
        <Caption title={p.suggested.title} body={p.suggested.body} />
      </div>
    </div>
  );
}

function Alerts({ p, still, playing }: TileProps) {
  const { landed, gone } = useScene(ALERTS, p, still, playing);
  // The newer alert comes first, so it sits on top, as a phone stacks them.
  const shown = p.alerts.slice(0, landed).map((a, i) => ({ ...a, i })).reverse();

  return (
    <div className={`${styles.wlTile} ${styles.wlAlertsTile}`}>
      <div className={styles.wlVis} aria-hidden="true">
        <div className={styles.wlStack}>
          {shown.map((a) => (
            <Alert key={a.i} time={a.time} text={a.text} enter={!still} at={gone ? 'gone' : a.i < landed - 1 ? 'back' : undefined} />
          ))}
        </div>
      </div>
      <div className={styles.wlCap}>
        <Caption title={p.told.title} body={p.told.body} />
      </div>
    </div>
  );
}

/** One Curios notification; it drops in from above on the frame after it mounts. */
function Alert({ time, text, enter, at }: { time: string; text: string; enter: boolean; at?: 'back' | 'gone' }) {
  const [entering, setEntering] = useState(enter);
  useEffect(() => {
    if (!entering) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [entering]);

  return (
    <div className={styles.wlAlert} data-at={entering ? 'enter' : at}>
      <span className={styles.wlIcon}>
        <CuriosIcon />
      </span>
      <span>
        <b>
          Curios <small>{time}</small>
        </b>
        {text}
      </span>
    </div>
  );
}

function Asked({ p, still, playing }: TileProps) {
  const s = useScene(BARS, p, still, playing);
  const max = p.asked[0]!.n;
  const last = p.asked.length - 1;

  return (
    <div className={`${styles.wlTile} ${styles.wlWide}`}>
      <div className={`${styles.wlVis} ${styles.wlBarsVis}`} aria-hidden="true">
        <div className={styles.wlBars}>
          {p.asked.map((bar, i) => {
            const width = s.grown[i] ? `${(bar.n / max) * 100}%` : '0';
            return (
              <div key={bar.q} className={styles.wlBar} data-miss={i === last || undefined} data-flagged={(i === last && s.flagged) || undefined}>
                <span>{bar.q}</span>
                <span className={styles.wlTrack}>
                  <i style={{ width }} />
                  {i === last && (
                    <span className={styles.wlFlag} style={{ left: width }}>
                      {p.missing}
                    </span>
                  )}
                </span>
                <em>{s.counts[i]}</em>
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.wlCap}>
        <Caption title={p.answeredAll.title} body={p.answeredAll.body} />
      </div>
    </div>
  );
}

/** Peek's eyes on blue, the app icon, as the notification shows it. */
function CuriosIcon() {
  return (
    <svg viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="var(--peek-body)" />
      <ellipse cx="10.8" cy="16" rx="4.9" ry="5.8" fill="#fff" />
      <ellipse cx="21.2" cy="16" rx="4.9" ry="5.8" fill="#fff" />
      <circle cx="11.7" cy="17.2" r="2.9" fill="var(--ink)" />
      <circle cx="22.1" cy="17.2" r="2.9" fill="var(--ink)" />
      <circle cx="12.715" cy="15.895" r="0.928" fill="#fff" />
      <circle cx="23.115" cy="15.895" r="0.928" fill="#fff" />
    </svg>
  );
}

/**
 * Peek at the laptop, turned 45°, tapping while the page answers
 * (design/brand/peek-laptop.svg, with its colours as the brand tokens).
 * Decorative; it shows only while the rows are being sorted.
 */
function PeekAtLaptop() {
  // The footer has a Peek too; the clip id stays unique.
  const clipId = `pkl-clip-${useId().replace(/:/g, '')}`;
  return (
    <span className={styles.wlPeek}>
      <svg viewBox="0 0 200 160">
        <defs>
          <clipPath id={clipId}>
            <ellipse cx="78" cy="78" rx="52" ry="48" />
          </clipPath>
        </defs>
        <ellipse cx="104" cy="148" rx="80" ry="6" fill="rgba(25,31,44,.16)" />
        <ellipse cx="58" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
        <ellipse cx="90" cy="138" rx="13" ry="8" fill="var(--peek-foot)" />
        <g className={styles.pklBob}>
          <g clipPath={`url(#${clipId})`}>
            <rect x="20" y="25" width="120" height="110" fill="var(--peek-shade)" />
            <ellipse cx="68" cy="70" rx="54" ry="48" fill="var(--peek-body)" />
          </g>
          <ellipse cx="50" cy="46" rx="9" ry="5" fill="var(--peek-shine)" transform="rotate(-30 50 46)" />
          <g className={styles.pklEyes}>
            <ellipse cx="86" cy="74" rx="10.5" ry="13" fill="#fff" />
            <ellipse cx="112" cy="73" rx="8" ry="12" fill="#fff" />
            <circle cx="90" cy="80" r="6" fill="var(--ink)" />
            <circle cx="114.5" cy="79" r="5.2" fill="var(--ink)" />
            <circle cx="92" cy="77.5" r="1.9" fill="#fff" />
            <circle cx="116" cy="76.5" r="1.7" fill="#fff" />
          </g>
          <path d="M104 98q4 3 8-.5" fill="none" stroke="var(--ink)" strokeWidth="2.8" strokeLinecap="round" />
        </g>
        {/* The screen, facing Peek. */}
        <g transform="matrix(.5 .32 .19 1 142 50)">
          <rect x="0" y="0" width="56" height="54" rx="4" fill="var(--ink)" />
          <rect x="3" y="3" width="50" height="46" rx="2" fill="#eef2fb" />
          {/* The lines appear one after another, half a second apart. */}
          <rect className={styles.pklLine} x="7" y="8" width="26" height="6" rx="3" fill="#c9d3ee" />
          <rect className={styles.pklLine} style={{ animationDelay: '.5s' }} x="20" y="18" width="29" height="6" rx="3" fill="var(--peek-body)" />
          <rect className={styles.pklLine} style={{ animationDelay: '1s' }} x="7" y="28" width="34" height="6" rx="3" fill="#c9d3ee" />
          <rect className={styles.pklLine} style={{ animationDelay: '1.5s' }} x="24" y="38" width="25" height="6" rx="3" fill="var(--peek-body)" />
        </g>
        {/* The base. */}
        <path d="M90 121L148 105L178 124L120 140Z" fill="#dfe3ea" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M90 121L120 140L120 145L90 126Z" fill="#b9bfcb" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M120 140L178 124L178 129L120 145Z" fill="#c9ced8" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
        <g fill="#aab1bf">
          <path d="M103 120l34-9.4 6 3.9-34 9.4z" />
          <path d="M111 125.2l34-9.4 6 3.9-34 9.4z" />
        </g>
        <g className={styles.pklHandL}>
          <ellipse cx="114" cy="119" rx="9" ry="8" fill="var(--peek-hand)" stroke="var(--peek-shade)" strokeWidth="1.5" />
        </g>
        <g className={styles.pklHandR}>
          <ellipse cx="137" cy="123" rx="9" ry="8" fill="var(--peek-hand)" stroke="var(--peek-shade)" strokeWidth="1.5" />
        </g>
        <g className={`${styles.pklBubble} ${styles.pklDone}`}>
          <rect x="150" y="18" width="34" height="22" rx="11" fill="#fff" stroke="var(--ink)" strokeWidth="2" />
          <path d="M159 29l4 4 8-8" fill="none" stroke="#1d6f5f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className={`${styles.pklBubble} ${styles.pklTyping}`}>
          <rect x="126" y="2" width="34" height="22" rx="11" fill="#fff" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="136" cy="13" r="2.2" fill="var(--ink)" />
          <circle cx="143" cy="13" r="2.2" fill="var(--ink)" />
          <circle cx="150" cy="13" r="2.2" fill="var(--ink)" />
        </g>
      </svg>
    </span>
  );
}
