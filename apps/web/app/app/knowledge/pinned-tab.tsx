'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KnowledgePinned } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { ICONS } from './facts-tab.js';
import styles from './knowledge.module.css';

const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');

const QUESTION = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01';

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

  const back = () => {
    setError('');
    setMode('view');
  };

  return (
    <li className={styles.pin}>
      <div className={styles.pinQ}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={QUESTION} />
        </svg>
        <span>{item.question}</span>
        {mode === 'view' ? (
          <span className={styles.acts}>
            <button type="button" className={styles.icb} title="Edit" aria-label={`Edit answer to ${item.question}`} onClick={() => setMode('edit')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={ICONS.edit} />
              </svg>
            </button>
            <button type="button" className={styles.icb} title="Remove" aria-label={`Remove answer to ${item.question}`} onClick={() => setMode('confirm')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={ICONS.remove} />
              </svg>
            </button>
          </span>
        ) : null}
      </div>

      {mode === 'edit' ? (
        <textarea aria-label={`Answer to ${item.question}`} value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} />
      ) : (
        <p>{item.answer}</p>
      )}

      {mode === 'edit' ? (
        <div className={styles.pinActs}>
          <button type="button" className={styles.prim} disabled={busy} aria-label={`Save answer to ${item.question}`} onClick={() => void run(() => onEdit(item.topicId, draft))}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={styles.btn2}
            onClick={() => {
              setDraft(item.answer);
              back();
            }}
          >
            Cancel
          </button>
        </div>
      ) : mode === 'confirm' ? (
        <div className={styles.pinActs}>
          <p>Remove this answer? The question goes back to Questions as unanswered.</p>
          <span className={styles.confirm} role="group" aria-label="Confirm removal">
            <button type="button" disabled={busy} onClick={() => void run(() => onWithdraw(item.topicId))}>
              Remove
            </button>
            <button type="button" onClick={back}>
              Keep
            </button>
          </span>
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The answers the owner wrote on Questions, which the chat repeats word for
 * word. Editable here too, so a wrong one can be fixed where it is found.
 */
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
  // Each row's own handlers wrap onChanged, so a success re-reads the server.
  const edit = async (id: string, answer: string) => {
    await onEdit(id, answer);
    onChanged();
  };
  const withdraw = async (id: string) => {
    await onWithdraw(id);
    onChanged();
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Answers you wrote on <a href="/app/questions">Questions</a>. The chat repeats your words exactly.
      </p>
      {pinned.length === 0 ? (
        <div className={styles.es}>
          <div className={styles.esArt} aria-hidden="true">
            <div className={styles.esRows}>
              <span data-tone="amber">
                <i />
                <b />
                <em />
              </span>
              <span data-tone="biru">
                <i />
                <b />
                <em />
              </span>
              <span data-tone="rose">
                <i />
                <b />
                <em />
              </span>
            </div>
            <span className={styles.esBadge} data-tone="jingga">
              <svg viewBox="0 0 24 24">
                <path d={QUESTION} />
              </svg>
            </span>
          </div>
          <h3>No pinned answers yet</h3>
          <p>Answer what visitors ask on Questions, and the chat repeats your words exactly, every time.</p>
          <div className={styles.esActs}>
            <a className={styles.prim} href="/app/questions">
              Go to Questions
            </a>
          </div>
        </div>
      ) : (
        <ul className={styles.pins}>
          {pinned.map((item) => (
            <PinnedRow key={item.topicId} item={item} onEdit={edit} onWithdraw={withdraw} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function Pinned({ pinned }: { pinned: KnowledgePinned[] }) {
  const router = useRouter();
  return (
    <PinnedList
      pinned={pinned}
      onEdit={async (id, answer) => {
        await apiFetch(`/topics/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }) });
      }}
      onWithdraw={async (id) => {
        await apiFetch(`/topics/${id}/answer`, { method: 'DELETE' });
      }}
      onChanged={() => router.refresh()}
    />
  );
}
