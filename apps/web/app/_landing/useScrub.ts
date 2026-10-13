'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { loadMotion, prefersReducedMotion } from './motion.js';

/**
 * Tweens the CSS variable --p on `ref`'s element from 0 to 1 across the
 * element's scroll (its top reaching the viewport top, to its bottom reaching
 * the viewport bottom), scrubbed so it eases behind the scroll. The scene's CSS
 * reads --p. Reduced motion: does nothing, so the CSS default (--p: 1, the
 * finished state) stands.
 *
 * ScrollTrigger computes progress from the current scroll when it is created,
 * so a page reloaded half-way down starts each scene where the reader is.
 */
export function useScrub(ref: RefObject<HTMLElement | null>, options: { scrub: number; onProgress?: (p: number) => void }): void {
  const { scrub, onProgress } = options;
  // A ref, so a caller's fresh callback each render never rebuilds the trigger.
  const cb = useRef(onProgress);
  cb.current = onProgress;
  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;
    let cancelled = false;
    let kill: (() => void) | undefined;
    void loadMotion().then(({ gsap }) => {
      if (cancelled) return;
      node.style.setProperty('--p', '0');
      node.dataset.motion = 'on';
      const tween = gsap.to(node, {
        '--p': 1,
        ease: 'none',
        scrollTrigger: {
          trigger: node,
          start: 'top top',
          end: 'bottom bottom',
          scrub,
          onUpdate: (self) => cb.current?.(self.progress),
        },
      });
      kill = () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    });
    return () => {
      cancelled = true;
      kill?.();
    };
  }, [ref, scrub]);
}
