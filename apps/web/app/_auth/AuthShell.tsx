import type { ReactNode } from 'react';
import '../_landing/landing-tokens.css';
import { Wordmark } from '../_landing/Wordmark.js';
import { AuthFilm } from './AuthFilm.js';
import styles from '../auth.module.css';

/**
 * The frame for the screens outside the dashboard -- sign in, sign up, forgot,
 * reset, verify, and claiming a page -- from the design handoff's SignIn and
 * SignUp boards.
 *
 * Left: the form on paper, under the wordmark. Right, on wide screens: a short
 * film of a page at work (AuthFilm). `film` picks which: sign in's night with
 * Kek Lina (the default) or sign up's afternoon with Aisyah.
 *
 * Server-safe, so the client forms render it directly. `switchTo` is the
 * link under the form to the other way in ("Create your free page" from sign
 * in, "Sign in" from sign up); screens with their own next step leave it out.
 */
export function AuthShell({
  title,
  lede,
  switchTo,
  film = 'signin',
  children,
}: {
  title: string;
  lede?: string;
  switchTo?: { prompt: string; label: string; href: string };
  film?: 'signin' | 'signup';
  children: ReactNode;
}) {
  return (
    <div className={styles.auth} data-landing>
      <main className={styles.panel}>
        <a href="/" className={styles.brand}>
          <Wordmark />
          <span className={styles.srOnly}>Curios home</span>
        </a>

        <div className={styles.body}>
          <h1 className={styles.title}>{title}</h1>
          {lede ? <p className={styles.lede}>{lede}</p> : null}
          <div className={styles.content}>{children}</div>
          {switchTo ? (
            <p className={styles.switch}>
              {switchTo.prompt} <a href={switchTo.href}>{switchTo.label}</a>
            </p>
          ) : null}
        </div>
      </main>

      <AuthFilm film={film} />
    </div>
  );
}

/** "Continue with Google": an anchor, never a button -- it must leave the app for the API origin. */
export function GoogleButton() {
  return (
    <a className={styles.google} href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google`}>
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

/** The rule between Google and the email form. */
export function OrWithEmail() {
  return <p className={styles.or}>or with email</p>;
}
