'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../_landing/useReducedMotion.js';
import { PERSONAS } from '../_landing/personas.js';
import styles from './film.module.css';

/** One frame of the sky: its colours, where the moon or sun sits, and whether the stars are out. */
interface Sky {
  bg: string;
  fg: string;
  soft: string;
  orbX: string;
  orbY: string;
  glow: string;
  night: boolean;
  sunA: string;
  sunB: string;
}

interface Scene {
  time: string;
  meridiem: 'am' | 'pm';
  caption: string;
  sky: Sky;
  screen: ReactNode;
}

const NIGHT: Sky = { bg: '#141a2e', fg: 'var(--paper)', soft: 'var(--l-ink-300)', orbX: '18%', orbY: '16%', glow: 'rgb(232 236 247 / 28%)', night: true, sunA: '#ffd45c', sunB: '#f7b733' };
const day = (bg: string, orbX: string, orbY: string, glow = 'rgb(255 200 90 / 42%)', sunA = '#ffd45c', sunB = '#f7b733'): Sky => ({
  bg, fg: 'var(--ink)', soft: 'var(--ink-soft)', orbX, orbY, glow, night: false, sunA, sunB,
});

const lina = PERSONAS.lina;
const aisyah = PERSONAS.aisyah;

function Chat({ persona, lines, tag }: { persona: typeof lina; lines: [string, string, string]; tag: string }) {
  return (
    <div className={styles.scr} style={{ background: persona.deep, color: 'var(--paper)' }}>
      <p className={styles.scrHead}>
        {persona.face || persona.photo ? (
          <img src={persona.face ?? persona.photo!.src} alt="" style={{ objectPosition: persona.face ? '50% 50%' : persona.photo!.focus }} />
        ) : null}
        <span>
          <b>{persona.name}</b>
          <span>curios.my/{persona.handle}</span>
        </span>
      </p>
      <span className={`${styles.bq} ${styles.enter} ${styles.d1}`}>{lines[0]}</span>
      <span className={`${styles.ba} ${styles.enter} ${styles.d2}`} style={{ background: persona.warm }}>
        {lines[1]}
      </span>
      <span className={`${styles.bq} ${styles.enter} ${styles.d3}`}>{lines[2]}</span>
      <span className={`${styles.tag} ${styles.enter} ${styles.d4}`}>{tag}</span>
    </div>
  );
}

function Lock({ date, time, photo, children }: { date: string; time: string; photo?: { src: string; focus: string }; children: ReactNode }) {
  return (
    <div className={`${styles.scr} ${styles.lock}`}>
      {photo ? <img className={styles.lockBg} src={photo.src} alt="" style={{ objectPosition: photo.focus }} /> : null}
      <p className={styles.lockDate}>{date}</p>
      <p className={styles.lockTime}>{time}</p>
      {children}
    </div>
  );
}

function Note({ title, body, delay }: { title: string; body: string; delay?: string }) {
  return (
    <div className={`${styles.note} ${styles.enter} ${delay}`}>
      <span className={styles.noteIcon}>c</span>
      <span>
        <span className={styles.noteTop}>
          <b>Curios</b>
          <span>now</span>
        </span>
        <span className={styles.noteBody}>
          <b>{title}</b>
          <br />
          {body}
        </span>
      </span>
    </div>
  );
}

function Leads({ who, when, need, phone, other, otherNote, tint }: { who: string; when: string; need: string; phone: string; other: string; otherNote: string; tint: string }) {
  return (
    <div className={styles.scr} style={{ background: 'var(--tj-grey-50)', color: 'var(--ink)' }}>
      <p className={styles.scrTitle}>Leads</p>
      <div className={`${styles.card} ${styles.enter} ${styles.d1}`}>
        <p className={styles.cardRow}>
          <span className={styles.av} style={{ background: tint }}>
            {who.charAt(0)}
          </span>
          <span>
            <b>{who}</b>
            <span>{when}</span>
          </span>
          <span className={styles.newTag}>New</span>
        </p>
        <p className={styles.cardText}>
          {need}
          <br />
          <b>{phone}</b> · whole chat attached
        </p>
        <span className={styles.cardBtn}>WhatsApp them</span>
      </div>
      <div className={`${styles.card} ${styles.dim} ${styles.enter} ${styles.d2}`}>
        <b>{other}</b>
        <span>{otherNote}</span>
      </div>
    </div>
  );
}

