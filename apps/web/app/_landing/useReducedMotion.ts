'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/**
 * Whether the visitor asked for less motion, kept live. The server, and the
 * first render in the browser, answer yes: the page is drawn still (every
 * scene at its finished frame), which is also what a visitor without
 * JavaScript sees, and the motion starts only once the browser says it may.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}
