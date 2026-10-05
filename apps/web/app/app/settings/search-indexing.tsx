'use client';

import { Callout } from '@curios/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';
import panel from '../panel.module.css';

/**
 * Whether a personal page may appear in search results.
 *
 * Off by default -- most people do not want an AI page about themselves
 * ranking for their own name -- and it says so beside the switch, because an
 * owner who finds their page missing from Google should not have to guess why.
 * A business page is always indexed, so it gets a sentence instead of a
 * switch that would do nothing.
 *
 * Optimistic: the switch moves when pressed, and moves back if the save fails.
 */
export function SearchIndexingForm({
  mode,
  allowed,
  onChange,
}: {
  mode: 'PERSONAL' | 'BUSINESS';
  allowed: boolean;
  onChange: (allow: boolean) => Promise<unknown>;
}) {
  const [on, setOn] = useState(allowed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (mode === 'BUSINESS') {
    return (
      <section className={panel.panel}>
        <h2 className={panel.panelTitle}>Search engines</h2>
        <p className={panel.text}>Business pages always appear in search results.</p>
      </section>
    );
  }

  async function change(next: boolean) {
    setError('');
    setOn(next);
    setBusy(true);
    try {
      await onChange(next);
    } catch (failure) {
      setOn(!next);
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panel.panel}>
      <h2 className={panel.panelTitle}>Search engines</h2>
      <p className={panel.text}>
        Your page starts out of search results: most people do not want an AI page about themselves
        ranking for their own name.
      </p>
      <label className={panel.check}>
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />
        Show my page in search results
      </label>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}

/** Supplies the real handler. A Server Component may not pass a function here. */
export function SearchIndexing({ mode, allowed }: { mode: 'PERSONAL' | 'BUSINESS'; allowed: boolean }) {
  const router = useRouter();
  return (
    <SearchIndexingForm
      mode={mode}
      allowed={allowed}
      onChange={async (allow) => {
        await apiFetch('/pages/search-indexing', { method: 'PATCH', body: JSON.stringify({ allow }) });
        router.refresh();
      }}
    />
  );
}
