'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { loadMotion, prefersReducedMotion } from './motion.js';
import { HERO_TIMELINE, captionAt, heroAsked } from './timeline.js';
import { useScrub } from './useScrub.js';
import styles from './hero.module.css';

/**
 * Scrubs the hero: --p drives the bubbles, the fly-in and the answer in CSS;
 * this sets which caption shows and ticks the "asked N×" count. Plays the
 * headline's load-in once. Reduced motion: nothing runs; the finished scene
 * the server drew stands.
 */
export function HeroStage({ children, askedLabels, total }: { children: ReactNode; askedLabels: ReadonlyArray<string>; total: number }) {
  const stage = useRef<HTMLDivElement>(null);

  const onProgress = useCallback(
    (p: number) => {
      const node = stage.current;
      if (!node) return;
      node.dataset.caption = String(captionAt(p, HERO_TIMELINE.captions));
      const count = node.querySelector<HTMLElement>('[data-hero-count]');
      if (count) count.textContent = askedLabels[heroAsked(p, total)] ?? '';
    },
    [askedLabels, total],
  );
  useScrub(stage, { scrub: 0.6, onProgress });

  useEffect(() => {
    const node = stage.current;
    if (!node || prefersReducedMotion()) return;
    let cancelled = false;
    const tweens: Array<{ kill: () => void }> = [];
    void loadMotion().then(({ gsap }) => {
      if (cancelled) return;
      // A reload half-way down: onProgress sets the true caption on the first scrub update.
      if (node.dataset.caption === 'all') node.dataset.caption = '0';
      tweens.push(gsap.from(node.querySelectorAll('[data-hero-line]'), { yPercent: 110, duration: 1.3, ease: 'expo.out', stagger: 0.09, delay: 0.15 }));
      // The sub fades by opacity only (never visibility, so it stays in the accessibility tree); the claim form is not faded at all, so it is usable from the first paint.
      tweens.push(gsap.from(node.querySelectorAll('[data-hero-fade]'), { opacity: 0, y: 16, duration: 1, ease: 'power3.out', delay: 0.7, stagger: 0.08 }));
    });
    return () => {
      cancelled = true;
      for (const tween of tweens) tween.kill();
    };
  }, []);

  return (
    <div ref={stage} className={styles.stage} data-caption="all">
      {children}
    </div>
  );
}
