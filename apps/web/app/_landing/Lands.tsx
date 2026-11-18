'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { COPY, type LandsCheckoutCopy, type LandsSideCopy, type Locale } from './copy.js';
import { shopCopy } from '../[handle]/shop/copy.js';
import { CHECKOUT_START, LandsCheckout, type CheckoutState } from './LandsCheckout.js';
import { nextSide, TIMING, type LandsCard, type Side } from './lands-script.js';
import { PERSONAS, SWATCHES } from './personas.js';
import { photo } from './photos.js';
import { useScene, type Scene, type Wait } from './scene.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import { pupilOffset } from '../_peek/peek-life.js';
import calm from './calm.module.css';
import styles from './lands.module.css';

const OWNER: Record<Side, (typeof PERSONAS)['hana']> = { service: PERSONAS.hana, products: PERSONAS.lina };

interface CardState {
  card: LandsCard;
  pressed: boolean;
  done: boolean;
}

export interface Msg {
  id: number;
  r: 'v' | 'p';
  text: string;
  dots?: boolean;
  cards?: CardState[];
  capture?: { typed: string; typing: boolean; pressed: boolean; ok: boolean };
}

export interface LandsState {
  side: Side;
  msgs: Msg[];
  /** The ask bar: what is being typed, or null for the placeholder. */
  input: string | null;
  sendPressed: boolean;
  step: number;
  zones: [boolean, boolean, boolean, boolean];
  /** The connector into a zone, solid once it has landed. */
  dot: number | null;
  pop: number | null;
  picked: number | null;
  bump: number;
  basket: boolean;
  basketPressed: boolean;
  ck: CheckoutState;
  hop: number;
  cheer: number;
}

export interface LandsProps {
  cursor: { side: Side; user: boolean };
  sides: Record<Side, LandsSideCopy>;
  checkout: LandsCheckoutCopy;
}

const ALL_IN: LandsState['zones'] = [true, true, true, true];
const NONE_IN: LandsState['zones'] = [false, false, false, false];

function empty(side: Side): LandsState {
  return {
    side,
    msgs: [],
    input: null,
    sendPressed: false,
    step: -1,
    zones: NONE_IN,
    dot: null,
    pop: null,
    picked: null,
    bump: 0,
    basket: false,
    basketPressed: false,
    ck: CHECKOUT_START,
    hop: 0,
    cheer: 0,
  };
}

/** A side's finished frame: every line of the chat, all four zones in (L2:1146). */
export function finished(side: Side, d: LandsSideCopy): LandsState {
  let id = 0;
  const msgs: Msg[] = d.chat.flatMap((m) => (m.r === 'v' || m.r === 'p' ? [{ id: id++, r: m.r, text: m.t }] : []));
  const done = { ...empty(side), msgs, zones: ALL_IN, step: d.steps.length - 1 };
  // The products side ends on the paid screen, the cake bought (plan, Task 9).
  return side === 'products' ? { ...done, ck: { ...CHECKOUT_START, screen: 'paid' } } : done;
}

type Set = (s: LandsState | ((prev: LandsState) => LandsState)) => void;

/** Updates the last message. */
const lastMsg = (s: LandsState, f: (m: Msg) => Msg): LandsState => ({ ...s, msgs: s.msgs.map((m, i) => (i === s.msgs.length - 1 ? f(m) : m)) });

async function land(z: number, set: Set, wait: Wait) {
  set((s) => ({ ...s, dot: z }));
  await wait(TIMING.dot);
  set((s) => {
    const zones = [...s.zones] as LandsState['zones'];
    zones[z] = true;
    return { ...s, dot: null, zones, pop: z, hop: s.hop + 1 };
  });
  if (z === 3) {
    await wait(TIMING.bump);
    set((s) => ({ ...s, bump: s.bump + 1 }));
  }
}

/** One side's chat, played (Landing2 board, L2:1131–1165). */
const ck = (set: Set, f: (c: CheckoutState) => Partial<CheckoutState>) => set((s) => ({ ...s, ck: { ...s.ck, ...f(s.ck) } }));

async function press(set: Set, wait: Wait, on: (s: LandsState, v: boolean) => LandsState, ms: number) {
  set((s) => on(s, true));
  await wait(ms);
  set((s) => on(s, false));
}

