'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';

export function ClaimForm({
  onClaim,
}: {
  onClaim: (input: { handle: string; displayName: string }) => Promise<unknown>;
}) {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onClaim({ handle, displayName });
    } catch (failure) {
      // Rendered verbatim. HANDLE_INVALID, HANDLE_RESERVED, HANDLE_TAKEN,
      // HANDLE_TOO_SIMILAR and PAGE_EXISTS each already carry copy that says
      // what happened and what to do -- rewriting it here would flatten
      // distinctions (like "taken" vs "too similar") the API went to the
      // trouble of keeping apart.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Field
        id="handle"
        label="Handle"
        autoComplete="off"
        required
        hint="This becomes your address. Letters and numbers, no spaces."
        value={handle}
        onChange={setHandle}
      />

      <Field
        id="displayName"
        label="Display name"
        autoComplete="name"
        required
        value={displayName}
        onChange={setDisplayName}
      />

      {error ? <Callout tone="error">{error}</Callout> : null}

      <Button type="submit" busy={busy}>
        {busy ? 'Claiming…' : 'Claim'}
      </Button>
    </form>
  );
}

/**
 * Supplies the real submit handler. Thin on purpose, same reasoning as
 * `SignIn` in `signin-form.tsx`: what this actually does is covered by the
 * API's own tests of POST /pages, plus a manual walk-through of the flow.
 */
export function Claim() {
  const router = useRouter();

  return (
    <ClaimForm
      onClaim={async (input) => {
        await apiFetch('/pages', { method: 'POST', body: JSON.stringify(input) });
        // Re-runs the Server Component now that a page exists.
        router.refresh();
      }}
    />
  );
}
