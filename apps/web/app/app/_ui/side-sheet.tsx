'use client';

import { useId, useRef, type RefObject, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useModal } from './use-modal.js';
import styles from './side-sheet.module.css';

/** The 44px close circle, in a sheet's header and a dialog's corner. */
export function CloseButton({ label, className, onClick }: { label: string; className?: string | undefined; onClick: () => void }) {
  return (
    <button type="button" className={className ? `${styles.close} ${className}` : styles.close} aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/** The footer's one action pill (--action fill). */
export function SheetAction(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={props.className ? `${styles.action} ${props.className}` : styles.action} />;
}

/** The footer's red text action (Cancel order, Remove). */
export function SheetDanger(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={props.className ? `${styles.danger} ${props.className}` : styles.danger} />;
}

/** The footer's quiet hint, for a sheet with nothing to press. */
export function SheetHint({ children }: { children: ReactNode }) {
  return <p className={styles.hint}>{children}</p>;
}

/**
 * A panel in from the right (the calm Dash board's .xsh): 460px floating 12px in, over a dimmed page;
 * under 1100px a bottom sheet. Always mounted, so it can slide: closed it is `visibility: hidden`
 * (nothing focusable, no shadow) and `inert`. A modal dialog: Escape or a tap on the dimmed page
 * calls `onClose`, Tab stays inside, focus goes back to the opener, the page behind does not scroll.
 * The phone's menu hides while it is open, and popovers and Help step aside.
 *
 *   <SideSheet open={open} onClose={close} title="Mira" subtitle="Asked on 12 Nov"
 *     footer={<><SheetAction onClick={send}>Send</SheetAction><SheetDanger>Remove</SheetDanger></>}>
 *     ...body...
 *   </SideSheet>
 */
export function SideSheet({
  open,
  onClose,
  title,
  subtitle,
  footer,
  closeLabel = 'Close',
  returnFocusTo,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** The `.xshf` row: one SheetAction, one SheetDanger, or a SheetHint. */
  footer?: ReactNode;
  closeLabel?: string;
  /** Where focus goes on close if the opener is gone or was never focused (a ref or a selector); else the main landmark. */
  returnFocusTo?: RefObject<HTMLElement | null> | string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(open, onClose, panel, returnFocusTo);
  return (
    <>
      <div className={styles.scrim} data-open={open || undefined} aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className={styles.sheet}
        data-open={open || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        inert={!open}
        aria-hidden={open ? undefined : true}
      >
        <div className={styles.head}>
          <div className={styles.title}>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <CloseButton label={closeLabel} onClick={onClose} />
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </>
  );
}
