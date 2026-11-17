'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotion } from './useReducedMotion.js';

export type Wait = (ms: number) => Promise<void>;

/**
 * Plays `run` over and over until the returned stop is called. Stopping
 * clears the pending waits and they never resolve, so nothing after them runs.
 */
export function play(run: (wait: Wait) => Promise<void>): () => void {
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
    for (;;) {
      if (stopped) return;
      await run(wait);
    }
  })();
  return () => {
    stopped = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
}

/**
 * One scripted scene. `still` is its finished frame (the server, reduced
 * motion, no IntersectionObserver), `start` is where a run begins, and `run`
 * plays it once through `set`, waiting only through `wait`.
 */
export interface Scene<S, P> {
  still(p: P): S;
  start(p: P): S;
  run(p: P, set: (s: S | ((prev: S) => S)) => void, wait: Wait): Promise<void>;
}

/**
 * A scene's state, played while `ref`'s element is in view. Reduced motion,
 * or a browser without IntersectionObserver, gets the finished frame and no
 * timer. Leaving the view stops the run and resets to `start`; a changed
 * `key` stops the run and starts again.
 */
export function useScene<S, P>(scene: Scene<S, P>, p: P, ref: RefObject<Element | null>, key?: unknown): S {
  const reduced = useReducedMotion();
  const [canWatch, setCanWatch] = useState(true);
  const [inView, setInView] = useState(false);
  const [state, set] = useState<S>(() => scene.still(p));
  const pRef = useRef(p);
  pRef.current = p;
  const still = reduced || !canWatch;

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el) return;
    if (typeof window.IntersectionObserver !== 'function') {
      setCanWatch(false);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, ref]);

  useEffect(() => {
    if (still) {
      set(scene.still(pRef.current));
      return;
    }
    set(scene.start(pRef.current));
    if (!inView) return;
    return play((wait) => scene.run(pRef.current, set, wait));
  }, [scene, still, inView, key]);

  return state;
}
