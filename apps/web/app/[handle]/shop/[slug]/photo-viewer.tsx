'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ShopCopy } from '../copy.js';
import styles from './product.module.css';

const CLOSE_SWIPE = 80;
const ZOOM_MAX = 4;

/** The most the photo may be dragged: what zoom has pushed past the viewport edge, each way. */
function clampPan(x: number, y: number, scale: number, size: number) {
  const max = ((scale - 1) * size) / 2;
  return { x: Math.min(max, Math.max(-max, x)), y: Math.min(max, Math.max(-max, y)) };
}

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
  const dialog = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const touch = useRef<{ x: number; y: number; pinch: number; base: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: start * el.clientWidth });
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    // Focus stays inside the dialog: Tab wraps at its ends, and from outside comes back in.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab') return;
      const box = dialog.current;
      const stops = box ? Array.from(box.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')) : [];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = box?.contains(active) ?? false;
      if (!inside || (event.shiftKey && active === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
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

  function size() {
    return Math.min(window.innerWidth, window.innerHeight);
  }

  function onScroll() {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    setIndex(Math.min(n - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  function onTouchStart(event: React.TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]];
    if (a && b) touch.current = { x: a.clientX, y: a.clientY, pinch: gap(a, b), base: scale, ox: pan.x, oy: pan.y };
    else if (a) touch.current = { x: a.clientX, y: a.clientY, pinch: 0, base: scale, ox: pan.x, oy: pan.y };
  }

  function onTouchMove(event: React.TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]];
    const from = touch.current;
    if (!from) return;
    if (a && b && from.pinch > 0) {
      const next = Math.min(ZOOM_MAX, Math.max(1, (from.base * gap(a, b)) / from.pinch));
      setScale(next);
      setPan((p) => clampPan(p.x, p.y, next, size()));
    } else if (a && !b && scale > 1) {
      // One finger while zoomed drags the photo, never past its own edge.
      setPan(clampPan(from.ox + a.clientX - from.x, from.oy + a.clientY - from.y, scale, size()));
    }
  }

  function onTouchEnd(event: React.TouchEvent) {
    const from = touch.current;
    const end = event.changedTouches[0];
    if (event.touches.length === 0) touch.current = null;
    if (scale <= 1 && pan.x + pan.y !== 0) setPan({ x: 0, y: 0 });
    if (!from || !end || from.pinch > 0 || scale > 1) return;
    const dy = end.clientY - from.y;
    if (dy > CLOSE_SWIPE && dy > Math.abs(end.clientX - from.x)) onClose();
  }

  const view = (
    <div ref={dialog} className={styles.viewer} role="dialog" aria-modal="true" aria-label={copy.photos}>
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
            <img src={url} alt="" draggable={false} style={i === index && scale > 1 ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` } : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
  return createPortal(view, document.body);
}
