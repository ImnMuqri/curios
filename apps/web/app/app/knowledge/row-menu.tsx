'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from './knowledge.module.css';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  /** The red, destructive item. */
  danger?: boolean;
}

/**
 * The board's "···" row menu: a menu button (aria-haspopup, aria-expanded, aria-controls) that opens a
 * small list of actions. Enter, Space or the down / up arrow on the button opens it with the first / last
 * item focused; the arrows, Home and End move between items (wrapping); Escape closes it and puts focus
 * back on the button; Tab, a click outside or choosing an item closes it. After an item is chosen,
 * focus goes back to the button unless the action moved it (an edit field takes focus itself).
 */
export function RowMenu({
  label,
  items,
  onOpenChange,
}: {
  /** The button's accessible name: "More actions for this fact". */
  label: string;
  items: RowMenuItem[];
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** Which item to focus once the menu is showing: first, last, or none (a pointer opened it). */
  const land = useRef<'first' | 'last' | null>(null);

  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
  }

  const entries = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    const found = entries();
    if (land.current === 'first') found[0]?.focus();
    if (land.current === 'last') found[found.length - 1]?.focus();
    land.current = null;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      land.current = event.key === 'ArrowDown' ? 'first' : 'last';
      if (open) {
        const found = entries();
        (event.key === 'ArrowDown' ? found[0] : found[found.length - 1])?.focus();
      } else setOpen(true);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const found = entries();
    const at = found.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (at + 1) % found.length;
    else if (event.key === 'ArrowUp') next = (at - 1 + found.length) % found.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = found.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    } else if (event.key === 'Tab') {
      setOpen(false);
      return;
    } else return;
    event.preventDefault();
    found[next]?.focus();
  }

  return (
    <div className={styles.menuRoot} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.more}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          // Enter and Space click with no pointer (detail 0): land on the first item, as the arrow does.
          if (!open && event.detail === 0) land.current = 'first';
          setOpen(!open);
        }}
        onKeyDown={onButtonKey}
      >
        <span aria-hidden="true">···</span>
      </button>
      {open ? (
        <div id={id} ref={list} className={styles.menu} role="menu" aria-label={label} onKeyDown={onListKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.menuItem}
              data-danger={item.danger || undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
