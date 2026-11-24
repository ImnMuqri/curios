'use client';

import { useEffect, useState } from 'react';
import styles from './legal.module.css';

/**
 * The 240px table of contents beside a legal page, from the Site board: it
 * sticks while the page scrolls and lights the section in view. An
 * IntersectionObserver watches a band near the top of the window (no scroll
 * listener, so no jank); the light follows the first section in that band, and
 * stays on the last one passed when the band is between two. On a phone it
 * sits above the text, folded behind one button.
 */
export function LegalToc({ label, items }: { label: string; items: { id: string; heading: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inBand.add(entry.target.id);
          else inBand.delete(entry.target.id);
        }
        const first = items.find((item) => inBand.has(item.id));
        if (first) setActive(first.id);
      },
      // A band from just under the nav to 40% down the window: the section being read.
      { rootMargin: '-100px 0px -60% 0px' },
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className={styles.toc} aria-label={label} data-open={open ? '' : undefined}>
      <button type="button" className={styles.tocButton} aria-expanded={open} aria-controls="legal-toc-list" onClick={() => setOpen(!open)}>
        {label}
      </button>
      <div className={styles.tocList} id="legal-toc-list">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={item.id === active ? 'location' : undefined}
            onClick={() => {
              setActive(item.id);
              setOpen(false);
            }}
          >
            {item.heading}
          </a>
        ))}
      </div>
    </nav>
  );
}
