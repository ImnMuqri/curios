import type { ReactNode } from 'react';
import { AlertSlot } from './alert-slot.js';
import styles from './page-head.module.css';

/**
 * A screen's header bar: its title on the left, then a short note and any
 * actions on the right. `beside` sits right after the title (a "Saved"
 * status). The note is the first thing to go on a phone, where the title and
 * its actions need the room.
 *
 * Under it, the frame's alert for this screen if there is one (AlertSlot),
 * so every screen shows its banner in the same place, after its title.
 */
export function PageHead({
  title,
  beside,
  note,
  children,
}: {
  title: string;
  beside?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {beside}
        {note ? <p className={styles.note}>{note}</p> : null}
        {children ? <div className={styles.actions}>{children}</div> : null}
      </header>
      <AlertSlot />
    </>
  );
}
