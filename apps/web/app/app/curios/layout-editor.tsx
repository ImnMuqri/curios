'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Callout } from '@curios/ui';
import { arrangeTiles, type PageEntry, type PageLayout, type TileSize } from '@curios/core/bento';
import { WIDGET_NAMES, minWidgetSize } from '@curios/core/widgets';
import { Segmented } from '../_ui/segmented.js';
import { SectionHead } from '../_ui/section-head.js';
import { Icon, KINDS, WidgetIcon, kindOf, shown } from './link-icons.js';
import ui from '../_ui/editor.module.css';
import styles from './curios.module.css';
import type { LinkItem } from './links-editor.js';

export type LayoutEntry = PageEntry<LinkItem>;

const BAG = 'M6 8h12l1 12H5zM9 8V7a3 3 0 0 1 6 0v1';
const ASK = 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .7-1 1.3';

const nameOf = (entry: LayoutEntry) => (entry.kind === 'link' ? entry.link.label : entry.kind === 'shop' ? 'Shop' : 'People often ask');
const message = (failure: unknown) => (failure instanceof Error ? failure.message : 'That did not save. Try again.');

/** `list` with the item at `from` moved to `to`. */
function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

const SIZE_LABEL: Record<TileSize, string> = { SMALL: 'Small', WIDE: 'Wide', TALL: 'Tall', BIG: 'Big' };

/** The smallest tile a row reads well in: a player says so, the FAQ is Wide, anything else is free. */
const minimumOf = (entry: LayoutEntry): TileSize =>
  entry.kind === 'faq' ? 'WIDE' : entry.kind === 'link' && entry.link.kind === 'WIDGET' && entry.link.provider && entry.link.embedRef ? minWidgetSize(entry.link.provider, entry.link.embedRef) : 'SMALL';

/** The sizes a row offers: Wide is not enough where Tall is the minimum, and the other way round; Big is enough for all. */
const sizesFor = (min: TileSize): TileSize[] =>
  (['SMALL', 'WIDE', 'TALL', 'BIG'] as const).filter((size) => size === 'BIG' || min === 'SMALL' || size === min);

const EDGE = 48;
const MAX_SCROLL = 12;

/** How far to scroll the window this frame for a pointer at `y`: negative up, positive down, 0 away from the edges. */
export function edgeScroll(y: number, viewportHeight: number): number {
  if (y < EDGE) return -MAX_SCROLL * Math.min(1, (EDGE - y) / EDGE);
  if (y > viewportHeight - EDGE) return MAX_SCROLL * Math.min(1, (y - (viewportHeight - EDGE)) / EDGE);
  return 0;
}

type Drag = { id: string; by: 'key' | 'pointer'; draft: LayoutEntry[]; pointerId?: number };

/**
 * The Layout tab: everything on the page in the order visitors see it -- links, widgets, the shop
 * button and People often ask -- as one list to rearrange.
 *
 * Drag from a row's handle (pointer events, so a mouse and a finger both work; the handle is the
 * only place a touch starts a drag, so the list still scrolls under a finger anywhere else), or
 * focus a row and press Space to lift it, the arrow keys to move it, Space to drop it and Escape to
 * put it back. One save per drop; if it fails the order goes back and the error is shown.
 *
 * It keeps its own copy of the order so a drop shows at once; a new `entries` (an edit made
 * elsewhere, or the caller undoing a failed save) replaces it.
 */
