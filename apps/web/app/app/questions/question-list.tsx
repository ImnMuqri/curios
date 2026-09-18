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
  publishesFaq,
  onAnswer,
  onSuppress,
  onDelete,
}: {
  questions: OwnerQuestion[];
  /**
   * Whether saving an answer can publish it at /faq. False for a personal
   * page, which never gets FAQ pages -- see qualifiesForFaq in @curios/core.
   */
  publishesFaq: boolean;
  onAnswer: (id: string, answer: string) => Promise<void>;
  onSuppress: (id: string, suppressed: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** The id whose delete prompt is open. At most one, like `editing`. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /**
   * Which row `error` belongs to. `error` is shared, and without this a
   * failure on one row renders its message under every other row too -- two
   * alerts for one failure, on rows the owner never touched.
   */
  const [errorFor, setErrorFor] = useState<string | null>(null);

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
    setErrorFor(id);
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

  async function run(id: string, work: () => Promise<void>) {
    if (busy) return;
    setError('');
    setErrorFor(id);
    setBusy(true);
    try {
      await work();
      setConfirming(null);
    } catch (failure) {
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
            {question.faqSlug ? (question.faqSuppressed ? ' · Hidden from /faq' : ' · Live on /faq') : ''}
          </p>
          <p className={styles.question}>{question.text}</p>

          {editing === question.id ? (
            <>
              <Field
                id={`answer-${question.id}`}
                label="Answer"
                multiline
                hint={
                  publishesFaq
                    ? 'Asked 3 or more times? Saving this also publishes the question and your answer at /faq, where search engines can find them.'
                    : 'Saving this lets your page answer the question the way you wrote it.'
                }
                value={draft}
                onChange={setDraft}
              />

              {error && errorFor === question.id ? (
                <Callout tone="error">{error}</Callout>
              ) : null}

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
          ) : confirming === question.id ? (
            <>
              <Callout tone="action">
                Delete this question and your answer? A customer wrote these words, and this
                cannot be undone.
              </Callout>
              {error && errorFor === question.id ? (
                <Callout tone="error">{error}</Callout>
              ) : null}
              <div className={styles.actions}>
                <Button
                  variant="danger"
                  busy={busy}
                  onClick={() => void run(question.id, () => onDelete(question.id))}
                >
                  Delete it
                </Button>
                {/* Disabled while busy, not merely styled so. Slice 5 shipped
                    exactly this bug on the leads screen: closing the prompt
                    mid-request does not cancel the request, and the row
                    vanishes anyway. */}
                <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                  Keep it
                </Button>
              </div>
            </>
          ) : question.answered ? (
            <>
              {error && errorFor === question.id ? (
                <Callout tone="error">{error}</Callout>
              ) : null}
              <div className={styles.actions}>
                {/* Prefilled from what they wrote, not blank: the likeliest
                    reason to reopen a published answer is that a word in it is
                    wrong, and retyping the rest from memory to fix one is how
                    a second mistake gets made. */}
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(question.id);
                    setDraft(question.answer ?? '');
                    setError('');
                  }}
                >
                  Edit answer
                </Button>
                {question.faqSlug ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(question.id, () => onSuppress(question.id, !question.faqSuppressed))
                    }
                  >
                    {question.faqSuppressed ? 'Show on /faq again' : 'Hide from /faq'}
                  </Button>
                ) : null}
                <Button variant="secondary" disabled={busy} onClick={() => setConfirming(question.id)}>
                  Delete
                </Button>
              </div>
            </>
          ) : (
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
export function Questions({
  questions,
  publishesFaq,
}: {
  questions: OwnerQuestion[];
  publishesFaq: boolean;
}) {
  const router = useRouter();

  return (
    <QuestionList
      questions={questions}
      publishesFaq={publishesFaq}
      onAnswer={async (id, answer) => {
        await apiFetch(`/questions/${id}/answer`, {
          method: 'POST',
          body: JSON.stringify({ answer }),
        });
        // Re-reads the Server Component, so the row comes back marked
        // answered rather than the screen guessing locally.
        router.refresh();
      }}
      onSuppress={async (id, suppressed) => {
        await apiFetch(`/questions/${id}/suppress`, {
          method: 'POST',
          body: JSON.stringify({ suppressed }),
        });
        router.refresh();
      }}
      onDelete={async (id) => {
        await apiFetch(`/questions/${id}`, { method: 'DELETE' });
        router.refresh();
      }}
    />
  );
}