/** The SignIn board's Orders screen: the night's paid order, its Confirm turning to Confirmed, and yesterday's below. */
function Orders() {
  return (
    <div className={styles.scr} style={{ background: 'var(--tj-grey-50)', color: 'var(--ink)' }}>
      <p className={styles.scrTitle}>Orders</p>
      <div className={`${styles.card} ${styles.enter} ${styles.d1}`}>
        <p className={styles.cardRow}>
          <span className={styles.av} style={{ background: 'var(--tj-blob-pink)' }}>
            M
          </span>
          <span>
            <b>Mira</b>
            <span>#1042 · 7:12 am</span>
          </span>
          <b className={styles.amount}>RM235</b>
        </p>
        <p className={styles.cardText}>
          2× Kek coklat 1kg · 1× Kek batik
          <br />
          Pickup · Saturday · Paid by QR
        </p>
        <span className={`${styles.cardBtn} ${styles.confirm}`}>
          <span className={styles.confirmA}>Confirm</span>
          <span className={styles.confirmB}>Confirmed ✓</span>
        </span>
      </div>
      <div className={`${styles.card} ${styles.dim} ${styles.enter} ${styles.d2}`}>
        <b>Hakim · #1041</b>
        <span>2 items · RM50 · Confirmed</span>
      </div>
    </div>
  );
}

/**
 * The scenes, from the SignIn and SignUp boards. Sign in follows Kek Lina
 * through a night: her page answers while she sleeps, she wakes to a paid
 * order (and a lead), and confirms it in Orders before breakfast. Sign up
 * follows Aisyah through an afternoon of work.
 */
const FILMS: Record<'signin' | 'signup', Scene[]> = {
  signin: [
    {
      time: '11:42', meridiem: 'pm', caption: 'You’re asleep. Your page isn’t.', sky: NIGHT,
      screen: <Chat persona={lina} lines={['Ada kek coklat 1kg? Nak hari Sabtu.', 'Ada, RM95. Order sebelum Khamis ya.', 'Ok nak order. 012-345 6789']} tag="Answered while Lina slept" />,
    },
    {
      time: '7:30', meridiem: 'am', caption: 'Wake up to orders.', sky: day('#fde4d3', '50%', '12%', 'rgb(255 200 90 / 42%)', '#ffb648', '#f2a33c'),
      screen: (
        <Lock date="Friday, 17 October" time="7:30" photo={lina.photo}>
          <Note title="New order #1042 · RM235" body="Paid by QR, proof attached" delay={styles.d1} />
          <Note title="New lead · 012-345 6789" body="1kg chocolate cake, Saturday" delay={styles.d2} />
          <Note title="4 questions answered overnight" body="All from your approved facts" delay={styles.d3} />
        </Lock>
      ),
    },
    {
      time: '7:45', meridiem: 'am', caption: 'Confirm it before breakfast.', sky: day('#e6eeff', '78%', '9%', 'rgb(255 200 90 / 42%)'),
      screen: <Orders />,
    },
  ],
  signup: [
    {
      time: '2:15', meridiem: 'pm', caption: 'You’re deep in a project.', sky: day('#eef3ff', '38%', '8%'),
      screen: (
        <Lock date="Thursday, 16 October" time="2:15" photo={aisyah.photo}>
          <span className={`${styles.focus} ${styles.enter} ${styles.d1}`}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
            </svg>
            Focus · Working
          </span>
        </Lock>
      ),
    },
    {
      time: '2:16', meridiem: 'pm', caption: 'Someone finds your bio and asks.', sky: day('#eaf4ef', '52%', '9%'),
      screen: <Chat persona={aisyah} lines={['Do you do book covers? Need one by December.', 'Yes, book covers start at RM900. Two slots left in November.', 'Great. Here’s my number: 012-345 6789']} tag="Answered while Aisyah worked" />,
    },
    {
      time: '5:30', meridiem: 'pm', caption: 'Done for the day. A new client is waiting.', sky: day('#ffe1cc', '82%', '22%', 'rgb(242 132 60 / 38%)', '#ffb648', '#f2843c'),
      screen: <Leads who="Book cover" when="2:17 pm · from your page" need="Needed by December" phone="012-345 6789" other="Portrait · family of 4" otherNote="Yesterday · replied" tint="var(--tj-hijau-200)" />,
    },
  ],
};

const SCENE_MS = 4900;

/**
 * Beside the sign-in and sign-up forms: a short film of a page at work, three
 * scenes on a sky that turns from night to morning (or through an afternoon),
 * with a phone showing what the page did. Decoration: hidden from assistive
 * tech. With reduced motion it holds the first scene.
 */
