'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '../../../lib/api.js';
import styles from './pages.module.css';

export type ActionKind = 'suspend' | 'unsuspend' | 'del' | 'comp' | 'reset' | 'owner';

export interface DialogPage {
  id: string;
  handle: string;
  displayName: string;
}

interface Copy {
  title: string;
  body: string;
  confirm: string;
  placeholder: string;
  danger: boolean;
  toast: string;
}

/** The board's `M.kind` table, word for word; `owner` is the one kind the board draws no dialog for. */
export function copyFor(kind: ActionKind, p: DialogPage): Copy {
  switch (kind) {
    case 'suspend':
      return {
        title: `Suspend curios.my/${p.handle}?`,
        body: 'The page shows “This page is unavailable” and its chat stops. The owner can still sign in and is emailed the reason.',
        confirm: 'Suspend page',
        placeholder: 'E.g. Scam reports, asking for transfers first',
        danger: true,
        toast: `curios.my/${p.handle} is suspended.`,
      };
    case 'unsuspend':
      return {
        title: `Bring curios.my/${p.handle} back?`,
        body: 'The page and its chat go live again straight away.',
        confirm: 'Bring it back',
        placeholder: 'E.g. Owner fixed the prices',
        danger: false,
        toast: `curios.my/${p.handle} is live again.`,
      };
    case 'del':
      return {
        title: `Delete ${p.displayName}’s account?`,
        body: 'Their page, facts, leads and orders are removed. Payments stay, as financial records. This can’t be undone.',
        confirm: 'Delete account',
        placeholder: 'E.g. Owner asked by email',
        danger: true,
        toast: 'Account deleted.',
      };
    case 'comp':
      return {
        title: `Give ${p.displayName} a month of Business?`,
        body: 'Paid until moves forward by one month. No payment is made or recorded as revenue.',
        confirm: 'Give one month',
        placeholder: 'E.g. Sorry for the outage on 20 Oct',
        danger: false,
        toast: 'One month added.',
      };
    case 'reset':
      return {
        title: `Reset ${p.displayName}’s conversations?`,
        body: 'This month’s count goes back to 0, so the chat answers again until it reaches 200.',
        confirm: 'Reset to 0',
        placeholder: 'E.g. Count was inflated by a bot',
        danger: false,
        toast: 'Conversations reset to 0.',
      };
    case 'owner':
      return {
        title: `See ${p.displayName} as the owner?`,
        body: 'Opens their dashboard read-only, with phone numbers and names masked and no messages. The visit is logged with your reason.',
        confirm: 'See it as the owner',
        placeholder: 'E.g. Owner says the shop shows no items',
        danger: false,
        toast: '',
      };
  }
}

const ROUTE: Record<Exclude<ActionKind, 'del'>, string> = {
  suspend: 'suspend',
  unsuspend: 'unsuspend',
  comp: 'grant-month',
  reset: 'reset-conversations',
  owner: 'view-as-owner',
};

export function ActionDialog({
  kind,
  page,
  onClose,
  onDone,
}: {
  kind: ActionKind;
  page: DialogPage;
  onClose: () => void;
  /** Called after the API said yes; `toast` is the board's text for the action. */
  onDone: (toast: string) => void;
}) {
  const router = useRouter();
  const copy = copyFor(kind, page);
  const ids = useId();
  const reasonRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  const mustType = kind === 'del';
  const blocked = busy || !reason.trim() || (mustType && typed.trim() !== page.handle);

  async function confirm() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const base = `/admin/pages/${encodeURIComponent(page.id)}`;
      if (kind === 'del') {
        await apiFetch(base, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim(), handle: typed.trim() }) });
      } else {
        await apiFetch(`${base}/${ROUTE[kind]}`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      }
      if (kind === 'owner') {
        // The API wrote the VIEWED_AS_OWNER row; the route behind this only reads.
        router.push(`/pages/${page.id}/as-owner`);
        onDone('');
        return;
      }
      router.refresh();
      onDone(copy.toast);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.scrim} onClick={busy ? undefined : onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
        }}
      >
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>

        <label htmlFor={`${ids}-why`}>Reason, for the audit log</label>
        <input
          ref={reasonRef}
          id={`${ids}-why`}
          value={reason}
          maxLength={500}
          placeholder={copy.placeholder}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void confirm();
          }}
        />
        {(kind === 'suspend' || kind === 'unsuspend') && <small className={styles.hint}>The owner sees this.</small>}

        {mustType && (
          <>
            <label htmlFor={`${ids}-type`}>Type {page.handle} to confirm</label>
            <input
              id={`${ids}-type`}
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </>
        )}

        {error && (
          <p className={styles.err} role="alert">
            {error}
          </p>
        )}

        <div className={styles.mact}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={copy.danger ? styles.danger : styles.prim}
            disabled={blocked}
            onClick={() => void confirm()}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
