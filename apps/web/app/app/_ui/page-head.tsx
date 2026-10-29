import type { ReactNode } from 'react';
import { AlertSlot } from './alert-slot.js';
import { NavProgress } from './nav-progress.js';
import styles from './page-head.module.css';

/**
 * A screen's header at the top of the sheet (Dashboard v2): the title, with one summary sentence
 * under it that carries the numbers the stat cards used to ("2 receipts to check and 5 orders to
 * make."), and the actions on the right. `beside` sits right after the title on its line (the
 * Profile / Links tabs, a "Saved" status). No line under it.
 *
 * Under it, the frame's alert for this screen if there is one (AlertSlot), so every screen shows
 * its banner in the same place, after its title. Along its bottom edge, the bar that runs while
 * the next screen loads (NavProgress). The theme switch lives in the frame's top bar.
 */
export function PageHead({
  title,
  summary,
  beside,
  children,
}: {
  title: string;
  /** One sentence; wrap the numbers in <b>. */
  summary?: ReactNode;
  beside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <header className={styles.head}>
        <div className={styles.text}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {beside}
          </div>
          {summary ? <p className={styles.summary}>{summary}</p> : null}
        </div>
        {children ? <div className={styles.actions}>{children}</div> : null}
        <NavProgress />
      </header>
      <AlertSlot />
    </>
  );
}
