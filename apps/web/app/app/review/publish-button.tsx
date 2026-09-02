'use client';

import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';

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
    return (
      <p>
        Your page is live at <a href={publicUrl}>{publicUrl}</a>.
      </p>
    );
  }

  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" disabled={busy} onClick={() => void handlePublish()}>
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
  return (
    <PublishButton
      publicUrl={publicUrl}
      published={published}
      onPublish={async () => {
        await apiFetch('/publish', { method: 'POST' });
      }}
    />
  );
}
