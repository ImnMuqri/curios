import type { ReactNode } from 'react';
import '../_landing/landing-tokens.css';
import type { Locale } from '../_landing/copy.js';
import { SiteNav } from '../_site/SiteNav.js';
import styles from './system.module.css';

export { styles as systemStyles };

/**
 * The frame for the system screens -- email confirmation, the reset-sent and
 * bad-link screens, not found, something broke, a suspended page, a report --
 * from the Site board: the landing's nav over the dotted ground, and the
 * screen centred in what is left. `action` swaps the nav's Sign in and call to
 * action for one quiet button ("Back to Kek Lina" on the report pages);
 * `locale` is the nav's language (a suspended Malay page shows the Malay nav).
 *
 * Server-safe, so client screens render it directly.
 */
export function SystemShell({
  children,
  action,
  locale = 'en',
}: {
  children: ReactNode;
  action?: { label: string; href: string };
  locale?: Locale;
}) {
  return (
    <div className={styles.sy} data-landing data-laptop-scale>
      <SiteNav locale={locale} action={action} />
      <div className={styles.dots} aria-hidden="true" />
      <main className={styles.main}>{children}</main>
    </div>
  );
}

/**
 * One screen on the board: Peek in a mood with his badge, the title, a line
 * under it, and whatever comes next (a form, stacked actions).
 */
export function SystemCard({
  art,
  title,
  lede,
  ledeRole,
  children,
}: {
  art: ReactNode;
  title: string;
  lede?: ReactNode;
  /** "status" where the line is what changes, as "Confirming your address…" is. */
  ledeRole?: 'status';
  children?: ReactNode;
}) {
  return (
    <div className={styles.sb}>
      {art}
      <h1 className={styles.ttl}>{title}</h1>
      {lede ? (
        <p className={styles.led} role={ledeRole}>
          {lede}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** The stacked actions under a screen's line. */
export function SystemActions({ children }: { children: ReactNode }) {
  return <div className={styles.acts}>{children}</div>;
}