export function AuthFilm({ film }: { film: 'signin' | 'signup' }) {
  const reduced = useReducedMotion();
  const scenes = FILMS[film];
  const [at, setAt] = useState(0);
  const [filling, setFilling] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (reduced) {
      setAt(0);
      return;
    }
    setFilling(false);
    const fill = window.setTimeout(() => setFilling(true), 40);
    const next = window.setTimeout(() => setAt((i) => (i + 1) % scenes.length), SCENE_MS);
    return () => {
      window.clearTimeout(fill);
      window.clearTimeout(next);
    };
  }, [at, reduced, scenes.length]);

  // The phone shrinks with a short window, so the clock, the phone and the dots always fit.
  useEffect(() => {
    const fit = () => setScale(Math.max(0.5, Math.min(1, (window.innerHeight - 330) / 540)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const scene = scenes[at]!;
  const { sky } = scene;

  return (
    <aside className={styles.art} aria-hidden="true">
      <div className={styles.film} style={{ background: sky.bg }}>
        <span className={styles.stars} style={{ opacity: sky.night ? 1 : 0 }} />
        <span className={styles.orb} style={{ left: sky.orbX, top: sky.orbY }}>
          <span className={styles.halo} style={{ background: `radial-gradient(circle, ${sky.glow} 0%, transparent 68%)` }} />
          <svg className={styles.moon} viewBox="0 0 120 120" style={{ opacity: sky.night ? 1 : 0 }}>
            <defs>
              <radialGradient id={`moon-${film}`} cx="40%" cy="35%" r="70%">
                <stop offset="0%" stopColor="#fffdf5" />
                <stop offset="70%" stopColor="#ece8da" />
                <stop offset="100%" stopColor="#d9d4c3" />
              </radialGradient>
              <mask id={`crescent-${film}`}>
                <rect width="120" height="120" fill="#fff" />
                <circle cx="82" cy="46" r="40" fill="#000" />
              </mask>
            </defs>
            <g mask={`url(#crescent-${film})`}>
              <circle cx="60" cy="60" r="40" fill={`url(#moon-${film})`} />
              <circle cx="44" cy="70" r="7" fill="#c9c3b0" opacity="0.55" />
              <circle cx="36" cy="50" r="4" fill="#c9c3b0" opacity="0.5" />
              <circle cx="52" cy="88" r="4.5" fill="#c9c3b0" opacity="0.45" />
            </g>
          </svg>
          <svg className={styles.sun} viewBox="0 0 160 160" style={{ opacity: sky.night ? 0 : 1 }}>
            <defs>
              <radialGradient id={`sun-${film}`} cx="45%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#fffbe8" />
                <stop offset="55%" stopColor={sky.sunA} />
                <stop offset="100%" stopColor={sky.sunB} />
              </radialGradient>
            </defs>
            <g className={styles.rays} stroke={sky.sunB} strokeWidth="5" strokeLinecap="round" opacity="0.55">
              <path d="M80 8v16M80 136v16M8 80h16M136 80h16M29 29l11 11M120 120l11 11M29 131l11-11M120 40l11-11" />
            </g>
            <circle cx="80" cy="80" r="40" fill={`url(#sun-${film})`} />
          </svg>
        </span>
        <span className={styles.hills} style={{ background: sky.night ? 'rgb(250 251 252 / 6%)' : 'rgb(255 255 255 / 55%)' }} />
      </div>

      <div className={styles.inner}>
        <div key={`clock-${at}`} className={`${styles.clock} ${styles.enter}`} style={{ color: sky.fg }}>
          <span className={styles.clockTime}>
            <b>{scene.time}</b>
            <span>{scene.meridiem}</span>
          </span>
          <span className={styles.clockCaption} style={{ color: sky.soft }}>
            {scene.caption}
          </span>
        </div>
        <div className={styles.phoneFit} style={{ height: Math.round(540 * scale) }}>
          <div className={styles.phone} style={{ transform: `scale(${scale})` }}>
            <div className={styles.phoneScreen}>
              <span className={styles.island} />
              <div key={`screen-${at}`} className={styles.screenWrap}>
                {scene.screen}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.dots}>
        {scenes.map((_, i) => (
          <span key={i} style={{ background: sky.night ? 'rgb(250 251 252 / 20%)' : 'rgb(25 31 44 / 14%)' }}>
            <i
              style={{
                width: i < at || (i === at && (filling || reduced)) ? '100%' : '0%',
                transition: i === at && filling && !reduced ? `width ${SCENE_MS - 100}ms linear` : 'none',
                background: sky.night ? 'var(--paper)' : 'var(--ink)',
              }}
            />
          </span>
        ))}
      </div>
    </aside>
  );
}
