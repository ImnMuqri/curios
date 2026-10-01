'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import type { KnowledgeNeverSay } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import styles from './knowledge.module.css';

const NEVER_SAY_ID = 'never-say';
const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');

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
      // Add is natively disabled while busy, which drops focus; Field takes no ref, so find the input by id.
      document.getElementById(NEVER_SAY_ID)?.focus();
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
    <section>
      <Callout tone="info">
        The chat is told never to bring these up. It’s very reliable, but not a guarantee — don’t put anything here that must never appear.
      </Callout>

      <form className={styles.add} onSubmit={(event) => void add(event)}>
        <Field
          id={NEVER_SAY_ID}
          label="Never mention"
          value={phrase}
          onChange={setPhrase}
          hint={`${[...phrase].length} of ${maxChars} characters`}
        />
        <Button type="submit" busy={busy === 'add'}>Add</Button>
        {error ? <Callout tone="error">{error}</Callout> : null}
      </form>

      <p className={styles.meta}>{`${entries.length} of ${max}`}</p>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.row}>
            <div className={styles.actions}>
              <span className={styles.label}>{entry.phrase}</span>
              <Button
                variant="secondary"
                busy={busy === entry.id}
                aria-label={`Remove ${entry.phrase}`}
                onClick={() => void remove(entry.id)}
              >
                Remove
              </Button>
            </div>
            {rowErrors[entry.id] ? <Callout tone="error">{rowErrors[entry.id]}</Callout> : null}
          </li>
        ))}
      </ul>
    </section>
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
