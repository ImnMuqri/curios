'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewFact } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { FactCard } from './fact-card.js';

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * The review queue, presentational -- the same split as `ClaimForm` and
 * `IngestForm`. Takes `facts` plus the three mutation functions and owns
 * everything about how a card responds to them:
 *
 * - `acted` is the set of ids that have been accepted or rejected. The
 *   visible list is `facts.filter(f => !acted.has(f.id))`, computed fresh on
 *   every render from the `facts` prop -- never copied into state -- so that
 *   a refresh bringing genuinely new data is not fought by stale state (A2).
 * - `edits` holds a per-id claim override so an edited card shows the
 *   corrected text immediately, without waiting on a refresh to bring it
 *   back from the server.
 * - `errors` holds a per-id message, rendered on the card that failed.
 *
 * `onChanged` replaces a direct `useRouter()` call here (A6/F3): this was the
 * only presentational half in the repo reaching for the framework and firing
 * a page-level refetch as a consequence of its own local state. It is called
 * in exactly the three places `router.refresh()` used to be -- after every
 * successful accept, reject and edit -- so "a success always tells the
 * server side to re-read" stays a structural property of this component,
 * provable with a plain spy rather than a `vi.mock('next/navigation')`. See
 * `Review` below, which supplies the real `() => router.refresh()`.
 *
 * `handleEdit` returns `Promise<boolean>` -- `true` only when the claim was
 * actually saved -- and is the only one of the three local handlers whose
 * caller (`FactCard`) needs an outcome. `handleAccept`/`handleReject` stay
 * `Promise<void>`: a success removes the card and a failure renders on it,
 * so there is nothing further for the caller to decide (F2/A5).
 */
export function ReviewQueue({
  facts,
  onAccept,
  onEdit,
  onReject,
  onChanged,
}: {
  facts: ReviewFact[];
  onAccept: (id: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [acted, setActed] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleAccept(id: string) {
    try {
      await onAccept(id);
      setActed((prev) => new Set(prev).add(id));
      onChanged();
    } catch (failure) {
      setErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
    }
  }

  async function handleReject(id: string) {
    try {
      await onReject(id);
      setActed((prev) => new Set(prev).add(id));
      onChanged();
    } catch (failure) {
      setErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
    }
  }

  async function handleEdit(id: string, claim: string): Promise<boolean> {
    try {
      await onEdit(id, claim);
      // Per A3: `editFact` leaves `verified: false`. The fact is still
      // unreviewed, so it stays in the queue -- only the claim it shows
      // changes. Accept and Reject remove the card; Edit updates it in
      // place. If this ever removes the card, the hard rule has a side door.
      setEdits((prev) => ({ ...prev, [id]: claim }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      onChanged();
      return true;
    } catch (failure) {
      // Recorded here, not thrown -- `FactCard` awaits this and keeps its
      // textarea open with the owner's draft intact on `false` (F2/A5).
      // A rethrow would mean the same failure is both handled here and
      // thrown at the caller, which is an unhandled rejection for the next
      // person who calls `onEdit`.
      setErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
      return false;
    }
  }

  const visible = facts.filter((fact) => !acted.has(fact.id));

  if (visible.length === 0) {
    // An instruction, not a mood.
    return <p>Nothing left to review. Publish when you are ready.</p>;
  }

  return (
    <div>
      {visible.map((fact) => {
        const editedClaim = edits[fact.id];
        return (
          <FactCard
            key={fact.id}
            fact={editedClaim === undefined ? fact : { ...fact, claim: editedClaim }}
            onAccept={(id) => handleAccept(id)}
            onEdit={(id, claim) => handleEdit(id, claim)}
            onReject={(id) => handleReject(id)}
            error={errors[fact.id]}
          />
        );
      })}
    </div>
  );
}

/**
 * Supplies the real `apiFetch` closures, and the one real `onChanged`:
 * `router.refresh()`. Thin on purpose, same shape as `Claim` in
 * `claim-form.tsx` and `Ingest` in `ingest-form.tsx`: a Server Component
 * cannot hand a function to a Client Component, so `page.tsx` passes only
 * `ReviewFact[]` -- strings, nulls and a number -- and the closures over
 * `apiFetch` are built here, entirely on the client side of that boundary.
 */
export function Review({ facts }: { facts: ReviewFact[] }) {
  const router = useRouter();

  return (
    <ReviewQueue
      facts={facts}
      onAccept={async (id) => {
        await apiFetch(`/facts/${id}/verify`, { method: 'POST' });
      }}
      onEdit={async (id, claim) => {
        await apiFetch(`/facts/${id}`, { method: 'PATCH', body: JSON.stringify({ claim }) });
      }}
      onReject={async (id) => {
        await apiFetch(`/facts/${id}/reject`, { method: 'POST' });
      }}
      onChanged={() => router.refresh()}
    />
  );
}
