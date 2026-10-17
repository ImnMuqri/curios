'use client';

import { usePathname } from 'next/navigation';
import { rememberWantedHandle, tidyHandle } from '../../lib/wanted-handle.js';
import { SystemShell, systemStyles as styles } from './SystemShell.js';

/**
 * The address someone tried, when it could have been a page's: one path
 * segment, already in a handle's shape. Anything deeper (/app/nothing,
 * /keklina/nope) was never a page address, so there is nothing to claim.
 */
function triedHandle(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 1) return null;
  const raw = decodeURIComponent(parts[0] ?? '');
  return tidyHandle(raw) === raw.toLowerCase() && raw.length >= 3 ? raw.toLowerCase() : null;
}

/**
 * 404, from the System board: "Nobody lives here yet." When the address
 * could be a page's, it shows it struck through and offers to claim it, the
 * handle carried to sign-up as the landing page's claim field carries it.
 */
export function NotFoundScreen() {
  const handle = triedHandle(usePathname() ?? '');

  return (
    <SystemShell>
      <div className={styles.nf}>
        <div>
          <p className={styles.kick}>404 · not found</p>
          <h1 className={styles.nfH}>Nobody lives here yet.</h1>
          <p className={styles.l}>
            {handle
              ? 'There’s no Curios page at this address. It might be a typo, or the page was renamed.'
              : 'There’s nothing at this address. It might be a typo, or the page moved.'}
          </p>
          {handle ? (
            <span className={styles.addr}>
              curios.my/<b>{handle}</b>
            </span>
          ) : null}
          <div className={styles.btns}>
            {handle ? (
              <a className={styles.go} href="/signup" onClick={() => rememberWantedHandle(handle)}>
                Claim curios.my/{handle}
              </a>
            ) : null}
            <a className={handle ? styles.ghost : styles.go} href="/">
              Go to Curios
            </a>
          </div>
        </div>
        <div className={styles.art} aria-hidden="true">
          <div className={styles.ghostcard}>
            <div className={styles.gscr}>
              <div className={styles.gb}>
                <span className={styles.gav} />
                <span className={styles.gl} />
                <span className={styles.gl} />
                <span className={styles.gl} />
                <span className={styles.gl} />
              </div>
            </div>
          </div>
          <span className={styles.bub}>Hmm. Nobody’s claimed this page yet.</span>
        </div>
      </div>
    </SystemShell>
  );
}
