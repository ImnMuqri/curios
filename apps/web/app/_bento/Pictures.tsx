'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PictureMode } from '@curios/core/widgets';
import type { PictureWords } from './page-copy.js';
import styles from './Pictures.module.css';

export interface PublicPicture {
  url: string;
  width: number;
  height: number;
}

export interface PicturesProps {
  /** The owner's caption; the picture's name when there is no alt text. */
  label: string;
  mode: PictureMode;
  pictures: PublicPicture[];
  altText?: string | null;
  words: PictureWords;
  /** False in the editor's preview: pictures only, nothing to press. */
  interactive?: boolean;
  /** In a Bento tile: the pictures fill the tile. */
  fill?: boolean;
}

const SWIPE = 50;
const GRID_SHOWN = 3;

const fill = (text: string, n: number, total: number) => text.replace('{n}', String(n)).replace('{total}', String(total));

/** "Alt (2 of 5)"; a single picture is just its alt text. */
function altFor(base: string, i: number, total: number, of: string) {
  return total > 1 ? `${base} (${fill(of, i + 1, total)})` : base;
}

function Chevron({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** The full-screen viewer: black, the count, close, previous and next; Escape closes, arrows move, focus returns to the picture opened. */
function Viewer(props: { pictures: PublicPicture[]; start: number; alt: string; words: PictureWords; onClose: () => void }) {
  const { pictures, start, alt, words, onClose } = props;
  const n = pictures.length;
  const [index, setIndex] = useState(start);
  const closeRef = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const touch = useRef<{ x: number; y: number } | null>(null);

  const move = useCallback((by: number) => setIndex((i) => Math.min(n - 1, Math.max(0, i + by))), [n]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      else if (event.key === 'ArrowRight') move(1);
      else if (event.key === 'ArrowLeft') move(-1);
      else if (event.key === 'Tab') {
        const stops = Array.from(box.current?.querySelectorAll<HTMLElement>('button') ?? []);
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        if (!box.current?.contains(active) || (event.shiftKey && active === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [move]);

  const picture = pictures[index]!;
  return createPortal(
    <div
      ref={box}
      className={styles.viewer}
      role="dialog"
      aria-modal="true"
      aria-label={words.viewer}
      onTouchStart={(event) => {
        const t = event.touches[0];
        touch.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const from = touch.current;
        const end = event.changedTouches[0];
        touch.current = null;
        if (!from || !end) return;
        const dx = end.clientX - from.x;
        const dy = end.clientY - from.y;
        if (dy > SWIPE * 1.6 && dy > Math.abs(dx)) onClose();
        else if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
      }}
    >
      <span className={styles.viewerCount}>{fill(words.of, index + 1, n)}</span>
      <button ref={closeRef} type="button" className={styles.viewerClose} aria-label={words.close} onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <img className={styles.viewerImage} src={picture.url} alt={altFor(alt, index, n, words.of)} draggable={false} />
      {n > 1 ? (
        <>
          <button type="button" className={`${styles.viewerStep} ${styles.viewerPrev}`} aria-label={words.previous} disabled={index === 0} onClick={() => move(-1)}>
            <Chevron flip />
          </button>
          <button type="button" className={`${styles.viewerStep} ${styles.viewerNext}`} aria-label={words.next} disabled={index === n - 1} onClick={() => move(1)}>
            <Chevron />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * A Pictures or GIF widget on the public page. Carousel (scroll-snap, the next slide peeking, dots, previous/next),
 * grid (one large, two small, "+N" on the third), or a single picture, Full width or Square. A picture opens the viewer.
 */
export function Pictures({ label, mode, pictures, altText = null, words, interactive = true, fill: fills = false }: PicturesProps) {
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const alt = (altText ?? '').trim() || label;
  const total = pictures.length;

  const close = useCallback(() => {
    setOpen(null);
    const el = opener.current;
    opener.current = null;
    // The picture the visitor tapped gets focus back (it sits outside the dialog, so it can take it before the dialog goes).
    el?.focus();
  }, []);

  function show(i: number, event: { currentTarget: HTMLElement }) {
    opener.current = event.currentTarget;
    setOpen(i);
  }

  function onScroll() {
    const el = track.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    let best = 0;
    let gap = Infinity;
    slides.forEach((slide, i) => {
      const d = Math.abs(slide.offsetLeft - el.scrollLeft);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    setCurrent(best);
  }

  function step(by: number) {
    const el = track.current;
    const slide = el?.children[Math.min(total - 1, Math.max(0, current + by))] as HTMLElement | undefined;
    if (el && slide && typeof el.scrollTo === 'function') el.scrollTo({ left: slide.offsetLeft });
  }

  /** One picture as a button (or a plain frame in the editor's preview). */
  function cell(i: number, className: string | undefined, style?: CSSProperties, extra?: ReactNode) {
    const pic = pictures[i]!;
    const img = <img src={pic.url} alt={altFor(alt, i, total, words.of)} width={pic.width} height={pic.height} loading="lazy" draggable={false} />;
    return interactive ? (
      <button key={pic.url + i} type="button" className={className} style={style} aria-label={fill(words.open, i + 1, total)} onClick={(event) => show(i, event)}>
        {img}
        {extra}
      </button>
    ) : (
      <span key={pic.url + i} className={className} style={style}>
        {img}
        {extra}
      </span>
    );
  }

  let body: ReactNode;
  if (total === 1 || mode === 'FULL' || mode === 'SQUARE') {
    const pic = pictures[0]!;
    const square = mode === 'SQUARE';
    body = (
      <div className={styles.single} data-pic-single data-mode={square ? 'SQUARE' : 'FULL'} style={{ aspectRatio: square ? '1 / 1' : `${pic.width} / ${pic.height}` }}>
        {cell(0, styles.cell)}
      </div>
    );
  } else if (mode === 'GRID') {
    const shown = Math.min(GRID_SHOWN, total);
    const more = total - GRID_SHOWN;
    body = (
      <div className={styles.grid} data-pic-grid data-count={shown}>
        {Array.from({ length: shown }, (_, i) =>
          cell(
            i,
            i === 0 ? `${styles.cell} ${styles.gridFirst}` : styles.cell,
            undefined,
            i === GRID_SHOWN - 1 && more > 0 ? (
              <span className={styles.more} data-pic-more aria-hidden="true">
                +{more}
              </span>
            ) : null,
          ),
        )}
      </div>
    );
  } else {
    body = (
      <div className={styles.carousel} data-pic-carousel>
        <div ref={track} className={styles.track} onScroll={onScroll}>
          {pictures.map((pic, i) => cell(i, styles.slide, { aspectRatio: '4 / 3' }))}
        </div>
        {interactive ? (
          <>
            <button type="button" className={`${styles.step} ${styles.stepPrev}`} aria-label={words.previous} disabled={current === 0} onClick={() => step(-1)}>
              <Chevron flip />
            </button>
            <button type="button" className={`${styles.step} ${styles.stepNext}`} aria-label={words.next} disabled={current === total - 1} onClick={() => step(1)}>
              <Chevron />
            </button>
          </>
        ) : null}
        <div className={styles.dots} aria-hidden="true">
          {pictures.map((pic, i) => (
            <i key={pic.url + i} data-pic-dot data-on={i === current ? '' : undefined} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={fills ? `${styles.pics} ${styles.picsFill}` : styles.pics} data-pictures={mode}>
      {body}
      {open !== null ? <Viewer pictures={pictures} start={open} alt={alt} words={words} onClose={close} /> : null}
    </div>
  );
}
