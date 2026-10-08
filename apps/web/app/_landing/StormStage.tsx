'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import styles from './storm.module.css';

/**
 * Drives the "answer once" section. As the visitor scrolls through it, --p
 * goes from 0 to 1 and the scene plays in three acts, all CSS:
 *
 *   0.04-0.46  customers' messages pop up around the phone, one by one
 *   0.50-0.74  they fly into the phone, and the count on the one question
 *              ticks up to "asked 40×"
 *   0.76-0.84  the owner's one answer arrives under it
 *
 * Reduced motion: --p is 1 from the start, so the finished phone -- one
 * question, asked 40 times, one answer -- is simply there.
 */

/** Where each act starts and how long it runs, in scroll progress. */
export const STORM_ACTS = {
  appearFrom: 0.04,
  appearTo: 0.46,
  flyFrom: 0.5,
  flyTo: 0.74,
  answerFrom: 0.76,
} as const;

/** How many times the one question has been asked at this point: 0 before the messages fly in, all of them after. */
export function askedAt(progress: number, total: number): number {
  const t = (progress - STORM_ACTS.flyFrom) / (STORM_ACTS.flyTo - STORM_ACTS.flyFrom);
  return Math.round(total * Math.min(1, Math.max(0, t)));
}

/**
 * Where each message pops up, as % of the stage from its centre: round the
 * phone, left and right, top to bottom, alternating so they arrive from both
 * sides. Twelve is enough to read as "lots of people"; the count says forty.
 */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-34, -36], [33, -40], [-40, -14], [38, -18], [-31, 6], [40, 4],
  [-42, 26], [32, 24], [-30, 42], [38, 42], [-24, -46], [26, -6],
];

export function StormStage({
  wordings,
  askedLabels,
  children,
  phone,
}: {
  /** The ways of asking; the first SPOTS.length of them pop up. */
  wordings: ReadonlyArray<string>;
  /** "asked 0×" .. "asked N×", made on the server where the copy's function lives. */
  askedLabels: ReadonlyArray<string>;
  /** The words beside the scene. */
  children: ReactNode;
  /** The phone the messages fly into. Must hold one element with data-storm-count. */
  phone: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = stage.current;
    const section = node?.parentElement;
    if (!node || !section) return;
    const counter = node.querySelector<HTMLElement>('[data-storm-count]');
    const total = askedLabels.length - 1;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.style.setProperty('--p', '1');
      if (counter) counter.textContent = askedLabels[total] ?? '';
      return;
    }

    let frame = 0;
    let shown = -1;
    const measure = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      node.style.setProperty('--p', progress.toFixed(4));
      const asked = askedAt(progress, total);
      if (counter && asked !== shown) {
        shown = asked;
        counter.textContent = askedLabels[asked] ?? '';
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [askedLabels]);

  const span = STORM_ACTS.appearTo - STORM_ACTS.appearFrom;
  return (
    <div ref={stage} className={styles.stage}>
      {children}
      <div className={styles.scene}>
        <ul className={styles.bubbles} aria-hidden="true">
          {wordings.slice(0, SPOTS.length).map((text, i) => {
            const [x, y] = SPOTS[i]!;
            return (
              <li
                key={text}
                className={styles.bubble}
                style={
                  {
                    '--x': x,
                    '--y': y,
                    // When it pops up, and how far behind the first one it leaves for the phone.
                    '--t': (STORM_ACTS.appearFrom + (i * span) / SPOTS.length).toFixed(3),
                    '--d': (i * 0.008).toFixed(3),
                  } as CSSProperties
                }
              >
                {text}
              </li>
            );
          })}
        </ul>
        {phone}
      </div>
    </div>
  );
}
