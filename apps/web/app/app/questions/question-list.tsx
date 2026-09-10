'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import type { OwnerQuestion } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import styles from './questions.module.css';

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * What customers actually ask, most asked first.
 *
 * Presentational, the same split as `ReviewQueue`, `ClaimForm` and
 * `IngestForm`: it takes the rows and one mutation function, and owns nothing
 * but how a row responds. `Questions` below supplies the real one.
 *
 * `editing` is the id of the question whose answer box is open -- at most one
 * at a time, because this screen has one primary action and two open boxes
 * would be two.
 *
 * `draft` survives a failed save. This is one of the two places FRONTEND.md
 * says a human writes real prose, and the fact editor already learned what
 * throwing that away costs: the owner retypes from memory.
 */
export function QuestionList({
  questions,
  onAnswer,
}: {
  questions: OwnerQuestion[];
  onAnswer: (id: string, answer: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (questions.length === 0) {
    // An instruction, not a mood.
    return (
      <Callout tone="info">
        No questions yet. Share your link and they will show up here as people ask.
      </Callout>
    );
  }

  async function save(id: string) {
    if (busy || draft.trim() === '') return;

    setError('');
    setBusy(true);
    try {
      await onAnswer(id, draft.trim());
      setEditing(null);
      setDraft('');
    } catch (failure) {
      // The draft is untouched by this path on purpose -- see the class
      // comment. Only a success clears it.
      setError(toMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className={styles.list}>
      {questions.map((question) => (
        <li key={question.id} className={styles.item}>
          <p className={styles.count}>
            Asked {question.askCount}×{question.answered ? ' · Answered' : ''}
          </p>
          <p className={styles.question}>{question.text}</p>

          {editing === question.id ? (
            <>
              <Field
                id={`answer-${question.id}`}
                label="Answer"
                multiline
                hint="This exact wording is what the next person asking will see."
                value={draft}
                onChange={setDraft}
              />

              {error ? <Callout tone="error">{error}</Callout> : null}

              <div className={styles.actions}>
                <Button busy={busy} onClick={() => void save(question.id)}>
                  Save
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    setDraft('');
                    setError('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : question.answered ? null : (
            <div className={styles.actions}>
              <Button
                onClick={() => {
                  setEditing(question.id);
                  setDraft('');
                  setError('');
                }}
              >
                Answer this
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Supplies the real mutation. Thin on purpose, the same shape as `Review` and
 * `Claim`: a Server Component may not hand a closure across the RSC boundary,
 * so `page.tsx` passes plain rows and the closure over `apiFetch` is built
 * here, on the client side of it.
 */
export function Questions({ questions }: { questions: OwnerQuestion[] }) {
  const router = useRouter();

  return (
    <QuestionList
      questions={questions}
      onAnswer={async (id, answer) => {
        await apiFetch(`/questions/${id}/answer`, {
          method: 'POST',
          body: JSON.stringify({ answer }),
        });
        // Re-reads the Server Component, so the row comes back marked
        // answered rather than the screen guessing locally.
        router.refresh();
      }}
    />
  );
}
