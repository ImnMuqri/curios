'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';
import { forgetWantedHandle, readWantedHandle } from '../../../lib/wanted-handle.js';
import styles from './onboarding.module.css';

export type Tier = 'PERSONAL' | 'BUSINESS';

export function ClaimForm({
  monthlyPrice,
  onClaim,
}: {
  /** The business price as an owner reads it, e.g. "RM39". A prop, because this file may not import the core barrel. */
  monthlyPrice: string;
  onClaim: (input: { handle: string; displayName: string; mode: Tier }) => Promise<unknown>;
}) {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  // No default, on purpose: nobody should land in a tier they did not pick and
  // find out later.
  const [mode, setMode] = useState<Tier | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The handle typed into the landing page's curios.my/ field, if any. After
  // mount rather than in useState, because the server render has no storage
  // and the two must agree on the first paint. Never overwrites typing.
  useEffect(() => {
    const wanted = readWantedHandle();
    if (wanted) setHandle((current) => current || wanted);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === null) {
      setError('Choose whether this page is about you or for selling.');
      return;
    }
    setBusy(true);
    try {
      await onClaim({ handle, displayName, mode });
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
      <fieldset className={styles.modes}>
        <legend>What is this page for?</legend>
        <label className={styles.mode} data-checked={mode === 'PERSONAL'}>
          <input
            type="radio"
            name="mode"
            value="PERSONAL"
            checked={mode === 'PERSONAL'}
            onChange={() => setMode('PERSONAL')}
          />
          <span>
            <strong>Personal</strong> — about you. Free. Hidden from search engines unless you choose otherwise.
          </span>
        </label>
        <label className={styles.mode} data-checked={mode === 'BUSINESS'}>
          <input
            type="radio"
            name="mode"
            value="BUSINESS"
            checked={mode === 'BUSINESS'}
            onChange={() => setMode('BUSINESS')}
          />
          <span>
            <strong>Business</strong> — for selling. Three free leads, then {monthlyPrice} a month.
          </span>
        </label>
      </fieldset>

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
export function Claim({ monthlyPrice }: { monthlyPrice: string }) {
  const router = useRouter();

  return (
    <ClaimForm
      monthlyPrice={monthlyPrice}
      onClaim={async (input) => {
        await apiFetch('/pages', { method: 'POST', body: JSON.stringify(input) });
        forgetWantedHandle();
        // Re-runs the Server Component now that a page exists.
        router.refresh();
      }}
    />
  );
}
