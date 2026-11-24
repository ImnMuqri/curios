import type { ReactNode } from 'react';
import '../_landing/landing-tokens.css';
import { SiteNav } from '../_site/SiteNav.js';
import { SiteFooterLine } from '../_site/SiteFooterLine.js';
import styles from '../auth.module.css';

/**
 * The frame for sign in, sign up, forgot and reset, from the Site board
 * ("hero-style auth"): the landing's nav over the dotted ground, one centred
 * column with a big headline and a line under it, the form (400px) beneath,
 * and the small footer. Peek sits over the email pill, inside the form.
 *
 * Server-safe, so the client forms render it directly. `chip` is the line
 * above the headline (sign up's "We'll fill in curios.my/keklina for you").
 */
export function AuthShell({
  title,
  lede,
  chip,
  children,
}: {
  title: ReactNode;
  lede?: string;
  chip?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.auth} data-landing data-laptop-scale>
      <SiteNav />
      <div className={styles.dots} aria-hidden="true" />
      <main className={styles.stage}>
        {chip}
        <h1 className={styles.title}>{title}</h1>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
        {children ? <div className={styles.form}>{children}</div> : null}
      </main>
      <SiteFooterLine />
    </div>
  );
}

/**
 * "Continue with Google": an anchor, never a button -- it must leave the app for the API origin.
 * `onClick` lets sign in note the try.
 */
export function GoogleButton({ onClick }: { onClick?: () => void } = {}) {
  return (
    <a
      className={styles.google}
      href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google`}
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
        <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
        <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z" />
        <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
      </svg>
      Continue with Google
    </a>
  );
}

/** The word between the email form and Google. */
export function Or() {
  return <p className={styles.or}>or</p>;
}
