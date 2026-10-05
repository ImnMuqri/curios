'use client';

import { useState } from 'react';
import styles from './Bento.module.css';

/**
 * The page's cover photo, full width at the top, fading into the page's own
 * background. Decorative (the name below it says whose page this is), so its
 * alt is empty. Like the Avatar, a cover that fails to load disappears rather
 * than leaving a broken-image box; the page reads as one without a cover.
 *
 * Loaded eagerly at high priority: on a page with a cover, it is the largest
 * thing a visitor sees first.
 */
export function Cover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className={styles.cover} data-cover-photo>
      <img src={src} alt="" width={1440} height={900} fetchPriority="high" onError={() => setFailed(true)} />
    </div>
  );
}
