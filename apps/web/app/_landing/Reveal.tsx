'use client';

import { useEffect } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The board's scroll reveal, without ever hiding anything on the server: the
 * HTML draws every block in place, and only after mount does this hold the
 * blocks still below the fold (`data-rv="wait"`) until each comes into view
 * (`data-rv="in"`). Blocks already in view are left alone, so nothing above
 * the fold blinks. Reduced motion, or no IntersectionObserver, holds nothing.
 */
export function RevealWatcher(): null {
  useEffect(() => {
    if (window.matchMedia(QUERY).matches) return;
    if (typeof window.IntersectionObserver !== 'function') return;
    const els = [...document.querySelectorAll<HTMLElement>('[data-landing] [data-rv]')].filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight,
    );
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.rv = 'in';
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const el of els) {
      el.dataset.rv = 'wait';
      io.observe(el);
    }
    return () => {
      io.disconnect();
      for (const el of els) el.dataset.rv = 'in';
    };
  }, []);
  return null;
}
