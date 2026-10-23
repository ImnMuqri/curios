import type { ReactNode } from 'react';
import styles from './settings.module.css';

/** The tick in a "done" chip. */
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

/** A green "it's done" chip: Business, Always on, Connected, Added. */
export function Done({ children }: { children: ReactNode }) {
  return (
    <span className={styles.ok}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={CHECK} />
      </svg>
      {children}
    </span>
  );
}

/**
 * One setting: what it is with a line under it, and on the right
 * what it is set to or the one thing to do about it. `below` is anything that
 * opens under the row (the password form).
 */
export function SettingRow({
  title,
  note,
  action,
  below,
}: {
  title: string;
  note: ReactNode;
  action?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className={styles.rowWrap}>
      <div className={styles.row}>
        <span className={styles.text}>
          <b>{title}</b>
          <span>{note}</span>
        </span>
        {action ? <span className={styles.action}>{action}</span> : null}
      </div>
      {below}
    </div>
  );
}
