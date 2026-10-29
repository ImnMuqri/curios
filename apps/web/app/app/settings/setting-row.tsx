import type { ReactNode } from 'react';
import styles from './settings.module.css';

/**
 * A green "it's done" mark: Connected, Added, Always on. Dashboard v2 draws it
 * as a dot and a word in green, not a filled chip, so a column of them reads
 * as status rather than as buttons.
 */
export function Done({ children }: { children: ReactNode }) {
  return <span className={styles.ok}>{children}</span>;
}

/** The ways in, drawn on the Settings board in a neutral square before their row. */
export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ stroke: 'none' }}>
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9z" />
    </svg>
  );
}

export function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2 2" />
    </svg>
  );
}

/**
 * One setting, as a row of a plain list: what it is with a line under it, and
 * on the right what it is set to or the one thing to do about it. `icon` is the
 * neutral square the board draws before the ways to sign in; `below` is
 * anything that opens under the row (the password form).
 */
export function SettingRow({
  title,
  note,
  icon,
  action,
  below,
}: {
  title: string;
  note: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className={styles.rowWrap} data-icon={icon ? '' : undefined}>
      <div className={styles.row}>
        {icon ? <span className={styles.icon}>{icon}</span> : null}
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
