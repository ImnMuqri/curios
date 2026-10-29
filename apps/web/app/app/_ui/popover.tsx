'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './popover.module.css';

/**
 * A button that opens a small panel under it: the top bar's theme, notifications and account
 * menus. Escape, a click outside or a link followed inside closes it, and Escape puts focus back
 * on the button. A disclosure (aria-expanded), not an ARIA menu: the panels hold links, a theme
 * switch and a sign-out button, each already announced as what it is.
 */
export function Popover({
  label,
  button,
  buttonClassName,
  align = 'end',
  children,
}: {
  /** The button's accessible name. */
  label: string;
  button: ReactNode;
  buttonClassName: string | undefined;
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
    const key = (event: KeyboardEvent) => {
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
        className={styles.panel}
        data-align={align}
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
