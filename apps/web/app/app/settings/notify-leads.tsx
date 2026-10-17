'use client';

import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';
import { SettingRow } from './setting-row.js';
import styles from './settings.module.css';

/**
 * "Someone leaves their number": the lead email on or off. Off, the lead
 * still lands in Leads; only the email stops. Optimistic: the switch moves
 * when pressed, and moves back if the save fails.
 */
export function NotifyLeadsForm({ on: initial, onChange }: { on: boolean; onChange: (leads: boolean) => Promise<unknown> }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      icon="chat"
      tone="rose"
      title="Someone leaves their number"
      note={on ? 'Leads go cold. Reply within the day.' : 'Off. New leads still wait in Leads.'}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Email me when someone leaves their number"
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
export function NotifyLeads({ on }: { on: boolean }) {
  return (
    <NotifyLeadsForm
      on={on}
      onChange={(leads) => apiFetch('/pages/notifications', { method: 'PATCH', body: JSON.stringify({ leads }) })}
    />
  );
}
