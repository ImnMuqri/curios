'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/** Under this width a picked item takes the screen as its own view (the frame's phone, inbox.module.css). */
export const OWN_VIEW = '(max-width: 1100px)';

/** Back to the top of the screen: whichever of its ancestors scrolls (the frame's sheet, or the page itself). */
export function scrollToTop(el: HTMLElement | null) {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    if (node.scrollTop > 0) node.scrollTop = 0;
  }
  if (typeof window !== 'undefined' && window.scrollY > 0) window.scrollTo(0, 0);
}

/** Focus goes to the first row, not a named one. */
const FIRST = '@@first';

/** Focus the row `selector(id)` names, else the first row; never leaves focus on the body. */
function focusRow(root: HTMLElement | null, id: string | null, row: (id: string) => string, firstRow: string) {
  const el = (id ? root?.querySelector<HTMLElement>(row(id)) : null) ?? root?.querySelector<HTMLElement>(firstRow);
  el?.focus({ preventScroll: true });
}

/**
 * The inbox screens' list-and-detail behaviour, once (Orders, Leads; Questions has its own route for
 * the same thing, `useRouteView` below):
 *
 * - On a phone a picked item takes the screen as its own view (`open`, the split's `data-open`), and
 *   holds that item by id until the owner goes back, even when a move takes it out of the filter.
 * - On a wide screen a move made from the item's own card holds it too (`hold`), so the card and the
 *   focus in it stay put instead of the next customer's slipping under the pointer. A pick, a filter,
 *   a card or the search lets go (`release`, `leave`, `pick`).
 * - Focus goes to the detail's heading (`[data-detail-heading]`) on the way into the own view, and
 *   back to the item's row on the way out, or the first row when that row is gone (a move took it
 *   out of the list, or it was deleted). The screen is scrolled to the top each time.
 *
 * The page works out which item is shown: `holds(chosenId)` says whether to look it up in the whole
 * list rather than the filtered one.
 */
export function useOwnView({
  screen,
  detail,
  row,
  firstRow,
  initialOpen = false,
}: {
  screen: RefObject<HTMLElement | null>;
  detail: RefObject<HTMLElement | null>;
  /** The selector of one item's row. */
  row: (id: string) => string;
  firstRow: string;
  initialOpen?: boolean;
}) {
  const where = useRef({ row, firstRow });
  where.current = { row, firstRow };
  const [open, setOpen] = useState(initialOpen);
  const [held, setHeld] = useState<string | null>(null);
  // After the own view opens or closes: 'detail', a row's id to land back on, or FIRST.
  const focusAfter = useRef<string | null>(null);
  // Asks for that focus move when the own view's state does not change (a delete on a wide screen).
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    scrollToTop(screen.current);
    if (target === 'detail') {
      detail.current?.querySelector<HTMLElement>('[data-detail-heading]')?.focus({ preventScroll: true });
      return;
    }
    focusRow(screen.current, target === FIRST ? null : target, where.current.row, where.current.firstRow);
  }, [open, nudge]);

  const wide = () => !(typeof window !== 'undefined' && window.matchMedia?.(OWN_VIEW).matches);

  return {
    open,
    /** Whether the open item is looked up in the whole list: the own view, or a move made from its card. */
    holds: (chosenId: string | null) => open || (held !== null && held === chosenId),
    /** A row picked: the own view opens where there is one, and any hold lets go. */
    pick() {
      setHeld(null);
      if (!wide()) {
        focusAfter.current = 'detail';
        setOpen(true);
      }
    },
    /** "‹ All items": focus goes back to the item's row (or the first). */
    back(id: string | null) {
      focusAfter.current = id ?? FIRST;
      setOpen(false);
      setHeld(null);
    },
    /** A filter, a card or the search was changed from the list: nothing holds the own view any more. */
    leave() {
      setOpen(false);
      setHeld(null);
    },
    /** A move made from this item's card: keep it on screen, by id, until the owner picks something else. */
    hold(id: string) {
      setHeld(id);
    },
    /** The open item is gone from the list altogether (another tab deleted it): back to the list. */
    gone() {
      focusAfter.current = FIRST;
      setOpen(false);
      setHeld(null);
    },
    /** The item was deleted from its own card: focus lands on the first row left, not the page's foot. */
    removed() {
      focusAfter.current = FIRST;
      setOpen(false);
      setHeld(null);
      setNudge((n) => n + 1);
    },
  };
}

/**
 * The same hand-off for a screen whose detail is its own route (Questions: `?topic=`): when the
 * open topic changes the screen is scrolled to the top, focus goes to the new view's h1 on the way
 * in, and on the way out to the row of the topic that was open, or the first row.
 */
export function useRouteView({
  screen,
  openId,
  row,
  firstRow,
}: {
  screen: RefObject<HTMLElement | null>;
  openId: string | null;
  row: (id: string) => string;
  firstRow: string;
}) {
  const where = useRef({ row, firstRow });
  where.current = { row, firstRow };
  const was = useRef<string | null>(openId);
  useEffect(() => {
    const before = was.current;
    if (before === openId) return;
    was.current = openId;
    const root = screen.current;
    scrollToTop(root);
    if (openId !== null) {
      const heading = root?.querySelector<HTMLElement>('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      return;
    }
    focusRow(root, before, where.current.row, where.current.firstRow);
  }, [openId]);
}