export function LayoutEditor({
  entries,
  onReorder,
  faqEmpty,
  layout = 'LIST',
  onLayout,
  onResize,
  shopDrawn = true,
}: {
  entries: LayoutEntry[];
  /** Every id in the new order, `shop` and `faq` included. Rejects if the save fails. */
  onReorder: (ids: string[]) => Promise<void>;
  /** A business page with no answers yet: People often ask is placed but draws nothing. */
  faqEmpty: boolean;
  /** How the page is laid out. Left out, List, with no choice offered. */
  layout?: PageLayout;
  /** Choose List or Bento. The caller shows it at once and puts it back, rejecting, if the save fails. */
  onLayout?: (layout: PageLayout) => Promise<void>;
  /** Give a row (`shop` for the shop button) a tile size. Same contract as `onLayout`. */
  onResize?: (id: string, size: TileSize | null) => Promise<void>;
  /** Whether the shop button is drawn on the page (open, with items). Left out, it is. */
  shopDrawn?: boolean;
}) {
  const [order, setOrder] = useState(entries);
  const [seen, setSeen] = useState(entries);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  // Pointer events can arrive faster than renders: the drag in flight is read from here.
  const dragRef = useRef<Drag | null>(null);
  // Where the pointer last was, for the auto-scroll to keep testing the rows against it.
  const pointerY = useRef(0);
  // While a save is out nothing can be lifted: a second drop could land before, or be undone by, the first.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;

  if (entries !== seen) {
    setSeen(entries);
    setOrder(entries);
    setDragState(null);
    dragRef.current = null;
  }

  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  // A keyed row that moves in the DOM can lose focus in some browsers; the lifted row keeps it.
  useLayoutEffect(() => {
    if (drag?.by === 'key') rows.current.get(drag.id)?.focus();
  }, [drag]);

  const shownOrder = drag?.draft ?? order;
  const say = (verb: string, list: LayoutEntry[], id: string) => {
    const entry = list.find((item) => item.id === id)!;
    setAnnouncement(`${verb} ${nameOf(entry)} to position ${list.indexOf(entry) + 1} of ${list.length}`);
  };

  // Escape puts a dragged row back, as it does for a lifted one.
  const pointerDragging = drag?.by === 'pointer';
  useEffect(() => {
    if (!pointerDragging) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pointerDragging]);

  // Near the top or bottom of the screen a pointer drag scrolls the page, faster the closer the pointer
  // is to the edge. The pointer need not move for the rows to follow: each frame re-tests the last
  // position against the rows, which have moved under it. Ends with the drag (drop, cancel, lost capture)
  // and on unmount.
  useEffect(() => {
    if (!pointerDragging) return;
    let frame = 0;
    const tick = () => {
      const by = edgeScroll(pointerY.current, window.innerHeight);
      if (by !== 0) {
        window.scrollBy(0, by);
        hitTest(pointerY.current);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [pointerDragging]);

  function lift(id: string, by: Drag['by'], pointerId?: number) {
    if (savingRef.current) return;
    setError('');
    setDrag({ id, by, draft: orderRef.current, pointerId });
    if (by === 'key') {
      const entry = orderRef.current.find((item) => item.id === id)!;
      setAnnouncement(
        `Picked up ${nameOf(entry)}, position ${orderRef.current.indexOf(entry) + 1} of ${orderRef.current.length}. Arrow keys move it, Space drops it, Escape cancels.`,
      );
    }
  }

  function moveTo(to: number) {
    const current = dragRef.current;
    if (!current) return;
    const from = current.draft.findIndex((item) => item.id === current.id);
    if (to === from) return;
    const draft = moved(current.draft, from, to);
    setDrag({ ...current, draft });
    if (current.by === 'key') say('Moved', draft, current.id);
  }

  function cancel() {
    const current = dragRef.current;
    if (!current) return;
    setDrag(null);
    if (current.by === 'key') {
      const entry = orderRef.current.find((item) => item.id === current.id)!;
      setAnnouncement(`Cancelled. ${nameOf(entry)} is back at position ${orderRef.current.indexOf(entry) + 1} of ${orderRef.current.length}`);
    }
  }

  async function drop() {
    const current = dragRef.current;
    if (!current) return;
    setDrag(null);
    const before = orderRef.current;
    const ids = current.draft.map((item) => item.id);
    if (ids.join() === before.map((item) => item.id).join()) return;
    setOrder(current.draft);
    setError('');
    if (current.by === 'key') say('Dropped', current.draft, current.id);
    savingRef.current = true;
    setSaving(true);
    try {
      await onReorder(ids);
    } catch (failure) {
      setOrder(before);
      setError(message(failure));
      setAnnouncement('That did not save. The order is back as it was.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /** A choice that saves at once; the caller has already shown it, and a refusal is shown here. */
  async function choose(save: () => Promise<void>) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await save();
    } catch (failure) {
      setError(message(failure));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // The size each row draws at: what the owner chose, or what the grid makes of an automatic one.
  const resize = layout === 'BENTO' ? onResize : undefined;
  const effective = new Map(
    arrangeTiles(
      shownOrder.filter((entry) => !(entry.kind === 'faq' && faqEmpty) && !(entry.kind === 'shop' && !shopDrawn)),
      minimumOf,
    ).map((tile) => [tile.link.id, tile.size] as const),
  );

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, id: string) {
    if (event.target !== event.currentTarget) return;
    const current = dragRef.current;
    const lifted = current?.by === 'key' && current.id === id;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (lifted) void drop();
      else if (!current && !savingRef.current) lift(id, 'key');
      return;
    }
    if (!lifted) return;
    const at = current.draft.findIndex((item) => item.id === id);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo(Math.min(at + 1, current.draft.length - 1));
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo(Math.max(at - 1, 0));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  // The pointer is captured by the list, which never moves in the DOM; capturing a row would end
  // the drag the moment React reorders it.
  function onPointerDown(event: PointerEvent<HTMLUListElement>) {
    if (dragRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const handle = (event.target as Element).closest('[data-handle]');
    const id = handle?.closest('li')?.dataset.id;
    if (!id) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerY.current = event.clientY;
    lift(id, 'pointer', event.pointerId);
  }

  function hitTest(clientY: number) {
    const children = [...(list.current?.children ?? [])];
    if (children.length === 0) return;
    // The first row whose middle is below the pointer: rows of different heights do not flicker.
    let to = children.findIndex((child) => {
      const box = child.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    if (to === -1) to = children.length - 1;
    moveTo(to);
  }

  function onPointerMove(event: PointerEvent<HTMLUListElement>) {
    if (dragRef.current?.by !== 'pointer' || dragRef.current.pointerId !== event.pointerId) return;
    pointerY.current = event.clientY;
    hitTest(event.clientY);
  }

  function onPointerEnd(event: PointerEvent<HTMLUListElement>) {
    if (dragRef.current?.by !== 'pointer' || dragRef.current.pointerId !== event.pointerId) return;
    if (event.type === 'pointercancel') cancel();
    else void drop();
    // After the drop: releasing fires lostpointercapture, which must find nothing left to cancel.
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  // Capture taken away without an up or cancel (the list hidden mid-drag, the browser claiming the pointer).
  function onLostPointerCapture(event: PointerEvent<HTMLUListElement>) {
    if (dragRef.current?.by === 'pointer' && dragRef.current.pointerId === event.pointerId) cancel();
  }

  return (
    <section className={`${ui.section} ${ui.sectionRow}`} aria-labelledby="layout-title" aria-busy={saving || undefined}>
      <SectionHead
        id="layout-title"
        title="Layout"
        note="Top to bottom, as they appear. Drag a row by its handle, or focus it and press Space, then the arrow keys."
      />
      {onLayout ? (
        <div className={styles.layoutChoice}>
          <b id="layout-choice-label">How it is laid out</b>
          <Segmented
            labelledBy="layout-choice-label"
            options={[
              { id: 'LIST', label: 'List' },
              { id: 'BENTO', label: 'Bento' },
            ]}
            value={layout}
            disabled={saving}
            onChange={(next) => void choose(() => onLayout(next))}
          />
          <small>{layout === 'BENTO' ? 'Tiles in two columns. Give each a size below.' : 'One button under another.'}</small>
        </div>
      ) : null}
      <ul
        ref={list}
        className={`${styles.linkList} ${styles.layoutList}`}
        data-dragging={drag?.by === 'pointer' ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onLostPointerCapture}
        aria-busy={saving || undefined}
      >
        {shownOrder.map((entry) => (
          <li
            key={entry.id}
            data-id={entry.id}
            ref={(element) => {
              if (element) rows.current.set(entry.id, element);
              else rows.current.delete(entry.id);
            }}
            tabIndex={0}
            aria-label={nameOf(entry)}
            aria-roledescription="sortable row"
            className={`${styles.linkRow} ${styles.layoutRow}`}
            data-lifted={drag?.id === entry.id ? '' : undefined}
            data-dim={entry.kind === 'faq' && faqEmpty ? '' : undefined}
            onKeyDown={(event) => onKeyDown(event, entry.id)}
            onBlur={(event) => {
              // Tabbing away from a lifted row puts it down where it was; the row moving in the DOM does not.
              if (dragRef.current?.by === 'key' && dragRef.current.id === entry.id && event.relatedTarget && event.relatedTarget !== event.currentTarget) cancel();
            }}
          >
            <span className={styles.dragHandle} data-handle aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" className={ui.toolIcon}>
                <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
              </svg>
            </span>
            <RowBody entry={entry} faqEmpty={faqEmpty} />
            {resize && entry.kind !== 'faq' && effective.has(entry.id) ? (
              <span className={styles.layoutSize}>
                <Segmented<TileSize | 'AUTO'>
                  label={`Size of ${nameOf(entry)}`}
                  options={[{ id: 'AUTO', label: 'Auto' }, ...sizesFor(minimumOf(entry)).map((size) => ({ id: size, label: SIZE_LABEL[size] }))]}
                  value={entry.size ?? 'AUTO'}
                  disabled={saving}
                  onChange={(size) => void choose(() => resize(entry.id, size === 'AUTO' ? null : size))}
                />
                {(entry.size !== null ? effective.get(entry.id) !== entry.size : effective.get(entry.id) === 'WIDE' && minimumOf(entry) === 'SMALL') ? <small>Shown {SIZE_LABEL[effective.get(entry.id)!]} to fill the grid</small> : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <Callout tone="error">{error}</Callout> : null}
      <span className={ui.srOnly} role="status" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}

function RowBody({ entry, faqEmpty }: { entry: LayoutEntry; faqEmpty: boolean }) {
  if (entry.kind === 'shop') {
    return (
      <>
        <span className={styles.linkKind} data-kind="shop" aria-hidden="true">
          <Icon d={BAG} />
        </span>
        <span className={styles.layoutText}>
          <b>Shop</b>
          <span>Your shop button</span>
        </span>
      </>
    );
  }
  if (entry.kind === 'faq') {
    return (
      <>
        <span className={styles.linkKind} aria-hidden="true">
          <Icon d={ASK} />
        </span>
        <span className={styles.layoutText}>
          <b>People often ask</b>
          <span>{faqEmpty ? 'Shows once you answer questions' : 'The questions people ask your page most'}</span>
        </span>
      </>
    );
  }
  const { link } = entry;
  const widget = link.kind === 'WIDGET' && link.provider !== null;
  return (
    <>
      <span className={styles.linkKind} data-kind={widget ? 'widget' : kindOf(link.url)} aria-hidden="true">
        {widget ? <WidgetIcon provider={link.provider!} /> : <Icon d={KINDS[kindOf(link.url)]} />}
      </span>
      <span className={styles.layoutText}>
        <b>{link.label}</b>
        <span>{widget ? WIDGET_NAMES[link.provider!] : shown(link.url)}</span>
      </span>
    </>
  );
}
