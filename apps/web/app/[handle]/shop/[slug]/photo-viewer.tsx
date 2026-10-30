'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShopCopy } from '../copy.js';
import styles from './product.module.css';

const CLOSE_SWIPE = 80;
const ZOOM_MAX = 4;

function gap(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * The full-screen photo: black, the count top-left, a close button top-right,
 * the square photo centred. Swipe sideways between photos, pinch to zoom, and
 * close with the button, Escape, or a downward swipe of more than 80px.
 */
export function PhotoViewer(props: { urls: string[]; start: number; copy: ShopCopy; onClose: () => void }) {
  const { urls, start, copy, onClose } = props;
  const n = urls.length;
  const track = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [index, setIndex] = useState(start);
  const [scale, setScale] = useState(1);
  const touch = useRef<{ x: number; y: number; pinch: number; base: number } | null>(null);

  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: start * el.clientWidth });
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [start]);

  function onScroll() {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    setIndex(Math.min(n - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
    setScale(1);
  }

  function onTouchStart(event: React.TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]];
    if (a && b) touch.current = { x: a.clientX, y: a.clientY, pinch: gap(a, b), base: scale };
    else if (a) touch.current = { x: a.clientX, y: a.clientY, pinch: 0, base: scale };
  }

  function onTouchMove(event: React.TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]];
    const from = touch.current;
    if (a && b && from && from.pinch > 0) setScale(Math.min(ZOOM_MAX, Math.max(1, (from.base * gap(a, b)) / from.pinch)));
  }

  function onTouchEnd(event: React.TouchEvent) {
    const from = touch.current;
    const end = event.changedTouches[0];
    if (event.touches.length === 0) touch.current = null;
    if (!from || !end || from.pinch > 0 || scale > 1) return;
    const dy = end.clientY - from.y;
    if (dy > CLOSE_SWIPE && dy > Math.abs(end.clientX - from.x)) onClose();
  }

  return (
    <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={copy.photos}>
      <span className={styles.viewerCount}>{`${index + 1} / ${n}`}</span>
      <button ref={closeRef} type="button" className={styles.viewerClose} aria-label={copy.closePhoto} onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div
        ref={track}
        className={styles.viewerTrack}
        data-zoomed={scale > 1 ? '' : undefined}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {urls.map((url, i) => (
          <div key={url + i} className={styles.viewerSlide}>
            <img src={url} alt="" draggable={false} style={i === index && scale > 1 ? { transform: `scale(${scale})` } : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
