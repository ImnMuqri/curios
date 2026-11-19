'use client';

import { useId, useRef, type ReactNode } from 'react';
import { CloseButton } from './side-sheet.js';
import { useModal } from './use-modal.js';
import styles from './dialog.module.css';

/**
 * A small centred question or confirmation (the calm Dash board's .xmod): 440px, scaling in from
 * .97, over a dimmed page. The same modal rules as SideSheet (role dialog, Escape, focus trap and
 * return, scroll lock, announces itself, hides the phone's menu); closed it is `visibility: hidden`
 * and `inert`. Put SheetAction / SheetDanger pills in `actions`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  actions,
  closeLabel = 'Close',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  closeLabel?: string;
  children?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(open, onClose, panel);
  return (
    <>
      <div className={styles.scrim} data-open={open || undefined} aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className={styles.dialog}
        data-open={open || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        inert={!open}
        aria-hidden={open ? undefined : true}
      >
        <CloseButton label={closeLabel} className={styles.corner} onClick={onClose} />
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {description ? <p className={styles.description}>{description}</p> : null}
        {children}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </>
  );
}
