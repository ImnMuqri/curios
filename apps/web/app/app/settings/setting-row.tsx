import type { ReactNode } from 'react';
import styles from './settings.module.css';

/** The rows' icons, drawn like the sidebar's. */
export const ICONS = {
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  shop: 'M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9l2-5h12l2 5',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  search: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4.5-4.5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
} as const;

/** The Google mark, in Google's own colours (set as tokens in settings.module.css). */
export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.gmark}>
      <path fill="var(--g-blue)" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
      <path fill="var(--g-green)" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
      <path fill="var(--g-yellow)" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" />
      <path fill="var(--g-red)" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6Z" />
    </svg>
  );
}

/** A green "it's done" chip: Business, Always on, Connected, Added. */
export function Done({ children }: { children: ReactNode }) {
  return (
    <span className={styles.ok}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={ICONS.check} />
      </svg>
      {children}
    </span>
  );
}

/**
 * One setting: an icon, what it is with a line under it, and on the right
 * what it is set to or the one thing to do about it. `below` is anything that
 * opens under the row (the password form).
 */
export function SettingRow({
  icon,
  tone,
  title,
  note,
  action,
  below,
}: {
  icon: keyof typeof ICONS | 'google';
  tone: 'biru' | 'rose' | 'amber' | 'grey' | 'google';
  title: string;
  note: ReactNode;
  action?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className={styles.rowWrap}>
      <div className={styles.row}>
        <span className={styles.icon} data-tone={tone} aria-hidden="true">
          {icon === 'google' ? (
            <GoogleMark />
          ) : (
            <svg viewBox="0 0 24 24">
              <path d={ICONS[icon]} />
            </svg>
          )}
        </span>
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
