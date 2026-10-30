'use client';

import { useRef, useState } from 'react';
import type { ShopCopy } from '../copy.js';
import { PhotoViewer } from './photo-viewer.js';
import styles from './product.module.css';

/**
 * An item's photos, option B: one square photo that swipes, a "1 / N" count
 * on it, and a row of small photos under it that jump to one. A tap opens the
 * photo full screen. One photo has no count and no row; none shows the letter.
 */
export function ProductGallery(props: { name: string; urls: string[]; copy: ShopCopy }) {
  const { name, urls, copy } = props;
  const n = urls.length;
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);

  if (n === 0) {
    return (
      <div className={styles.hero}>
        <span aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
      </div>
    );
  }

  function onScroll() {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    setIndex(Math.min(n - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  }

  function jump(i: number) {
    const el = track.current;
    setIndex(i);
    el?.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.hero}>
        <div ref={track} className={styles.track} role="group" aria-roledescription="carousel" aria-label={copy.photos} onScroll={onScroll}>
          {urls.map((url, i) => (
            <button key={url + i} type="button" className={styles.slide} aria-label={n > 1 ? `${name}, ${copy.photoOf(i + 1, n)}` : name} tabIndex={i === index ? 0 : -1} onClick={() => setViewing(i)}>
              <img src={url} alt="" draggable={false} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
            </button>
          ))}
        </div>
        {n > 1 ? <span className={styles.count}>{`${index + 1} / ${n}`}</span> : null}
      </div>
      {n > 1 ? (
        <div className={styles.thumbs}>
          {urls.map((url, i) => (
            <button key={url + i} type="button" className={styles.thumb} aria-label={copy.photoOf(i + 1, n)} aria-current={i === index ? 'true' : undefined} onClick={() => jump(i)}>
              <img src={url} alt="" draggable={false} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      ) : null}
      {viewing !== null ? <PhotoViewer urls={urls} start={viewing} copy={copy} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