/** Adds card `i` to the basket, then the basket bar rises. */
async function add(i: number, set: Set, wait: Wait) {
  const card = (s: LandsState, f: (c: CardState) => CardState): LandsState => {
    let n = -1;
    return {
      ...s,
      msgs: s.msgs.map((m) => (m.cards ? { ...m, cards: m.cards.map((c) => (++n === i ? f(c) : c)) } : m)),
    };
  };
  await wait(TIMING.addWait);
  await press(set, wait, (s, v) => card(s, (c) => ({ ...c, pressed: v })), TIMING.addPress);
  set((s) => card(s, (c) => ({ ...c, done: true })));
  await wait(TIMING.basketIn);
  set((s) => ({ ...s, basket: true }));
  await wait(TIMING.basketHold);
}

async function type(field: 'name' | 'phone', text: string, set: Set, wait: Wait) {
  for (let i = 1; i <= text.length; i++) {
    const v = text.slice(0, i);
    ck(set, () => ({ typing: field, [field]: v }));
    await wait(TIMING.fieldChar);
  }
  ck(set, () => ({ typing: null }));
  await wait(TIMING.fieldGap);
}

async function scrollTo(at: CheckoutState['at'], set: Set, wait: Wait) {
  ck(set, () => ({ at }));
  await wait(TIMING.scroll);
}

/** Checkout inside the phone: pickup, Saturday, Aida and her number (L2:1171–1174). */
async function checkout(buyer: LandsCheckoutCopy['buyer'], set: Set, wait: Wait) {
  await press(set, wait, (s, v) => ({ ...s, basketPressed: v }), TIMING.addPress);
  await wait(TIMING.toCheckout);
  ck(set, () => ({ screen: 'checkout' }));
  await wait(TIMING.sheetIn);
  await scrollTo('get', set, wait);
  ck(set, () => ({ pickup: true }));
  await wait(TIMING.select);
  await scrollTo('day', set, wait);
  ck(set, () => ({ day: true }));
  await wait(TIMING.select);
  await scrollTo('you', set, wait);
  await type('name', buyer.name, set, wait);
  await type('phone', buyer.phone, set, wait);
}

/** Pays by FPX with Maybank2u, then the paid screen (L2:1175–1180). */
async function pay(set: Set, wait: Wait) {
  await scrollTo('pay', set, wait);
  ck(set, () => ({ fpx: true }));
  await wait(TIMING.banksIn);
  ck(set, () => ({ bank: true }));
  await wait(TIMING.select);
  await scrollTo('sum', set, wait);
  await wait(300);
  ck(set, () => ({ pressed: true }));
  await wait(TIMING.payPress);
  ck(set, () => ({ pressed: false, paying: true }));
  await wait(TIMING.paying);
  ck(set, () => ({ screen: 'paid' }));
  await wait(TIMING.paidHold);
}

