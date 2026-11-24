'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { COPY, type LandingCopy, type LandsSay, type LandsSideCopy, type Locale } from './copy.js';
import { useReducedMotion } from './useReducedMotion.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import { pupilOffset } from '../_peek/peek-life.js';
import { cssZoom } from '../../lib/css-zoom.js';
import calm from './calm.module.css';
import styles from './lands.module.css';

export type Side = 'service' | 'products';
type LandsCopy = LandingCopy['lands'];

/** The sequence's timings in ms, from the Landing2 board's script (L2:1197–1247). */
export const TIMING = {
  fade: 700,
  poll: 400,
  who: 500,
  bubble: 400,
  typing: 1300,
  said: 1200,
  /** A card lands, and the bubble's ring stays lit this long. */
  land: 380,
  countWait: 500,
  /** The counts run 0 to n in this many steps. */
  countSteps: 20,
  countStep: 45,
  between: 780,
  hold: 4800,
  hop: 520,
} as const;

const other = (s: Side): Side => (s === 'service' ? 'products' : 'service');

/** What the stage shows: nothing yet, or everything (the still frame). */
interface View {
  who: boolean;
  bub: boolean;
  said: boolean;
  pulse: boolean;
  /** How far the counts have run, 0 to TIMING.countSteps. */
  prog: number;
}
const STILL: View = { who: true, bub: true, said: true, pulse: false, prog: TIMING.countSteps };
const BEFORE: View = { who: false, bub: false, said: false, pulse: false, prog: 0 };

/* ---------- the drawings ---------- */

/** Curios on the owner's phone: Peek's eyes on a sky square. */
function Notif() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--sky)" />
      <ellipse cx="10.8" cy="16" rx="4.9" ry="5.8" fill="white" />
      <ellipse cx="21.2" cy="16" rx="4.9" ry="5.8" fill="white" />
      <circle cx="11.7" cy="17.2" r="2.9" fill="var(--light-ink)" />
      <circle cx="22.1" cy="17.2" r="2.9" fill="var(--light-ink)" />
    </svg>
  );
}

/** Studio Hana's package: the "kafe." wordmark and its three colours. */
function Kafe() {
  return (
    <div className={`${styles.sw} ${styles.swKafe}`}>
      <span className={styles.swName}>kafe.</span>
      <span className={styles.swDots}>
        <i style={{ background: 'var(--cl-kafe-ink)' }} />
        <i style={{ background: 'var(--cl-kafe-gold)' }} />
        <i style={{ background: 'var(--calm-bg)', boxShadow: '0 0 0 1px var(--cl-kafe-ring)' }} />
      </span>
    </div>
  );
}

/** Kek Lina's cake. */
function Cake() {
  return (
    <div className={`${styles.sw} ${styles.swCake}`}>
      <svg width="84" height="70" viewBox="0 0 70 58" aria-hidden="true">
        <rect x="8" y="24" width="54" height="28" rx="6" fill="var(--cl-cake-body)" />
        <rect x="8" y="24" width="54" height="9" rx="4" fill="var(--blob-pink)" />
        <rect x="33" y="10" width="4" height="14" rx="2" fill="var(--cl-cake-candle)" />
        <ellipse cx="35" cy="8" rx="3" ry="4" fill="var(--kuning)" />
      </svg>
    </div>
  );
}

function Say({ parts }: { parts: LandsSay[] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? p : <b key={i}>{p.b}</b>))}
    </>
  );
}

/* ---------- the four cards ---------- */

function Lead({ l }: { l: LandsCopy['service']['lead'] }) {
  return (
    <div className={`${styles.cd} ${styles.lead}`}>
      <div className={styles.row}>
        <span className={styles.cap}>{l.kicker}</span>
        <span className={`${styles.cap} ${styles.mono}`}>{l.time}</span>
      </div>
      <div className={styles.per}>
        <span className={styles.av}>{l.initial}</span>
        <div>
          <p className={styles.nm}>{l.name}</p>
          <p className={styles.tel}>{l.phone}</p>
        </div>
      </div>
      <p className={styles.say}>
        <Say parts={l.say} />
      </p>
      <div className={styles.sp}>
        <span className={styles.wa}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" />
          </svg>
          {l.action}
        </span>
      </div>
    </div>
  );
}

function Order({ o }: { o: LandsCopy['products']['order'] }) {
  return (
    <div className={`${styles.cd} ${styles.lead}`}>
      <div className={styles.row}>
        <span className={styles.cap}>{o.kicker}</span>
        <span className={styles.pill}>{o.pill}</span>
      </div>
      <p className={styles.amt}>{o.amount}</p>
      <p className={`${styles.cap} ${styles.from}`}>
        {o.from}
        <span className={styles.mono}>{o.phone}</span>
      </p>
      <div className={styles.lines}>
        {o.lines.map(([l, r]) => (
          <div key={l} className={styles.ol}>
            <span>{l}</span>
            <span>{r}</span>
          </div>
        ))}
      </div>
      <p className={`${styles.cap} ${styles.sp}`}>{o.foot}</p>
    </div>
  );
}

