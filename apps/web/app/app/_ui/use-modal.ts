'use client';

import { useEffect, useId, useRef, type RefObject } from 'react';
import { announceOverlay } from './popover.js';
import { useOverlayOpen } from './overlay-context.js';

const STOPS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

/** Counted, so a dialog opened over a sheet does not unlock the page early. */
let locks = 0;
let was = '';

function lockScroll() {
  if (locks++ === 0) {
    was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  return () => {
    if (--locks === 0) document.body.style.overflow = was;
  };
}

/** The open layers, bottom to top. Only the top one answers Escape and Tab. */
const stack: string[] = [];

/** Whether a person could land on it: not disabled, not inert or [hidden], not in a display:none or visibility:hidden subtree below `root`. */
function reachable(el: HTMLElement, root: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  for (let node: HTMLElement | null = el; node && node !== root.parentElement; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert')) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none') return false;
    if (node === el && style.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * What every modal layer (SideSheet, Dialog) does while `open`: announces itself so popovers and Help
 * step aside, tells the frame (the phone's menu hides), locks the page's scroll, moves focus in (to
 * `[data-autofocus]`, else the first stop) and gives it back to the opener on close, keeps Tab
 * inside, and closes on Escape.
 *
 * Layers stack: with a Dialog over a SideSheet, only the Dialog (the top) handles Escape and Tab; a
 * second Escape closes the sheet. Escape is ignored when something inside already handled it
 * (defaultPrevented: a menu or combobox closing itself).
 *
 * Focus goes back to whatever was focused on open; when that is gone (the row re-rendered) or was never
 * focused (Safari does not focus a clicked button), to `returnFocusTo` (a ref or a selector), else
 * the page's main landmark, never the top of the document.
 */
export function useModal(
  open: boolean,
  onClose: () => void,
  panel: RefObject<HTMLElement | null>,
  returnFocusTo?: RefObject<HTMLElement | null> | string,
) {
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const back = useRef(returnFocusTo);
  back.current = returnFocusTo;
  useOverlayOpen(open);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    announceOverlay(id);
    const unlock = lockScroll();
    stack.push(id);
    const stops = () => {
      const root = panel.current;
      return root ? [...root.querySelectorAll<HTMLElement>(STOPS)].filter((el) => reachable(el, root)) : [];
    };
    (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? stops()[0] ?? panel.current)?.focus();

    const key = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        event.stopImmediatePropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const all = stops();
      const first = all[0];
      const last = all[all.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const here = document.activeElement;
      if (!panel.current.contains(here) || here === panel.current || (event.shiftKey && here === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && here === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      stack.splice(stack.lastIndexOf(id), 1);
      unlock();
      const given = back.current;
      const named = typeof given === 'string' ? document.querySelector<HTMLElement>(given) : (given?.current ?? null);
      const main = document.querySelector<HTMLElement>('main');
      for (const target of [opener, named, main]) {
        if (!target?.isConnected) continue;
        if (target === main && !main.hasAttribute('tabindex')) main.tabIndex = -1;
        target.focus();
        if (document.activeElement === target) return;
      }
    };
  }, [open, id, panel]);
}