export async function runSide(side: Side, d: LandsSideCopy, set: Set, wait: Wait, buyer: LandsCheckoutCopy['buyer']) {
  let id = 0;
  await wait(TIMING.start);
  for (const m of d.chat) {
    if (m.step != null) {
      const step = m.step;
      set((s) => ({ ...s, step }));
    }
    if (m.r === 'v') {
      for (let i = 1; i <= m.t.length; i++) {
        const input = m.t.slice(0, i);
        set((s) => ({ ...s, input }));
        await wait(TIMING.typeChar);
      }
      await wait(TIMING.beforeSend);
      set((s) => ({ ...s, sendPressed: true }));
      await wait(TIMING.press);
      const msg: Msg = { id: id++, r: 'v', text: m.t };
      set((s) => ({ ...s, sendPressed: false, input: null, msgs: [...s.msgs, msg] }));
      await wait(TIMING.afterVisitor);
      if (m.pick != null) {
        const picked = m.pick;
        set((s) => ({ ...s, picked }));
        await wait(TIMING.pickHold);
      }
    } else if (m.r === 'p') {
      const msg: Msg = { id: id++, r: 'p', text: '', dots: true };
      set((s) => ({ ...s, msgs: [...s.msgs, msg] }));
      await wait(TIMING.dots);
      const words = m.t.split(' ');
      for (let i = 1; i <= words.length; i++) {
        const text = words.slice(0, i).join(' ');
        set((s) => lastMsg(s, (x) => ({ ...x, dots: false, text })));
        await wait(TIMING.word);
      }
      if (m.cards) {
        const cards = m.cards.map((card) => ({ card, pressed: false, done: false }));
        set((s) => lastMsg(s, (x) => ({ ...x, cards })));
        await wait(TIMING.cardsHold);
      }
      if (m.capture) {
        await wait(TIMING.captureIn);
        set((s) => lastMsg(s, (x) => ({ ...x, capture: { typed: '', typing: false, pressed: false, ok: false } })));
        await wait(TIMING.captureWait);
        for (let i = 1; i <= m.capture.length; i++) {
          const typed = m.capture.slice(0, i);
          set((s) => lastMsg(s, (x) => ({ ...x, capture: { ...x.capture!, typed, typing: true } })));
          await wait(TIMING.captureChar);
        }
        set((s) => lastMsg(s, (x) => ({ ...x, capture: { ...x.capture!, typing: false } })));
        await wait(TIMING.captureBeforeSend);
        set((s) => lastMsg(s, (x) => ({ ...x, capture: { ...x.capture!, pressed: true } })));
        await wait(TIMING.capturePress);
        set((s) => lastMsg(s, (x) => ({ ...x, capture: { ...x.capture!, pressed: false } })));
        await wait(TIMING.captureAfterPress);
        set((s) => lastMsg(s, (x) => ({ ...x, capture: { ...x.capture!, ok: true } })));
        await wait(TIMING.captureSent);
      }
      await wait(TIMING.afterPage);
    } else if (m.r === 'add') {
      await add(m.i, set, wait);
    } else if (m.r === 'checkout') {
      await checkout(buyer, set, wait);
    } else if (m.r === 'pay') {
      await pay(set, wait);
    }
    if ('land' in m && m.land) {
      for (const z of m.land) {
        await land(z, set, wait);
        await wait(TIMING.betweenLands);
      }
    }
  }
  set((s) => ({ ...s, cheer: s.cheer + 1 }));
  await wait(TIMING.hold);
}

export const landsScene: Scene<LandsState, LandsProps> = {
  still: (p) => finished(p.cursor.side, p.sides[p.cursor.side]),
  start: (p) => empty(p.cursor.side),
  async run(p, set, wait) {
    const side = p.cursor.side;
    set(empty(side));
    await runSide(side, p.sides[side], set, wait, p.checkout.buyer);
    const next = nextSide(side, p.cursor.user);
    p.cursor.side = next;
    set((s) => ({ ...s, side: next }));
  },
};

/* ---------- the zones' contents ---------- */

function Swatch({ k }: { k: string }) {
  return <u className={styles.sw} style={{ background: SWATCHES[k] }} />;
}

function Zone0({ d }: { d: LandsSideCopy }) {
  const f = d.first;
  let i = 0;
  return (
    <div className={styles.zl}>
      <div className={`${styles.st} ${styles.zlt}`} style={{ '--i': i++ } as CSSProperties}>
        <span>{f.title}</span>
        <span className={styles.zpill} data-tone={f.tone}>
          {f.tag}
        </span>
      </div>
      <p className={`${styles.st} ${styles.zln}`} style={{ '--i': i++ } as CSSProperties}>
        {f.big}
      </p>
      {f.kv ? (
        <div className={styles.kv}>
          {f.kv.map(([k, v]) => (
            <span key={k} className={styles.st} style={{ '--i': i++ } as CSSProperties}>
              <small>{k}</small>
              {v}
            </span>
          ))}
        </div>
      ) : null}
      {f.lines?.map(([l, r]) => (
        <div key={l} className={`${styles.st} ${styles.ol}`} style={{ '--i': i++ } as CSSProperties}>
          <span>{l}</span>
          <b>{r}</b>
        </div>
      ))}
      <span className={`${styles.st} ${styles.zwa}`} style={{ '--i': i++ } as CSSProperties}>
        {f.action}
      </span>
    </div>
  );
}

function Zone1({ d, picked }: { d: LandsSideCopy; picked: number | null }) {
  return (
    <div className={styles.sug}>
      {d.suggested.map((c, i) => (
        <div key={c.name} className={styles.st} style={{ '--i': i } as CSSProperties} data-pick={picked === i ? '' : undefined}>
          <Swatch k={c.swatch} />
          <b>{c.name}</b>
          <small>{c.price}</small>
        </div>
      ))}
    </div>
  );
}

