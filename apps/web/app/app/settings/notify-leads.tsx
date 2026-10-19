'use client';

import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';
import { SettingRow } from './setting-row.js';
import styles from './settings.module.css';

type Kind = 'orders' | 'receipts' | 'leads';
export type NotifySwitches = Record<Kind, boolean>;

/**
 * The Settings board's "Email me when", in its order. Off, the thing still
 * lands in the app; only the email stops, and the line says where it waits.
 * The board's fourth switch, a question asked three times, is left out: no
 * such email exists to switch.
 */
const ROWS: { kind: Kind; icon: 'receipt' | 'upload' | 'chat'; tone: 'hijau' | 'amber' | 'rose'; title: string; label: string; on: string; off: string }[] = [
  {
    kind: 'orders',
    icon: 'receipt',
    tone: 'hijau',
    title: 'A new order',
    label: 'Email me when a new order comes in',
    on: 'With the total, so you can check the receipt.',
    off: 'Off. New orders still wait in Orders.',
  },
  {
    kind: 'receipts',
    icon: 'upload',
    tone: 'amber',
    title: 'A receipt is uploaded',
    label: 'Email me when a receipt is uploaded',
    on: 'So you can mark it paid.',
    off: 'Off. Receipts still show on the order in Orders.',
  },
  {
    kind: 'leads',
    icon: 'chat',
    tone: 'rose',
    title: 'Someone leaves their number',
    label: 'Email me when someone leaves their number',
    on: 'Leads go cold. Reply within the day.',
    off: 'Off. New leads still wait in Leads.',
  },
];

/**
 * One email on or off. Optimistic: the switch moves when pressed, and moves
 * back, with the reason under its row, if the save fails.
 */
function NotifyRow({ row, on: initial, onChange }: { row: (typeof ROWS)[number]; on: boolean; onChange: (on: boolean) => Promise<unknown> }) {
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
      icon={row.icon}
      tone={row.tone}
      title={row.title}
      note={on ? row.on : row.off}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={row.label}
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

/** The three switches; each change sends only its own. */
export function NotifyForm({ on, onChange }: { on: NotifySwitches; onChange: (patch: Partial<NotifySwitches>) => Promise<unknown> }) {
  return (
    <>
      {ROWS.map((row) => (
        <NotifyRow key={row.kind} row={row} on={on[row.kind]} onChange={(next) => onChange({ [row.kind]: next })} />
      ))}
    </>
  );
}

/** Supplies the real handler. A Server Component may not pass a function here. */
export function Notify({ on }: { on: NotifySwitches }) {
  return <NotifyForm on={on} onChange={(patch) => apiFetch('/pages/notifications', { method: 'PATCH', body: JSON.stringify(patch) })} />;
}
