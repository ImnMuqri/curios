import styles from './settings.module.css';

/**
 * A plain anchor to `GET /auth/google/link`, on the API origin, absolutely --
 * C3. Never a relative href: that endpoint does not exist on this Next app
 * and would 404. Never a `fetch`: the browser has to follow the redirect
 * chain to Google itself, and a `fetch` would follow it in the background and
 * hand back Google's HTML instead of navigating anywhere.
 *
 * No client-side state here, so no `'use client'` and no wrapper split --
 * unlike the forms elsewhere in this task, there is no closure over
 * `apiFetch` to keep off the server side of the RSC boundary.
 */
export function ConnectGoogle() {
  const href = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google/link`;

  return (
    <a className={styles.google} href={href}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="var(--g-blue)" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
        <path fill="var(--g-green)" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
        <path fill="var(--g-yellow)" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" />
        <path fill="var(--g-red)" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6Z" />
      </svg>
      Connect Google
    </a>
  );
}