function Ping() {
  return (
    <svg className={styles.pngI} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--biru)" />
      <ellipse cx="10.8" cy="16" rx="4.9" ry="5.8" fill="white" />
      <ellipse cx="21.2" cy="16" rx="4.9" ry="5.8" fill="white" />
      <circle cx="11.7" cy="17.2" r="2.9" fill="var(--light-ink)" />
      <circle cx="22.1" cy="17.2" r="2.9" fill="var(--light-ink)" />
    </svg>
  );
}

function Zone2({ d }: { d: LandsSideCopy }) {
  return (
    <>
      <div className={styles.png}>
        <Ping />
        <div className={styles.pngT}>
          <div className={styles.st} style={{ '--i': 0 } as CSSProperties}>
            <b>{d.ping.from}</b>
            <span>{d.ping.when}</span>
          </div>
          <p className={styles.st} style={{ '--i': 1 } as CSSProperties}>
            {d.ping.text}
          </p>
        </div>
      </div>
      <div className={`${styles.st} ${styles.pngO}`} style={{ '--i': 2 } as CSSProperties}>
        {d.ping.foot}
      </div>
    </>
  );
}

function Zone3({ d, bump }: { d: LandsSideCopy; bump: number }) {
  const max = Math.max(...d.asked.map((a) => a.n)) + 1;
  return (
    <div className={styles.qs}>
      {d.asked.map((a, i) => (
        <div
          key={a.q}
          className={`${styles.qr} ${styles.st}`}
          data-me={a.me ? '' : undefined}
          data-miss={a.miss ? '' : undefined}
          style={{ '--i': i, '--w': `${Math.round((a.n / max) * 100)}%` } as CSSProperties}
        >
          <p>“{a.q}”</p>
          <em key={a.me ? bump : 0} data-bump={a.me && bump > 0 ? '' : undefined}>
            {a.n + (a.me ? bump : 0)}
          </em>
          <i />
          {a.miss ? <span className={styles.tagm}>{d.missTag}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* ---------- the chat ---------- */

function Chat({
  s,
  d,
  side,
  sentName,
  capture,
  basket,
  transcript,
  children,
}: {
  s: LandsState;
  d: LandsSideCopy;
  side: Side;
  sentName: string;
  capture: (typeof COPY)['en']['lands']['capture'];
  basket: { text: string; go: string };
  transcript: { label: string; visitor: string };
  children?: ReactNode;
}) {
  const owner = OWNER[side];
  return (
    <div className={styles.chat}>
      <div className={styles.lch}>
        {owner.face || owner.photo ? (
          <img
            className={styles.av}
            {...photo(owner.face ?? owner.photo!.src, 80)}
            alt={owner.name}
            style={{ objectPosition: owner.photo?.focus }}
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div>
          <b style={{ fontFamily: owner.font }}>{owner.name}</b>
          <small>curios.my/{owner.handle}</small>
        </div>
      </div>
      {/* Read once, finished: the playing chat rewrites its last line every few ms. */}
      <ol className={calm.srOnly} aria-label={transcript.label}>
        {finished(side, d).msgs.map((m) => (
          <li key={m.id}>
            {m.r === 'v' ? transcript.visitor : d.who}: {m.text}
          </li>
        ))}
      </ol>
      <div className={styles.lcm} aria-hidden="true">
        {s.msgs.map((m) =>
          m.r === 'v' ? (
            <div key={m.id} className={`${styles.lm} ${styles.v}`}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`${styles.lm} ${styles.p}`} data-who={d.who} data-wide={m.cards || m.capture ? '' : undefined}>
              {m.dots ? (
                <span className={calm.tdots}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <div>{m.text}</div>
              )}
              {m.cards?.map((c) => (
                <div key={c.card.name} className={styles.lpc}>
                  <Swatch k={c.card.swatch} />
                  <span className={styles.lpcT}>
                    <b>{c.card.name}</b>
                    <span>{c.card.price}</span>
                  </span>
                  <span className={styles.lpcB} data-press={c.pressed ? '' : undefined} data-in={c.done ? '' : undefined}>
                    {c.done ? d.cardDone : d.cardButton}
                  </span>
                </div>
              ))}
              {m.capture ? (
                m.capture.ok ? (
                  <div className={`${styles.lcap} ${styles.ok}`}>{capture.sent(sentName)}</div>
                ) : (
                  <div className={styles.lcap}>
                    <p className={styles.lcapL}>{capture.ask(sentName)}</p>
                    <p className={styles.lcapC}>{capture.why(sentName)}</p>
                    <small>{capture.label}</small>
                    <span className={styles.lcapF} data-ty={m.capture.typing ? '' : undefined}>
                      {m.capture.typed}
                    </span>
                    <span className={styles.lcapB} data-press={m.capture.pressed ? '' : undefined}>
                      {capture.send}
                    </span>
                  </div>
                )
              ) : null}
            </div>
          ),
        )}
      </div>
      <div className={styles.lbask} data-in={s.basket ? '' : undefined} aria-hidden={!s.basket || undefined}>
        <span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 8h14l-1.4 11H6.4zM9 8a3 3 0 0 1 6 0" />
          </svg>
          <b>{basket.text}</b>
        </span>
        <em data-press={s.basketPressed ? '' : undefined}>{basket.go}</em>
      </div>
      <div className={styles.lcIn} data-ty={s.input !== null ? '' : undefined}>
        <span>{s.input ?? d.placeholder}</span>
        <i data-press={s.sendPressed ? '' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </i>
      </div>
      {children}
    </div>
  );
}

/* ---------- the section ---------- */

/**
 * What lands in your hands (Landing2 board): one chat on a page, and the four
 * things it leaves the owner, landing in their zones as the chat goes. A
 * toggle picks the side (a service, or products); left alone the sides take
 * turns. The server, and reduced motion, show the service side finished.
 */
export function Lands({ locale }: { locale: Locale }) {
  const copy = COPY[locale].lands;
  const shop = shopCopy(locale);
  const sides = { service: copy.service, products: copy.products };
  const cursor = useRef<LandsProps['cursor']>({ side: 'service', user: false });
  const [jump, setJump] = useState(0);
  const band = useRef<HTMLDivElement>(null);
  const [sideKey, setSideKey] = useState<Side>('service');
  const s = useScene(landsScene, { cursor: cursor.current, sides, checkout: copy.checkout }, band, `${jump}-${sideKey}`);
  const side = s.side;
  const d = sides[side];
  const owner = OWNER[side];

  // A run that ends moves the side on; restart the scene for it.
  useEffect(() => {
    if (s.side !== sideKey) setSideKey(s.side);
  }, [s.side, sideKey]);

  const pick = (to: Side) => {
    if (to === cursor.current.side && to === side) return;
    cursor.current = { side: to, user: true };
    setSideKey(to);
    setJump((n) => n + 1);
  };

  /* The toggle's thumb, sized to the side that is on. */
  const tog = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const on = tog.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (on) setThumb({ width: on.offsetWidth, transform: `translateX(${on.offsetLeft - 4}px)` });
  }, [side, locale]);

  /* The connectors from the chat to each zone. */
  const chatRef = useRef<HTMLDivElement>(null);
  const zoneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [geo, setGeo] = useState<{ box: string; d: string[] } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const L = band.current?.getBoundingClientRect();
      const C = chatRef.current?.getBoundingClientRect();
      if (!L || !C || !L.width) return;
      const ds = zoneRefs.current.map((z, i) => {
        const b = z?.getBoundingClientRect();
        if (!b) return '';
        const left = i % 2 === 0;
        const sx = (left ? C.left : C.right) - L.left;
        const sy = C.top - L.top + C.height * (i < 2 ? 0.34 : 0.66);
        const ex = (left ? b.right : b.left) - L.left;
        const ey = b.top - L.top + b.height / 2;
        const dx = (left ? -1 : 1) * Math.max(26, Math.abs(ex - sx) * 0.5);
        return `M${sx.toFixed(1)} ${sy.toFixed(1)} C${(sx + dx).toFixed(1)} ${sy.toFixed(1)} ${(ex - dx).toFixed(1)} ${ey.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      });
      setGeo({ box: `0 0 ${L.width} ${L.height}`, d: ds });
    };
    measure();
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener('resize', measure);
  }, [side]);

  /* The dot travelling a connector, and Peek looking where it lands. */
  const dotRef = useRef<HTMLSpanElement>(null);
  const peek = useRef<LivePeekHandle>(null);
  useEffect(() => {
    if (s.dot === null) return;
    const path = geo?.d[s.dot];
    const dot = dotRef.current;
    if (dot && path && typeof dot.animate === 'function') {
      dot.style.offsetPath = `path('${path}')`;
      dot.animate([{ offsetDistance: '0%', opacity: 1 }, { offsetDistance: '100%', opacity: 1 }], { duration: TIMING.dot, easing: 'cubic-bezier(.5,0,.3,1)' });
    }
    const el = peek.current?.el();
    const zone = zoneRefs.current[s.dot];
    if (el && zone) {
      const r = el.getBoundingClientRect();
      const b = zone.getBoundingClientRect();
      peek.current?.look(pupilOffset(b.left + b.width / 2 - (r.left + r.width / 2), b.top + b.height / 2 - (r.top + r.height * 0.55)));
    }
  }, [s.dot, geo]);
  useEffect(() => {
    if (s.hop > 0) peek.current?.mood('hop', 520);
  }, [s.hop]);
  useEffect(() => {
    if (s.cheer > 0) peek.current?.mood('happy', TIMING.endHappy);
  }, [s.cheer]);

  const zoneBody = [<Zone0 key={0} d={d} />, <Zone1 key={1} d={d} picked={s.picked} />, <Zone2 key={2} d={d} />, <Zone3 key={3} d={d} bump={s.bump} />];

  return (
    <div className={styles.wl}>
      <h2 className={`${calm.h2} ${calm.rv}`} data-rv="">
        {copy.title}
      </h2>
      <p className={`${calm.s2} ${calm.rv}`} data-rv="" style={{ '--d': '100ms' } as CSSProperties}>
        {copy.lede}
      </p>
      <div className={calm.rv} data-rv="" style={{ '--d': '160ms' } as CSSProperties}>
        <div ref={tog} className={styles.tog} role="group" aria-label={copy.switchLabel}>
          <span className={styles.th} style={thumb} aria-hidden="true" />
          {(['service', 'products'] as const).map((x) => (
            <button key={x} type="button" aria-pressed={side === x} onClick={() => pick(x)}>
              {sides[x].label}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={band}
        className={`${styles.ld} ${calm.rv}`}
        data-rv=""
        data-side={side}
        style={{ '--d': '220ms', '--la': owner.accent, '--ldt': owner.tint, '--pd': owner.deep } as CSSProperties}
      >
        <svg className={styles.ln} viewBox={geo?.box} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={geo?.d[i] ?? ''} data-on={s.zones[i] ? '' : undefined} />
          ))}
        </svg>
        <span ref={dotRef} className={styles.dot} data-run={s.dot !== null ? '' : undefined} aria-hidden="true" />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={`${side}-${i}`}
            ref={(el) => {
              zoneRefs.current[i] = el;
            }}
            className={`${styles.lz} ${styles[`z${i}`]}`}
            data-in={s.zones[i] ? '' : undefined}
            data-pop={s.pop === i ? '' : undefined}
          >
            <p className={styles.lzk}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <b>{d.keys[i]}</b>
            </p>
            <div className={styles.lzb}>
              <span className={styles.lze}>{copy.empty}</span>
              <div className={styles.lzc} aria-hidden={!s.zones[i] || undefined}>
                {zoneBody[i]}
              </div>
            </div>
          </div>
        ))}
        <div className={styles.cw}>
          <span className={styles.pk}>
            <LivePeek width={82} ref={peek} />
          </span>
          <div ref={chatRef}>
            <Chat
              s={s}
              d={d}
              side={side}
              sentName={owner.name}
              capture={copy.capture}
              basket={{ text: shop.barText(1, copy.checkout.price), go: shop.checkout }}
              transcript={{ label: copy.transcript, visitor: copy.visitor }}
            >
              {side === 'products' ? <LandsCheckout shop={shop} copy={copy.checkout} state={s.ck} owner={owner.name} /> : null}
            </Chat>
          </div>
          <div className={styles.lsteps}>
            {d.steps.map((step, i) => (
              <span key={step} data-state={i < s.step ? 'done' : i === s.step ? 'on' : undefined}>
                <i>{i + 1}</i>
                {step}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
