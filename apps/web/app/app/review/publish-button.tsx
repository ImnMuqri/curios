'use client';

import styles from './review.module.css';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api.js';
import { sourcePlace } from '../_ui/source-place.js';
import { Callout } from '@curios/ui';

/**
 * The one primary action this task adds: a deliberate owner action that sets
 * `published: true`. Nothing more.
 *
 * F5, the whole point of this task: this component takes NO signal about
 * facts or verification, on purpose, and must never be given one. The spec
 * says publish is "a deliberate owner action that sets `published: true`",
 * the API has no such gate, and a page with only links -- no verified facts
 * at all -- is a valid page (FRONTEND.md calls links "the boring part that
 * pays the rent"). Gating this button on review state invents a rule neither
 * the spec nor the API has. See "is not disabled when nothing is verified"
 * in publish-button.test.tsx, and Step 3 of the task, which proves that test
 * actually fails when the gate is added.
 *
 * B1: once `published` is true there is nothing left to do. Both public read
 * paths filter `verified: true` at read time, so a fact accepted after
 * publishing appears on the public page immediately with no second publish.
 * So this renders the live URL and no button at all once published -- never
 * a permanently-enabled button (an action with no effect, and no way to tell
 * whether it worked) and never a "Republish" label (which would imply the
 * public page is stale, which it never is). `done` gets the same treatment
 * as `published` for exactly this reason: a fresh publish and an
 * already-published page look identical once there is nothing left to do.
 */
export function PublishButton({
  publicUrl,
  published,
  onPublish,
}: {
  publicUrl: string;
  published: boolean;
  onPublish: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handlePublish() {
    setError('');
    setBusy(true);
    try {
      await onPublish();
      setDone(true);
    } catch (failure) {
      // Rendered verbatim -- see NoPageError in apps/api. Reachable only as
      // the race B4 describes: the page disappearing between the server
      // render that produced `publicUrl` and this click.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (published || done) {
    // The address without its scheme, as an owner would write it in a bio.
    return (
      <div className={styles.xpub}>
        <span className={styles.xok} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div>
          <b>Your page is live</b>
          <small>Accepted facts show up on it straight away. There is nothing to publish.</small>
        </div>
        {/* Not on the board; kept, so the owner can open the page from here. */}
        <a className={styles.xurl} href={publicUrl}>
          {sourcePlace(publicUrl)}
        </a>
      </div>
    );
  }

  // The board draws this too (its "not public yet" notice, with Publish): before the page is
  // public, this is the one place an owner makes it public.
  // `id="publish"`: every other screen's "not public yet" banner links here.
  return (
    <div className={styles.xpub} id="publish">
      <span className={`${styles.xok} ${styles.xdot}`} aria-hidden="true">
        !
      </span>
      <div>
        <b>Your page is not public yet</b>
        <small>Publish it when you are ready. After that, facts you accept show up on it straight away.</small>
        {error ? (
          <Callout tone="error">
            {error}
          </Callout>
        ) : null}
      </div>
      <button type="button" className={styles.publish} disabled={busy} onClick={() => void handlePublish()}>
        {busy ? 'Publishing…' : 'Publish'}
      </button>
    </div>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same shape as `Claim`,
 * `Ingest` and `Review`: `page.tsx` is a Server Component and may not pass a
 * function to a Client Component, so the closure over `apiFetch` is built
 * here, entirely on the client side of that boundary.
 *
 * `POST /publish` takes no body. `apiFetch` sends `'{}'` for exactly this
 * case, because Fastify rejects a JSON content type paired with a genuinely
 * empty body -- see the comment in `lib/api.ts`. Do not add a body here.
 */
export function Publish({ publicUrl, published }: { publicUrl: string; published: boolean }) {
  const router = useRouter();
  return (
    <PublishButton
      publicUrl={publicUrl}
      published={published}
      onPublish={async () => {
        await apiFetch('/publish', { method: 'POST' });
        // The review stack's last words read `published` too ("already live
        // on your page"), so the server side re-reads it.
        router.refresh();
      }}
    />
  );
}
