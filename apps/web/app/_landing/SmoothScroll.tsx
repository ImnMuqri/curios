'use client';

import { useEffect } from 'react';
import { loadMotion, prefersReducedMotion } from './motion.js';

type LenisLike = { scrollTo: (target: HTMLElement, options?: { offset?: number; duration?: number; immediate?: boolean }) => void };

// The running instance, for scrollToSection. Module state, not React state: the
// header's links are in a different component and need it without a context.
let lenis: LenisLike | null = null;

/**
 * Berkira's glide: lerp 0.09, wheel 0.9, driven by GSAP's ticker so ScrollTrigger and Lenis agree on every frame.
 * allowNestedScroll lets the wheel scroll the shop demo's own scroll areas (the basket lines, the item sheet) instead of the page.
 *
 * Once the scenes have switched on (they change the page's height) a #hash in the address is scrolled to again, once: the browser
 * landed on it before the pinned scenes existed, so it would otherwise be left short of the section.
 */
export function SmoothScroll(): null {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;
    void loadMotion().then(({ gsap, ScrollTrigger, Lenis }) => {
      if (cancelled) return;
      const instance = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9, allowNestedScroll: true });
      lenis = instance;
      instance.on('scroll', () => ScrollTrigger.update());
      const tick = (time: number) => instance.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      // Two frames: the scenes' own load callbacks (same promise) have run and the layout has settled.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const hash = window.location.hash;
          if (/^#[A-Za-z][\w-]*$/.test(hash)) scrollToSection(hash, { immediate: true });
        });
      });
      teardown = () => {
        cancelAnimationFrame(frame);
        gsap.ticker.remove(tick);
        instance.destroy();
        lenis = null;
      };
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);
  return null;
}

/**
 * Scrolls to an in-page section: smoothly through Lenis when it runs, natively otherwise, then moves focus to the
 * section (it is tabindex=-1) so the next Tab starts there and a screen reader lands on it. `immediate` jumps, for a
 * deep link on load.
 */
export function scrollToSection(href: string, options: { immediate?: boolean } = {}): void {
  const target = document.querySelector<HTMLElement>(href);
  if (!target) return;
  if (lenis && !prefersReducedMotion()) {
    // Lenis ignores CSS scroll-padding, so clear the sticky bar by hand.
    const holder = target.closest('[data-landing]') ?? document.documentElement;
    const bar = parseFloat(getComputedStyle(holder).getPropertyValue('--l-header-h'));
    lenis.scrollTo(target, { offset: -(Number.isFinite(bar) ? bar : 64), duration: 1.4, immediate: options.immediate });
  }
  else target.scrollIntoView({ behavior: prefersReducedMotion() || options.immediate ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}
