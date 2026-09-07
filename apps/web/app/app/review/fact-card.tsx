'use client';

import { Button, Callout, Field } from '@curios/ui';
import styles from './review.module.css';
import { useState } from 'react';
import type { ReviewFact } from '@curios/db-read';

/**
 * One fact, and the three things an owner can do to it: accept it as
 * written, correct the claim, or reject it.
 *
 * There is no fourth control and there must never be. The product's single
 * hard rule is that nothing sets `verified: true` except an explicit human
 * action on one specific fact -- no select-all, no accept-remaining, no
 * confidence threshold -- and this card is the surface that would carry a
 * violation if one were ever added. See "offers no control that acts on more
 * than this fact" in fact-card.test.tsx, and Step 3 of the task, which proves
 * that test actually fails when the rule is broken. The same guard is
 * mirrored one level up, in review-queue.test.tsx, because `ReviewQueue` --
 * not this card -- is where a bulk control would actually be added (A4/F1):
 * it already owns the full list and a per-id handler, and this card cannot
 * see that container's own markup to catch a violation added there.
 *
 * `onAccept`/`onReject` resolve to `Promise<void>`; `onEdit` resolves to
 * `Promise<boolean>` -- `true` only when the claim was actually saved. This
 * card awaits all three, for two reasons:
 *
 * 1. A local `busy` state, so Accept, Edit, Reject and Save are disabled
 *    while a mutation is in flight -- matching `ClaimForm`/`IngestForm`/
 *    `SignInForm` -- and a double-tap on Save cannot fire two overlapping
 *    PATCHes where the later-resolving one wins the displayed claim.
 * 2. For Edit specifically, the textarea and the owner's typed draft stay
 *    exactly as they were until `onEdit` resolves `true`. `FACT_DUPLICATE`
 *    is a normal outcome, not a crash, and this is the one screen in the
 *    product where a human writes prose: closing the textarea on a failed
 *    edit (as this used to) throws that prose away and leaves the owner to
 *    retype it from memory (A5).
 *
 * This card still does not know or care *why* a mutation succeeds or fails --
 * `ReviewQueue` is the single place that turns a failure into a rendered
 * `error` message. A boolean outcome from `onEdit`, rather than letting a
 * rejection propagate here, keeps that true: a rethrow would mean the same
 * failure is both handled in `ReviewQueue` and thrown again here.
 */
export function FactCard({
  fact,
  onAccept,
  onEdit,
  onReject,
  error,
}: {
  fact: ReviewFact;
  onAccept: (id: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<boolean>;
  onReject: (id: string) => Promise<void>;
  error?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.claim);
  const [busy, setBusy] = useState(false);

  // All three catch and use `finally`, rather than a bare pair of calls.
  // `ReviewQueue` handles its own failures, so none of these can reject
  // today -- but this card is exported and rendered independently, and a
  // handler that rejected would leave `busy` stuck true: every control on
  // the card disabled, no recourse but a page reload, on the one screen
  // where that is least affordable. See "leaves the card usable if a handler
  // rejects".
  //
  // The catch is empty ON PURPOSE and is not swallowing anything a user
  // would otherwise see. Rendering a failure is `ReviewQueue`'s single
  // responsibility, per the class comment above; the only caller this could
  // hide something from is one that both rejects AND renders nothing, which
  // is the same caller this guard exists to survive. Rethrowing instead
  // would reach `void handleAccept()` at the call site as an unhandled
  // rejection -- and an intermittent unhandled rejection is how a mystery CI
  // failure starts.
  async function handleAccept() {
    setBusy(true);
    try {
      await onAccept(fact.id);
    } catch {
      // See above.
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      await onReject(fact.id);
    } catch {
      // See above.
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    let saved = false;
    try {
      saved = await onEdit(fact.id, draft);
    } catch {
      // See above. `saved` stays false, so the draft survives a rejection
      // exactly as it survives a `false`.
    } finally {
      setBusy(false);
    }
    // Only a successful save closes the textarea -- see the class comment
    // and A5. On `false`, `draft` (already in local state, untouched by any
    // of this) stays exactly what the owner typed. A rejection leaves
    // `saved` false, so the draft survives that too.
    if (saved) setEditing(false);
  }

  if (editing) {
    return (
      <article className={styles.card}>
        <p className={styles.category}>{fact.category}</p>

        <Field
          id={`claim-${fact.id}`}
          label="Claim"
          multiline
          value={draft}
          onChange={setDraft}
        />

        {error ? <Callout tone="error">{error}</Callout> : null}

        <div className={styles.actions}>
          <Button busy={busy} onClick={() => void handleSave()}>
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(fact.claim);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article className={styles.card}>
      <p className={styles.category}>{fact.category}</p>
      {/* The question above the claim that answers it: the owner is verifying
          the pair, because the pair is what reaches a customer together. */}
      {fact.question ? <p className={styles.question}>{fact.question}</p> : null}
      <p className={styles.claim}>{fact.claim}</p>

      {/* FRONTEND.md: "the line it came from, for the review screen" --
          without it the owner is asked to approve a claim with no way to
          check it against anything. */}
      {fact.sourceText ? <p className={styles.source}>{fact.sourceText}</p> : null}
      {/* FRONTEND.md: "numbers link to their source; an unverifiable metric
          is decoration". */}
      {fact.sourceUrl ? (
        <a className={styles.sourceLink} href={fact.sourceUrl}>
          Source
        </a>
      ) : null}

      {error ? <Callout tone="error">{error}</Callout> : null}

      <div className={styles.actions}>
        <Button busy={busy} onClick={() => void handleAccept()}>
          Accept
        </Button>
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => {
            setDraft(fact.claim);
            setEditing(true);
          }}
        >
          Edit
        </Button>
        {/* merah, because rejection is the destructive action on this screen
            and that is the only thing merah is for. */}
        <Button variant="danger" busy={busy} onClick={() => void handleReject()}>
          Reject
        </Button>
      </div>
    </article>
  );
}
