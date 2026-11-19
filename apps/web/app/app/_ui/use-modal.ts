'use client';

import { useEffect, useId, useRef, type RefObject } from 'react';
import { announceOverlay } from './popover.js';
import { useOverlayOpen } from './overlay-context.js';

const STOPS = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

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

/**
 * What every modal layer (SideSheet, Dialog) does while `open`: announces itself so popovers and Help
 * step aside, tells the frame (the phone's menu hides), locks the page's scroll, moves focus in (to
 * `[data-autofocus]`, else the first stop) and gives it back to the opener on close, keeps Tab
 * inside, and closes on Escape.
 */
export function useModal(open: boolean, onClose: () => void, panel: RefObject<HTMLElement | null>) {
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useOverlayOpen(open);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    announceOverlay(id);
    const unlock = lockScroll();
    const stops = () => [...(panel.current?.querySelectorAll<HTMLElement>(STOPS) ?? [])].filter((el) => !(el as HTMLButtonElement).disabled);
    (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? stops()[0] ?? panel.current)?.focus();

    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
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
      unlock();
      if (opener?.isConnected) opener.focus();
    };
  }, [open, id, panel]);
}
