'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import type { KnowledgePinned } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import styles from './knowledge.module.css';

const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');

function PinnedRow({
  item,
  onEdit,
  onWithdraw,
}: {
  item: KnowledgePinned;
  onEdit: (id: string, answer: string) => Promise<void>;
  onWithdraw: (id: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [draft, setDraft] = useState(item.answer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setMode('view');
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.row}>
      <p className={styles.meta}>{item.question}</p>
      {mode === 'edit' ? (
        <Field id={`answer-${item.questionId}`} label="Answer" multiline value={draft} onChange={setDraft} />
      ) : (
        <p className={styles.label}>{item.answer}</p>
      )}

      {mode === 'view' ? (
        <div className={styles.actions}>
          <Button variant="secondary" aria-label={`Edit answer to ${item.question}`} onClick={() => setMode('edit')}>Edit</Button>
          <Button variant="secondary" aria-label={`Remove answer to ${item.question}`} onClick={() => setMode('confirm')}>Remove</Button>
        </div>
      ) : mode === 'edit' ? (
        <div className={styles.actions}>
          <Button busy={busy} aria-label={`Save answer to ${item.question}`} onClick={() => void run(() => onEdit(item.questionId, draft))}>Save</Button>
          <Button variant="secondary" onClick={() => { setDraft(item.answer); setError(''); setMode('view'); }}>Cancel</Button>
        </div>
      ) : (
        <div className={styles.confirm} role="group" aria-label="Confirm removal">
          <p>Remove this answer? The question goes back to Questions as unanswered.</p>
          <Button busy={busy} onClick={() => void run(() => onWithdraw(item.questionId))}>Remove answer</Button>
          <Button variant="secondary" onClick={() => { setError(''); setMode('view'); }}>Cancel</Button>
        </div>
      )}
      {error ? <Callout tone="error">{error}</Callout> : null}
    </li>
  );
}

export function PinnedList({
  pinned,
  onEdit,
  onWithdraw,
  onChanged,
}: {
  pinned: KnowledgePinned[];
  onEdit: (id: string, answer: string) => Promise<void>;
  onWithdraw: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  if (pinned.length === 0) {
    return (
      <Callout tone="info">
        No pinned answers yet. Answer what visitors ask on <a href="/app/questions">Questions</a>, and the chat repeats your words exactly.
      </Callout>
    );
  }
  // Each row's own handlers wrap onChanged, so a success re-reads the server.
  const edit = async (id: string, answer: string) => { await onEdit(id, answer); onChanged(); };
  const withdraw = async (id: string) => { await onWithdraw(id); onChanged(); };
  return (
    <ul className={styles.list}>
      {pinned.map((item) => <PinnedRow key={item.questionId} item={item} onEdit={edit} onWithdraw={withdraw} />)}
    </ul>
  );
}

export function Pinned({ pinned }: { pinned: KnowledgePinned[] }) {
  const router = useRouter();
  return (
    <PinnedList
      pinned={pinned}
      onEdit={async (id, answer) => {
        await apiFetch(`/questions/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }) });
      }}
      onWithdraw={async (id) => {
        await apiFetch(`/questions/${id}/answer`, { method: 'DELETE' });
      }}
      onChanged={() => router.refresh()}
    />
  );
}
