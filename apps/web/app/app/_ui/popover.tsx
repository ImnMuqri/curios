'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './popover.module.css';

/** Data attributes for the button, for a menu that marks it as its own (the phone menu's More tab). */
type ButtonData = { [key: `data-${string}`]: string | true | undefined };

/**
 * Sent on the document when an overlay opens (a Popover, or Help), with its id as the detail: any
 * other open Popover closes, so one layer is open at a time and one Escape closes only it.
 */
export const OVERLAY_OPENS = 'curios:overlay-opens';

export function announceOverlay(id: string) {
  document.dispatchEvent(new CustomEvent<string>(OVERLAY_OPENS, { detail: id }));
}

/**
 * A button that opens a small panel under it: the bell's notifications, the account menu (the
 * sidebar's card and the phone's avatar) and the phone menu's More sheet.
 * A disclosure (aria-expanded): its contents are announced as what they are -- links, buttons, the
 * account menu's Dark mode switch. Escape, a click outside (or on its scrim), or a link followed (or
 * a [data-closes] button pressed) inside closes it, and Escape or the scrim puts focus back on the button.
 * Another overlay opening (OVERLAY_OPENS: another Popover, or Help) closes it too, focus left where it is.
 */
export function Popover({
  label,
  button,
  buttonClassName,
  buttonData,
  panelClassName,
  scrimClassName,
  align = 'end',
  children,
}: {
  /** The button's accessible name; it should contain any text the button shows (WCAG 2.5.3). */
  label: string;
  button: ReactNode;
  buttonClassName: string | undefined;
  /** Data attributes on the button (the phone menu's More tab: data-tab, data-on). */
  buttonData?: ButtonData;
  /** Added to the panel's own look (the account menu is wider). */
  panelClassName?: string | undefined;
  /**
   * A scrim behind the open panel, for a panel shown as a sheet (the bell on a phone). It takes the
   * tap that closes the panel, so the tap never reaches what is under it. Its class decides where it
   * is drawn; where it is `display: none` a click outside closes the panel as usual.
   */
  scrimClassName?: string | undefined;
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
    const other = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false);
    };
    announceOverlay(id);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    document.addEventListener(OVERLAY_OPENS, other);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      document.removeEventListener(OVERLAY_OPENS, other);
    };
  }, [open, id]);

  return (
    <div className={styles.root} ref={root}>
      <button
        {...buttonData}
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
      {scrimClassName && open ? (
        <div
          className={scrimClassName}
          data-scrim
          aria-hidden="true"
          onClick={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      ) : null}
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
