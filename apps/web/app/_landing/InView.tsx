'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Marks its element with data-play="ready" on mount and data-play="run" the
 * first time it scrolls into view, so a stylesheet can hold a sequence at its
 * start and then play it once.
 *
 * Nothing is marked -- so everything simply shows, finished -- when motion is
 * reduced, when there is no IntersectionObserver, or when the element is
 * already on screen at mount (a reload halfway down must not replay).
 */
export function InView({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    if (node.getBoundingClientRect().top < window.innerHeight * 0.85) return;

    node.dataset.play = 'ready';
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        node.dataset.play = 'run';
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
