'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './popover.module.css';

/**
 * A button that opens a small panel under it: the bell's notifications and the account menu.
 * A disclosure (aria-expanded): its contents are announced as what they are -- links, buttons, the
 * account menu's Dark mode switch. Escape, a click outside, or a link followed (or a [data-closes]
 * button pressed) inside closes it, and Escape puts focus back on the button.
 */
export function Popover({
  label,
  button,
  buttonClassName,
  panelClassName,
  align = 'end',
  children,
}: {
  /** The button's accessible name; it should contain any text the button shows (WCAG 2.5.3). */
  label: string;
  button: ReactNode;
  buttonClassName: string | undefined;
  /** Added to the panel's own look (the account menu is wider). */
  panelClassName?: string | undefined;
  /** Which edge of the button the panel lines up with. */
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        {button}
      </button>
      <div
        id={id}
        className={panelClassName ? `${styles.panel} ${panelClassName}` : styles.panel}
        data-align={align}
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a, [data-closes]')) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
