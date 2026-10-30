'use client';

import { MIN_FRAME_PX, framePixels, moveFrame, zoomFrame } from '@curios/core/item-photos';
import { useEffect, useRef, useState } from 'react';
import styles from './store.module.css';
import type { Frame } from './store-types.js';

/** What the stage measures in a browser without layout (tests): the scale still has a size to work from. */
const FALLBACK_STAGE = 280;
/** The frame's share of the stage: the rest shows the picture dimmed around it. */
const FRAME_SHARE = 0.84;
const STEP_PX = 10;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="file"]), [tabindex="0"]';

/**
 * The crop window: the picture sits under a fixed square frame. Dragging moves the
 * picture, the Zoom slider (its value is the frame's side in original pixels), the wheel
 * and a two-finger pinch resize the frame. The picture is drawn as a plain image scaled so
 * the frame's square exactly fills the frame on screen; nothing is fetched or painted to a canvas.
 */
export function PhotoCropper({
  src,
  width,
  height,
  frame: initial,
  busy,
  onSave,
  onCancel,
  onRemove,
  onReplace,
}: {
  src: string;
  width: number;
  height: number;
  frame: Frame;
  busy?: boolean;
  onSave: (frame: Frame) => void;
  onCancel: () => void;
  onRemove?: () => void;
  onReplace?: (file: File) => void;
}) {
  const [frame, setFrame] = useState<Frame>(initial);
  const [stage, setStage] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; side: number } | null>(null);
  const live = useRef({ frame, scale: 1 });

  const shorter = Math.min(width, height);
  const minSide = Math.min(MIN_FRAME_PX, shorter);
  const maxLevel = shorter / minSide;
  const { left, top, side } = framePixels(frame, width, height);
  // Higher is closer in: 1 is the whole picture, the top is the smallest allowed square.
  const level = Math.min(Math.max(shorter / side, 1), maxLevel);
  const stageSize = stage > 0 ? stage : FALLBACK_STAGE;
  const frameSize = stageSize * FRAME_SHARE;
  const inset = (stageSize - frameSize) / 2;
  const scale = frameSize / side;
  live.current = { frame, scale };

  // Remember the opener, move focus in, and give it back on close.
  useEffect(() => {
    opener.current = document.activeElement;
    stageRef.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  // The stage is square and fluid: follow its width.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A wheel listener must not be passive, or the page behind scrolls too.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = framePixels(live.current.frame, width, height).side;
      setFrame(zoomFrame(live.current.frame, current * (event.deltaY > 0 ? 1.08 : 1 / 1.08), width, height));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, height]);

  function move(dxPx: number, dyPx: number) {
    setFrame((f) => moveFrame(f, dxPx, dyPx, width, height));
  }

  function zoomTo(next: number) {
    setFrame((f) => zoomFrame(f, next, width, height));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), side: framePixels(live.current.frame, width, height).side };
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (dist > 0) setFrame(zoomFrame(live.current.frame, (pinch.current.side * pinch.current.dist) / dist, width, height));
      return;
    }
    // The picture follows the finger, so the frame goes the other way on the original.
    move(-(point.x - last.x) / live.current.scale, -(point.y - last.y) / live.current.scale);
  }

  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key === 'Tab') {
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    // On the slider and the buttons the arrow keys keep their own meaning.
    const target = event.target as HTMLElement;
    const own = target.tagName === 'INPUT' || target.tagName === 'BUTTON';
    const step = (dx: number, dy: number) => {
      event.preventDefault();
      move(dx, dy);
    };
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomTo(side / 1.1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomTo(side * 1.1);
    } else if (!own) {
      if (event.key === 'ArrowRight') step(STEP_PX, 0);
      else if (event.key === 'ArrowLeft') step(-STEP_PX, 0);
      else if (event.key === 'ArrowDown') step(0, STEP_PX);
      else if (event.key === 'ArrowUp') step(0, -STEP_PX);
    }
  }

  return (
    <div
      className={styles.cropModal}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div ref={dialog} className={styles.cropBox} role="dialog" aria-modal="true" aria-label="Adjust photo" onKeyDown={onKeyDown}>
        <div
          ref={stageRef}
          className={styles.cropStage}
          tabIndex={0}
          aria-label="Photo. Drag or use the arrow keys to move it."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <img
            className={styles.cropImg}
            src={src}
            alt=""
            draggable={false}
            style={{ width: width * scale, height: height * scale, transform: `translate(${inset - left * scale}px, ${inset - top * scale}px)` }}
          />
          <span className={styles.cropGrid} aria-hidden="true" style={{ inset, width: frameSize, height: frameSize }} />
        </div>

        <div className={styles.cropZoom}>
          <button type="button" className={styles.cropStep} aria-label="Zoom out" onClick={() => zoomTo(side * 1.1)}>
            −
          </button>
          <input
            type="range"
            className={styles.cropRange}
            aria-label="Zoom"
            aria-valuetext={`${Math.round(level * 100)}%`}
            min={1}
            max={maxLevel}
            step="any"
            value={level}
            onChange={(event) => {
              const next = Number(event.target.value);
              // The top of the slider is exactly the smallest square, whatever rounding the browser did.
              zoomTo(next >= maxLevel - 1e-6 ? minSide : shorter / next);
            }}
          />
          <button type="button" className={styles.cropStep} aria-label="Zoom in" onClick={() => zoomTo(side / 1.1)}>
            +
          </button>
        </div>

        <div className={styles.cropFoot}>
          {onRemove ? (
            <button type="button" className={styles.cropRemove} disabled={busy} onClick={onRemove}>
              Remove photo
            </button>
          ) : null}
          {onReplace ? (
            <label className={styles.cropReplace}>
              Replace picture
              <input
                type="file"
                accept="image/*"
                className={styles.cropFile}
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) onReplace(file);
                }}
              />
            </label>
          ) : null}
          <span className={styles.cropSpacer} />
          <button type="button" className={styles.cropCancel} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.cropSave} disabled={busy} onClick={() => onSave(frame)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
