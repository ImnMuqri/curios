'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import styles from './nav-progress.module.css';

type Phase = 'idle' | 'loading' | 'done';

const NavPhase = createContext<Phase>('idle');

/** Gives up on a navigation that never lands (offline, an error page), so the bar never sticks. */
const GIVE_UP_MS = 15_000;
/** How long the full bar stays to fade out once the screen has arrived. */
const FINISH_MS = 320;

/**
 * Whether a dashboard screen is on its way, for the bar under each header (NavProgress).
 *
 * The sidebar and the Older/Next links navigate without a reload, which shows no
 * sign of life until the next screen renders. A click on a link to another
 * dashboard address starts the bar; the address actually changing ends it.
 * Clicks a browser handles itself (a new tab, a download) are left alone.
 */
export function NavProgressProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const [phase, setPhase] = useState<Phase>('idle');
  // Read by the address effect below, which must see a click made since the last render.
  const current = useRef<Phase>('idle');
  const here = useRef('');
  here.current = search ? `${pathname}?${search}` : pathname;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = (next: Phase, then?: { phase: Phase; ms: number }) => {
    current.current = next;
    setPhase(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = then ? setTimeout(() => go(then.phase), then.ms) : null;
  };

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/app')) return;
      if (url.pathname + url.search === here.current) return;
      go('loading', { phase: 'idle', ms: GIVE_UP_MS });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // The address changed: the screen is here. Fill the bar, then let it fade. Keyed on the
  // address alone: `go` is new each render and reads nothing that render changes.
  useEffect(() => {
    if (current.current === 'loading') go('done', { phase: 'idle', ms: FINISH_MS });
  }, [pathname, search]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return <NavPhase.Provider value={phase}>{children}</NavPhase.Provider>;
}

/** The thin bar along the bottom edge of a screen's header while the next screen loads. */
export function NavProgress() {
  const phase = useContext(NavPhase);
  if (phase === 'idle') return null;
  return <span className={styles.bar} data-phase={phase} aria-hidden="true" />;
}
