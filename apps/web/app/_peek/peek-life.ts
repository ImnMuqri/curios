/**
 * Peek's life on the calm landing (the Landing2 board's `boot()`): his eyes
 * follow the pointer, and every few seconds he does a small habit. Framework
 * free: every live Peek enlists here, and they share one pointer listener and
 * one habit clock, which the last Peek to leave takes down.
 */

export type PeekPose = 'idle' | 'whistle' | 'wave';
/** `shy` (hands over the eyes, for a password) and `sad` (a frown, the eyes still) are held, never picked as habits. */
export type PeekMood = 'happy' | 'hop' | 'tilt' | 'squish' | 'blink2' | 'wave2' | 'hands' | 'shy' | 'sad';

/** What enlist needs of a Peek; LivePeek's handle is one. */
export interface PeekLife {
  mood(m: PeekMood, ms?: number): void;
  look(at: { x: number; y: number } | null): void;
  el(): SVGSVGElement | null;
  /** True while a mood class is on (including a held one). */
  busy(): boolean;
  pose(): PeekPose;
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;

/** The pupils' offset toward a point `dx`,`dy` from the eye centre. */
export function pupilOffset(dx: number, dy: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, d / 260);
  return { x: round((dx / d) * 4.5 * k), y: round((dy / d) * 3.5 * k - 1) };
}

export const HABITS = ['look', 'tilt', 'squish', 'blink2', 'wave2', 'hands', 'look', 'tilt', 'hop'] as const;

export function pickHabit(rand: number, pose: PeekPose): PeekMood | 'look' {
  const h = HABITS[Math.min(HABITS.length - 1, Math.floor(rand * HABITS.length))]!;
  return h === 'wave2' && pose === 'whistle' ? 'tilt' : h;
}

export function habitMs(m: PeekMood): number {
  switch (m) {
    case 'hop':
      return 520;
    case 'wave2':
      return 1900;
    case 'tilt':
      return 1500;
    case 'happy':
      return 1900;
    default:
      return 800;
  }
}

export function nextHabitAt(now: number, rand: number, first: boolean): number {
  return first ? now + 1500 + rand * 4000 : now + 3200 + rand * 4200;
}

/** The look-around path: x, y, then how long to hold it. */
const LOOK_AROUND: [number, number, number][] = [
  [-4.5, 0, 650],
  [4.5, -1, 700],
  [0, 2.5, 500],
];

interface Entry {
  peek: PeekLife;
  follow: boolean;
  next: number;
  looking: boolean;
  /** The look-around's pending steps, cleared when the Peek leaves. */
  timers: Set<number>;
}

const entries = new Set<Entry>();
let lastMove = -Infinity;
let tick: number | undefined;
/** The last pointer position not yet acted on, and the frame that will. */
let pointer: { x: number; y: number } | null = null;
let frame: number | undefined;

/** Whether `r` is on screen, give or take `margin`. A Peek with no box (display: none) never is. */
function near(r: DOMRect, margin: number): boolean {
  if (!r.width && !r.height) return false;
  return r.bottom > -margin && r.top < window.innerHeight + margin;
}

/** Turns every following Peek's eyes to the pointer: one box read per Peek, once a frame. */
function followPointer() {
  frame = undefined;
  const at = pointer;
  pointer = null;
  if (!at) return;
  for (const entry of entries) {
    if (!entry.follow || entry.looking) continue;
    const el = entry.peek.el();
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (!near(r, 200)) continue;
    entry.peek.look(pupilOffset(at.x - (r.left + r.width / 2), at.y - (r.top + r.height * 0.55)));
  }
}

function onMove(e: PointerEvent | MouseEvent) {
  lastMove = Date.now();
  pointer = { x: e.clientX, y: e.clientY };
  if (frame !== undefined) return;
  if (typeof window.requestAnimationFrame === 'function') frame = window.requestAnimationFrame(followPointer);
  else followPointer();
}

function later(entry: Entry, run: () => void, ms: number) {
  const id = window.setTimeout(() => {
    entry.timers.delete(id);
    run();
  }, ms);
  entry.timers.add(id);
}

function lookAround(entry: Entry) {
  entry.looking = true;
  let at = 0;
  for (const [x, y, ms] of LOOK_AROUND) {
    later(entry, () => entry.peek.look({ x, y }), at);
    at += ms;
  }
  later(
    entry,
    () => {
      entry.peek.look(null);
      entry.looking = false;
    },
    at,
  );
}

function onTick() {
  const now = Date.now();
  for (const entry of entries) {
    if (now < entry.next) continue;
    const el = entry.peek.el();
    if (!el || entry.looking || entry.peek.busy() || !near(el.getBoundingClientRect(), 0)) continue;
    entry.next = nextHabitAt(now, Math.random(), false);
    const habit = pickHabit(Math.random(), entry.peek.pose());
    if (habit === 'look') {
      if (now - lastMove >= 1500) lookAround(entry);
    } else entry.peek.mood(habit);
  }
}

/** The habit clock runs only while some Peek is enlisted and the tab is showing. */
function startClock() {
  if (tick === undefined && entries.size > 0 && !document.hidden) tick = window.setInterval(onTick, 400);
}

function stopClock() {
  if (tick === undefined) return;
  window.clearInterval(tick);
  tick = undefined;
}

function onVisibility() {
  if (document.hidden) stopClock();
  else startClock();
}

function reduced(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Brings `peek` to life; returns the leave. Nothing is added under reduced motion. */
export function enlist(peek: PeekLife, follow = false): () => void {
  if (reduced()) return () => {};
  const entry: Entry = { peek, follow, next: nextHabitAt(Date.now(), Math.random(), true), looking: false, timers: new Set() };
  entries.add(entry);
  if (entries.size === 1) {
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    startClock();
  }
  return () => {
    if (!entries.delete(entry)) return;
    for (const id of entry.timers) clearTimeout(id);
    entry.timers.clear();
    if (entries.size === 0) {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
      stopClock();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      pointer = null;
    }
  };
}
