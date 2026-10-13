'use client';

import { useEffect } from 'react';
import { loadMotion, prefersReducedMotion } from './motion.js';

type LenisLike = { scrollTo: (target: HTMLElement, options?: { offset?: number; duration?: number }) => void };

// The running instance, for scrollToSection. Module state, not React state: the
// header's links are in a different component and need it without a context.
let lenis: LenisLike | null = null;

/** Berkira's glide: lerp 0.09, wheel 0.9, driven by GSAP's ticker so ScrollTrigger and Lenis agree on every frame. */
export function SmoothScroll(): null {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;
    void loadMotion().then(({ gsap, ScrollTrigger, Lenis }) => {
      if (cancelled) return;
      const instance = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
      lenis = instance;
      instance.on('scroll', () => ScrollTrigger.update());
      const tick = (time: number) => instance.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      teardown = () => {
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

/** Scrolls to an in-page section: smoothly through Lenis when it runs, natively otherwise. */
export function scrollToSection(href: string): void {
  const target = document.querySelector<HTMLElement>(href);
  if (!target) return;
  if (lenis && !prefersReducedMotion()) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
  else target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
