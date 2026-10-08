'use client';

import { Button, Callout } from '@curios/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';
import panel from '../panel.module.css';

/**
 * Personal to business, in two steps. One click must not do it: the switch is
 * one-way -- nothing leads back -- and it ends the privacy default, so the
 * owner sees both facts before confirming.
 *
 * Presentational half of the wrapper split, the shape of `ResetTrialForm`.
 */
export function UpgradeForm({
  onUpgrade,
  refresh,
}: {
  onUpgrade: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upgrade() {
    setError('');
    setBusy(true);
    try {
      await onUpgrade();
      // Re-reads the Server Component: the plan summary, the pay buttons and
      // this section all change with the mode.
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return <Button onClick={() => setConfirming(true)}>Make this a business page</Button>;
  }

  return (
    <div className={panel.buttons}>
      <p>Your page will appear in search results, and you cannot switch it back to personal.</p>
      <Button busy={busy} onClick={() => void upgrade()}>
        Yes, switch — this can't be undone
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
        Keep it personal
      </Button>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </div>
  );
}

/** Supplies the real handlers. A Server Component may not pass a function here. */
export function UpgradeToBusiness() {
  const router = useRouter();
  return (
    <UpgradeForm
      onUpgrade={() => apiFetch('/pages/upgrade', { method: 'POST' })}
      refresh={() => router.refresh()}
    />
  );
}
