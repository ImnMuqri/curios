'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';
import { Done, SettingRow } from './setting-row.js';
import styles from './settings.module.css';

/**
 * Whether the page may appear in search results.
 *
 * A business page always is, so it gets "Always on" rather than a switch that
 * would do nothing. A personal page starts out of search results -- most
 * people do not want an AI page about themselves ranking for their own name
 * -- and the row says so beside the switch, because an owner who finds their
 * page missing from Google should not have to guess why.
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
    return <SettingRow icon="search" tone="amber" title="Search engines" note="Business pages always appear in search results." action={<Done>Always on</Done>} />;
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
    <SettingRow
      icon="search"
      tone="amber"
      title="Search engines"
      note={
        on
          ? 'Your page can appear in search results.'
          : 'Your page starts out of search results: most people do not want an AI page about themselves ranking for their own name.'
      }
      action={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Show my page in search results"
          className={styles.switch}
          disabled={busy}
          onClick={() => void change(!on)}
        >
          <i />
        </button>
      }
      below={
        error ? (
          <p className={`${styles.error} ${styles.rowError}`} role="alert">
            {error}
          </p>
        ) : null
      }
    />
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
