'use client';

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import styles from './reveal.module.css';

/**
 * Fades its child up 12px, once, the first time it scrolls into view.
 *
 * Used on a handful of things that arrive in order (the setup steps, the two
 * plans), not on every section: a page where everything slides up reads as a
 * template. The hidden state is only applied once this has mounted and the
 * visitor has not asked for less motion, so with no JavaScript, or with
 * reduced motion, the content is simply there.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  /** Milliseconds; for staggering siblings. Keep it under 120. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;

    // Already on screen at mount (a short page, or a reload halfway down): leave it.
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) return;

    node.dataset.reveal = 'hidden';
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        node.dataset.reveal = 'shown';
        observer.disconnect();
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={[styles.reveal, className].filter(Boolean).join(' ')} style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}
