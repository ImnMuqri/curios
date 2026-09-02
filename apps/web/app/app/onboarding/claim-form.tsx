'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
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
      <label htmlFor="handle">Handle</label>
      <input
        id="handle"
        type="text"
        autoComplete="off"
        required
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
      />

      <label htmlFor="displayName">Display name</label>
      <input
        id="displayName"
        type="text"
        autoComplete="name"
        required
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
      />

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit" disabled={busy}>
        {busy ? 'Claiming…' : 'Claim'}
      </button>
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
        // Re-runs the /app decision now that a page exists.
        router.push('/app');
      }}
    />
  );
}
