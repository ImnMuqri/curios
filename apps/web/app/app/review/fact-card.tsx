'use client';

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
 * that test actually fails when the rule is broken.
 *
 * `onAccept`/`onEdit`/`onReject` are plain, synchronous-looking callbacks
 * (`void`-returning) on purpose: this component does not know or care
 * whether the mutation behind them succeeds. `ReviewQueue` owns that --
 * whether the card leaves, stays with a corrected claim, or shows an error is
 * entirely its call, made after the fact.
 */
export function FactCard({
  fact,
  onAccept,
  onEdit,
  onReject,
  error,
}: {
  fact: ReviewFact;
  onAccept: (id: string) => void;
  onEdit: (id: string, claim: string) => void;
  onReject: (id: string) => void;
  error?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.claim);

  if (editing) {
    return (
      <article>
        <p>{fact.category}</p>

        <label htmlFor={`claim-${fact.id}`}>Claim</label>
        <textarea
          id={`claim-${fact.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />

        {error ? <p role="alert">{error}</p> : null}

        <button
          type="button"
          onClick={() => {
            onEdit(fact.id, draft);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(fact.claim);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </article>
    );
  }

  return (
    <article>
      <p>{fact.category}</p>
      <p>{fact.claim}</p>

      {/* FRONTEND.md: "the line it came from, for the review screen" --
          without it the owner is asked to approve a claim with no way to
          check it against anything. */}
      {fact.sourceText ? <p>{fact.sourceText}</p> : null}
      {/* FRONTEND.md: "numbers link to their source; an unverifiable metric
          is decoration". */}
      {fact.sourceUrl ? <a href={fact.sourceUrl}>Source</a> : null}

      {error ? <p role="alert">{error}</p> : null}

      <button type="button" onClick={() => onAccept(fact.id)}>
        Accept
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(fact.claim);
          setEditing(true);
        }}
      >
        Edit
      </button>
      <button type="button" onClick={() => onReject(fact.id)}>
        Reject
      </button>
    </article>
  );
}
