'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import styles from './storm.module.css';

/**
 * Drives the "answer once" section: rows of the forty wordings slide sideways
 * like a ticker, and as the visitor scrolls through the section, `merge` goes
 * from 0 to 1 -- the one question and its answer come in, then each wording in
 * the still-moving rows gets the answer attached, one after another.
 *
 * All CSS. Each row is two copies of the same run, so a -50% slide loops
 * without a seam. The rows only move while the section is on screen.
 *
 * Reduced motion: the rows stand still, the section is one screen tall, and
 * the question, the answer and every reply are already there.
 */

/** The merge, from the section's scroll progress. Held still at both ends so each state can be read. */
export function mergeFor(progress: number) {
  const t = Math.min(1, Math.max(0, (progress - 0.22) / (0.78 - 0.22)));
  return t * t * (3 - 2 * t);
}

/** Three rows, each its own run of wordings, alternating direction and speed. */
function rowsOf(wordings: ReadonlyArray<string>) {
  const size = Math.ceil(wordings.length / 3);
  return [0, 1, 2].map((i) => ({
    // Each wording carries its own moment to be answered (0..1), scattered so
    // the replies land across all three rows rather than left to right.
    items: wordings.slice(i * size, (i + 1) * size).map((text, j) => ({ text, at: ((i * size + j) * 17) % wordings.length / wordings.length })),
    reverse: i === 1,
    seconds: [64, 78, 58][i]!,
  }));
}

export function StormStage({ wordings, reply, children }: { wordings: ReadonlyArray<string>; reply: string; children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = stage.current;
    const section = node?.parentElement;
    if (!node || !section) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.dataset.still = 'true';
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      node.style.setProperty('--merge', mergeFor(progress).toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    // The ticker only runs while someone can see it.
    const watcher =
      'IntersectionObserver' in window
        ? new IntersectionObserver(([entry]) => {
            node.dataset.playing = entry?.isIntersecting ? 'true' : 'false';
          })
        : null;
    if (watcher) watcher.observe(section);
    else node.dataset.playing = 'true';

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      watcher?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [wordings]);

  return (
    <div ref={stage} className={styles.stage} data-playing="false">
      {children}
      <div className={styles.rows} aria-hidden="true">
        {rowsOf(wordings).map((row, i) => (
          <div key={i} className={styles.row}>
            <ul className={styles.track} data-reverse={row.reverse} style={{ '--seconds': `${row.seconds}s` } as CSSProperties}>
              {/* Twice over, so sliding by half its width lands exactly where it began. */}
              {[...row.items, ...row.items].map((item, j) => (
                <li key={j} className={styles.pill} style={{ '--at': item.at.toFixed(3) } as CSSProperties}>
                  <span className={styles.pillText}>{item.text}</span>
                  <span className={styles.reply}>{reply}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
