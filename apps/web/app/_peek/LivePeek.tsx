'use client';

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { habitMs, enlist, type PeekLife, type PeekMood, type PeekPose } from './peek-life.js';
import { useReducedMotion } from '../_landing/useReducedMotion.js';
import styles from './live-peek.module.css';

export type { PeekMood, PeekPose } from './peek-life.js';

export interface LivePeekHandle {
  mood(m: PeekMood, ms?: number): void;
  look(at: { x: number; y: number } | null): void;
  el(): SVGSVGElement | null;
}

/**
 * Peek, alive (the Landing2 board, L2:593–604): full body, eyes on the
 * pointer when `follow` is set, a small habit every few seconds, and a mood
 * class for its time when a scene asks (`mood`). `held` keeps a mood on while
 * it is set. Under reduced motion he stands still: no listener, no timer.
 */
export function LivePeek({
  width,
  pose = 'idle',
  follow = false,
  held = null,
  className,
  ref,
}: {
  width: number;
  pose?: PeekPose;
  follow?: boolean;
  held?: PeekMood | null;
  className?: string;
  ref?: Ref<LivePeekHandle>;
}) {
  const clip = `pk${useId().replace(/[^\w-]/g, '')}`;
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const pupils = useRef<SVGGElement>(null);
  const [moods, setMoods] = useState<PeekMood[]>([]);
  const busy = useRef(false);
  busy.current = moods.length > 0 || held !== null;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const timers = useRef(new Set<number>());

  const life = useRef<PeekLife | null>(null);
  life.current = {
    mood(m, ms) {
      if (reducedRef.current) return;
      setMoods((prev) => (prev.includes(m) ? prev : [...prev, m]));
      const id = window.setTimeout(() => {
        timers.current.delete(id);
        setMoods((prev) => prev.filter((x) => x !== m));
      }, ms ?? habitMs(m));
      timers.current.add(id);
    },
    look(at) {
      const g = pupils.current;
      if (!g) return;
      g.style.transform = at ? `translate(${at.x.toFixed(2)}px,${at.y.toFixed(2)}px)` : '';
    },
    el: () => svg.current,
    busy: () => busy.current,
    pose: () => pose,
  };

  useImperativeHandle(
    ref,
    () => ({
      mood: (m, ms) => life.current!.mood(m, ms),
      look: (at) => life.current!.look(at),
      el: () => svg.current,
    }),
    [],
  );

  useEffect(() => {
    if (reduced) return;
    const leave = enlist(
      {
        mood: (m, ms) => life.current!.mood(m, ms),
        look: (at) => life.current!.look(at),
        el: () => svg.current,
        busy: () => busy.current,
        pose: () => life.current!.pose(),
      },
      follow,
    );
    const pending = timers.current;
    return () => {
      leave();
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, [reduced, follow]);

  const on = new Set<PeekMood>(moods);
  if (held) on.add(held);
  const cls = [styles.pk, pose !== 'idle' && styles[pose], ...[...on].map((m) => styles[m]), className].filter(Boolean).join(' ');

  return (
    <svg ref={svg} className={cls} width={width} viewBox="0 0 160 150" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <ellipse cx="80" cy="84" rx="54" ry="49" />
        </clipPath>
      </defs>
      <ellipse className={styles.sh} cx="80" cy="143" rx="40" ry="4" fill="var(--peek-ground-shadow)" />
      <g className={styles.j}>
        <ellipse cx="63" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
        <ellipse cx="97" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
        <g className={styles.hl}>
          <circle cx="19" cy="100" r="10" fill="var(--peek-body)" />
        </g>
        <g className={styles.hr}>
          <circle cx="139" cy="60" r="10" fill="var(--peek-body)" />
        </g>
        <g clipPath={`url(#${clip})`}>
          <rect x="20" y="30" width="120" height="110" fill="var(--peek-shade)" />
          <ellipse cx="73" cy="76" rx="54" ry="48" fill="var(--peek-body)" />
        </g>
        <ellipse cx="55" cy="54" rx="9" ry="5" fill="var(--peek-shine)" transform="rotate(-30 55 54)" />
        <g className={styles.e}>
          <ellipse cx="66" cy="82" rx="11.5" ry="13.5" fill="white" />
          <ellipse cx="95" cy="82" rx="11.5" ry="13.5" fill="white" />
          <g ref={pupils} className={styles.p}>
            <circle cx="67" cy="85" r="6.6" fill="var(--light-ink)" />
            <circle cx="96" cy="85" r="6.6" fill="var(--light-ink)" />
            <circle cx="69.2" cy="82" r="2.1" fill="white" />
            <circle cx="98.2" cy="82" r="2.1" fill="white" />
          </g>
        </g>
        <path className={styles.m} d="M75 102q5.5 4.5 11 0" fill="none" stroke="var(--light-ink)" strokeWidth="3" strokeLinecap="round" />
        <ellipse className={styles.o} cx="82" cy="104" rx="3.6" ry="4.2" fill="var(--light-ink)" />
        <g className={`${styles.n} ${styles.n1}`}>
          <path d="M132 44v-14l9-3v13" fill="none" stroke="var(--light-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="129.5" cy="44.5" rx="3.6" ry="2.8" fill="var(--light-ink)" />
          <ellipse cx="138.5" cy="41" rx="3.6" ry="2.8" fill="var(--light-ink)" />
        </g>
        <g className={`${styles.n} ${styles.n2}`}>
          <path d="M154 26V14q6 2 5 8" fill="none" stroke="var(--light-ink)" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="151.5" cy="26.5" rx="3.6" ry="2.8" fill="var(--light-ink)" />
        </g>
      </g>
    </svg>
  );
}