/** One side's four cards, in the bento's order: a, b, c, d. */
function Cards({ side, d, copy, prog }: { side: Side; d: LandsSideCopy; copy: LandsCopy; prog: number }) {
  return (
    <div className={styles.bt}>
      <div className={`${styles.bx} ${styles.a}`} data-bx="">
        {side === 'service' ? <Lead l={copy.service.lead} /> : <Order o={copy.products.order} />}
      </div>
      <div className={`${styles.bx} ${styles.b}`} data-bx="">
        <div className={styles.nt}>
          <Notif />
          <div className={styles.ntT}>
            <div className={styles.row}>
              <b>Curios</b>
              <span className={styles.cap}>{copy.now}</span>
            </div>
            <p>{d.notice.text}</p>
          </div>
        </div>
        <p className={`${styles.cap} ${styles.ntS}`}>{d.notice.caption}</p>
      </div>
      <div className={`${styles.bx} ${styles.c}`} data-bx="">
        <div className={`${styles.cd} ${styles.pkg}`}>
          {side === 'service' ? <Kafe /> : <Cake />}
          <div className={styles.pkgB}>
            <div>
              <span className={styles.cap}>{copy.suggested}</span>
              <b>{d.pick.name}</b>
            </div>
            <span>{d.pick.price}</span>
          </div>
        </div>
      </div>
      <div className={`${styles.bx} ${styles.d}`} data-bx="counts">
        <div className={`${styles.cd} ${styles.qs}`}>
          <div className={`${styles.row} ${styles.qsHead}`}>
            <span className={styles.cap}>{copy.countsTitle}</span>
            <span className={styles.cap}>{copy.times}</span>
          </div>
          {d.asked.map((a) =>
            a.miss ? (
              <div key={a.q} className={`${styles.qr} ${styles.miss}`}>
                “{a.q}”<span>{d.missTag}</span>
              </div>
            ) : (
              <div key={a.q} className={styles.qr}>
                <span>“{a.q}”</span>
                <em>{Math.round(((a.n ?? 0) * prog) / TIMING.countSteps)}</em>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- the section ---------- */

/**
 * What lands in your hands (Landing2 board, 24 Nov): someone asks a page a
 * question, and four things land: a lead or a paid order, the alert, the one
 * package or product the chat suggested, and what people keep asking. A
 * toggle picks the side (a service, or products); the sides take turns on
 * their own, and keep taking turns after a visitor picks one. Reduced motion
 * shows every card at once, on the side picked, with nothing to replay.
 */
export function Lands({ locale }: { locale: Locale }) {
  const copy = COPY[locale].lands;
  const reduced = useReducedMotion();
  const [active, setActive] = useState<Side>('service');
  const [side, setSide] = useState<Side>('service');
  const [pass, setPass] = useState(0);
  const [fading, setFading] = useState(false);
  const [play, setPlay] = useState(false);
  const [v, setV] = useState<View>(STILL);
  const d = copy[side];

  const stage = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLParagraphElement>(null);
  const peek = useRef<LivePeekHandle>(null);
  const inView = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const runner = useRef<((to: Side) => void) | null>(null);

  /* Is the stage on screen? Where nothing can tell, it is. */
  useEffect(() => {
    const el = stage.current;
    if (reduced || !el) return;
    if (typeof window.IntersectionObserver !== 'function') {
      inView.current = true;
      return;
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) inView.current = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  /* The sequence. A new run (a click, Play again, or the sides taking turns) stops the one before it. */
  useEffect(() => {
    if (reduced) {
      runner.current = null;
      setPlay(false);
      setFading(false);
      setV(STILL);
      return;
    }
    let gen = 0;
    let current: Side = 'service';
    const timers = new Set<number>();
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => {
          timers.delete(id);
          resolve();
        }, ms);
        timers.add(id);
      });
    const chk = (g: number) => {
      if (g !== gen) throw new Error('stopped');
    };
    const set = (patch: Partial<View>) => setV((prev) => ({ ...prev, ...patch }));
    /** Peek's pupils toward an element. */
    const aim = (el: Element | null) => {
      const pk = peek.current?.el();
      if (!pk || !el) return;
      const r = pk.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      peek.current?.look(pupilOffset(b.left + b.width / 2 - (r.left + r.width / 2), b.top + b.height / 2 - (r.top + r.height * 0.55)));
    };
    /** A card flies out of the bubble's centre: from scale .35 and clear, to its place. */
    const fly = (el: HTMLElement) => {
      const bub = bubble.current;
      if (!bub) return;
      const z = cssZoom(stage.current);
      const B = bub.getBoundingClientRect();
      const R = el.getBoundingClientRect();
      const dx = (B.left + B.width / 2 - (R.left + R.width / 2)) / z;
      const dy = (B.top + B.height / 2 - (R.top + R.height / 2)) / z;
      el.classList.remove(styles.go!);
      el.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(.35)`;
      el.style.opacity = '0';
      void el.offsetWidth;
      el.classList.add(styles.go!);
      el.style.transform = 'none';
      el.style.opacity = '1';
    };

    /** Stops the run in flight: its waits never resolve. */
    const halt = () => {
      gen++;
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
    /** Is a visitor's keyboard focus inside the section? Then the sides do not move under them. */
    const focused = () => !!root.current && root.current.contains(document.activeElement);

    const run = async (to: Side) => {
      halt();
      const g = ++gen;
      current = to;
      try {
        setActive(to);
        setFading(true);
        await sleep(TIMING.fade);
        chk(g);
        flushSync(() => {
          setSide(to);
          setPass((n) => n + 1);
          setPlay(true);
          setV(BEFORE);
          setFading(false);
        });
        peek.current?.look(null);
        const boxes = [...(stage.current?.querySelectorAll<HTMLElement>('[data-bx]') ?? [])];
        while (!inView.current || document.hidden) {
          await sleep(TIMING.poll);
          chk(g);
        }
        await sleep(TIMING.who);
        chk(g);
        set({ who: true });
        await sleep(TIMING.bubble);
        chk(g);
        set({ bub: true });
        aim(bubble.current);
        await sleep(TIMING.typing);
        chk(g);
        set({ said: true });
        await sleep(TIMING.said);
        chk(g);
        for (const box of boxes) {
          set({ pulse: true });
          fly(box);
          aim(box);
          await sleep(TIMING.land);
          chk(g);
          set({ pulse: false });
          if (box.dataset.bx === 'counts') {
            await sleep(TIMING.countWait);
            chk(g);
            for (let s = 0; s <= TIMING.countSteps; s++) {
              set({ prog: s });
              await sleep(TIMING.countStep);
              chk(g);
            }
          }
          await sleep(TIMING.between);
          chk(g);
        }
        peek.current?.mood('hop', TIMING.hop);
        peek.current?.look(null);
        await sleep(TIMING.hold);
        chk(g);
        while (focused() || document.hidden) {
          await sleep(TIMING.poll);
          chk(g);
        }
        void run(other(to));
      } catch {
        /* stopped: a newer run took over */
      }
    };

    /* A hidden tab pauses the run; a visible one starts the side it was on again. */
    const onVisibility = () => {
      if (document.hidden) halt();
      else void run(current);
    };
    document.addEventListener('visibilitychange', onVisibility);

    runner.current = (to) => void run(to);
    void run('service');
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      runner.current = null;
      halt();
    };
  }, [reduced]);

  const pick = (to: Side) => {
    if (reduced) {
      setActive(to);
      setSide(to);
      return;
    }
    runner.current?.(to);
  };

  /* The toggle's thumb, sized to the side that is on. */
  const tog = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const move = () => {
      const on = tog.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (on) setThumb({ width: on.offsetWidth, transform: `translateX(${on.offsetLeft - 4}px)` });
    };
    move();
    window.addEventListener('resize', move);
    return () => window.removeEventListener('resize', move);
  }, [active, locale]);

  return (
    <div ref={root} className={styles.wl}>
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
            <button key={x} type="button" aria-pressed={active === x} onClick={() => pick(x)}>
              {copy[x].label}
            </button>
          ))}
        </div>
      </div>
      <div className={calm.rv} data-rv="" style={{ '--d': '220ms' } as CSSProperties}>
        <div ref={stage} className={styles.st} data-side={side} data-play={play ? '' : undefined}>
          <span className={styles.pk}>
            <LivePeek width={96} ref={peek} />
          </span>
          <div className={styles.fd} data-out={fading ? '' : undefined}>
            <div key={`${side}-${pass}`}>
              <div className={styles.ask}>
                <p className={styles.who} data-in={v.who ? '' : undefined}>
                  {d.who}
                </p>
                <p ref={bubble} className={styles.bub} data-in={v.bub ? '' : undefined} data-said={v.said ? '' : undefined} data-pulse={v.pulse ? '' : undefined}>
                  <span className={styles.qd} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className={styles.qt} aria-hidden="true">
                    {d.question}
                  </span>
                  <span className={calm.srOnly}>{d.question}</span>
                </p>
              </div>
              <Cards side={side} d={d} copy={copy} prog={v.prog} />
            </div>
          </div>
        </div>
        {reduced ? null : (
          <div className={styles.rp}>
            <button type="button" onClick={() => runner.current?.(active)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
              </svg>
              {copy.replay}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
