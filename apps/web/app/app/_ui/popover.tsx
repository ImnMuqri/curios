'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from './popover.module.css';

/**
 * A button that opens a small panel under it: the top bar's notifications and account menus.
 * Escape, a click outside or a link followed inside closes it, and Escape puts focus back on the
 * button.
 *
 * By default a disclosure (aria-expanded), its contents announced as what they are. With `menu`
 * it is an ARIA menu, as the account popover's handoff asks: the panel is `role="menu"`, focus
 * moves to its first `menuitem` on opening, and the arrow keys, Home and End move between them.
 * A panel that holds anything but menu items (the phone's, with the theme switch) stays a disclosure.
 */
export function Popover({
  label,
  button,
  buttonClassName,
  panelClassName,
  align = 'end',
  menu = false,
  children,
}: {
  /** The button's accessible name, and the menu's. */
  label: string;
  button: ReactNode;
  buttonClassName: string | undefined;
  /** Added to the panel's own look (the account menu is wider). */
  panelClassName?: string | undefined;
  /** Which edge of the button the panel lines up with. */
  align?: 'start' | 'end';
  menu?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    if (menu) items()[0]?.focus();
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open, menu]);

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % all.length
        : event.key === 'ArrowUp'
          ? (at - 1 + all.length) % all.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? all.length - 1
              : null;
    if (next === null || all.length === 0) return;
    event.preventDefault();
    all[next]?.focus();
  }

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup={menu ? 'menu' : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {button}
      </button>
      <div
        ref={panel}
        id={id}
        className={panelClassName ? `${styles.panel} ${panelClassName}` : styles.panel}
        data-align={align}
        hidden={!open}
        {...(menu ? { role: 'menu', 'aria-label': label, onKeyDown: onMenuKey } : {})}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
