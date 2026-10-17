'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { KnowledgeNeverSay } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import styles from './knowledge.module.css';

const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');

/**
 * Words and topics the chat is told never to bring up, as struck-through
 * chips. Honest about what it is: an instruction to the model, very
 * reliable, not a filter.
 */
export function NeverSayList({
  entries,
  max,
  maxChars,
  onAdd,
  onRemove,
  onChanged,
}: {
  entries: KnowledgeNeverSay[];
  max: number;
  maxChars: number;
  onAdd: (phrase: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const field = useRef<HTMLInputElement>(null);
  // As the API counts: an emoji is one.
  const typed = [...phrase].length;

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy('add');
    setError('');
    try {
      await onAdd(phrase);
      setPhrase('');
      onChanged();
    } catch (failure) {
      setError(toMessage(failure));
      // Add is disabled while busy, which drops focus.
      field.current?.focus();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setRowErrors(({ [id]: _gone, ...rest }) => rest);
    try {
      await onRemove(id);
      onChanged();
    } catch (failure) {
      setRowErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.nsNote}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        <span>The chat is told never to bring these up. It’s very reliable, but not a guarantee, so don’t put anything here that must never appear.</span>
      </div>

      <form className={styles.nsAdd} onSubmit={(event) => void add(event)}>
        <input
          ref={field}
          className={styles.inp}
          aria-label="Never mention"
          placeholder="A word or topic, like: home address"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
        />
        <button type="submit" className={styles.prim} disabled={busy === 'add'}>
          Add
        </button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.nsCount}>
        <span>{`${entries.length} of ${max}`}</span>
        {typed > 0 ? <span>{` · ${typed} of ${maxChars} characters`}</span> : null}
      </p>

      {entries.length === 0 ? (
        <p className={styles.nsEmpty}>Nothing off-limits yet. Add a word or topic above, like your home address, and your page won’t bring it up.</p>
      ) : (
        <ul className={styles.nsl}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className={styles.nsp}>
                <s>{entry.phrase}</s>
                <button type="button" aria-label={`Remove ${entry.phrase}`} disabled={busy === entry.id} onClick={() => void remove(entry.id)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
              {rowErrors[entry.id] ? (
                <p className={styles.error} role="alert">
                  {rowErrors[entry.id]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NeverSay({ entries, max, maxChars }: { entries: KnowledgeNeverSay[]; max: number; maxChars: number }) {
  const router = useRouter();
  return (
    <NeverSayList
      entries={entries}
      max={max}
      maxChars={maxChars}
      onAdd={async (phrase) => {
        await apiFetch('/never-say', { method: 'POST', body: JSON.stringify({ phrase }) });
      }}
      onRemove={async (id) => {
        await apiFetch(`/never-say/${id}`, { method: 'DELETE' });
      }}
      onChanged={() => router.refresh()}
    />
  );
}
