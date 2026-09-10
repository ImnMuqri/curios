'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout } from '@curios/ui';
import type { OwnerLead } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import styles from './leads.module.css';

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

function statusLabel(status: OwnerLead['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatDate(value: Date): string {
  // `LeadList` is a client component that renders once on the server -- UTC
  // in production -- and again on hydration, in the browser's own zone. Left
  // unpinned, those two passes read `createdAt` against different clocks: a
  // lead captured at 00:30 in Malaysia is still 16:30 the day before in UTC,
  // so the server would print one date and the browser another -- a
  // hydration mismatch and a wrong date on screen until React corrects it.
  // Curios only serves Malaysian pages, so the fix is to pin the zone rather
  // than pick one dynamically. This is the only `toLocaleDateString`/`Intl`
  // call in the repo, so it is setting the convention, not following one.
  return value.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

/**
 * Every number a page has captured, and the conversation behind each one.
 *
 * Presentational, the same split as `ReviewQueue` and `QuestionList`: it
 * takes the rows plus one mutation function and owns nothing but how a row
 * responds. `Leads` below supplies the real one.
 *
 * `open` is the id whose transcript is showing -- at most one, because this
 * is a list for scanning phone numbers, and a dozen transcripts open at once
 * stops being a list. `confirming` is the id awaiting the delete prompt --
 * also at most one, for the same reason `editing` is single-valued in
 * `QuestionList`. `error` and `busy` are global rather than per-id because
 * only one confirmation can be open to begin with.
 *
 * Deleting is the only irreversible action on this screen: a phone number
 * gone is gone, unlike an answer or a fact that can be rewritten. So Delete
 * does not fire on the first tap -- it swaps for a "Yes, delete" / "Cancel"
 * pair, the same two-step FactCard never needed for Reject because a
 * rejected fact was never the record of anything. `<Button variant="danger">`
 * marks it merah, the second control in the product to earn that colour
 * after Reject.
 */
export function LeadList({
  leads,
  onDelete,
}: {
  leads: OwnerLead[];
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (leads.length === 0) {
    // An instruction, not a mood. FRONTEND.md's own wording, verbatim.
    return (
      <Callout tone="info">No leads yet. Share your link and they will land here.</Callout>
    );
  }

  async function handleDelete(id: string) {
    if (busy) return;

    setError('');
    setBusy(true);
    try {
      await onDelete(id);
      // Only a success dismisses the prompt. A failure leaves it open with
      // the error on it, so a retry is one tap away rather than a walk back
      // through Delete -> confirm.
      setConfirming(null);
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className={styles.list}>
      {leads.map((lead) => {
        // BACKEND.md's own labels for the three slots, unchanged from the
        // owner notification -- an owner who has seen one has seen the
        // other, and a second vocabulary for the same three facts would be
        // a new thing to learn for no reason.
        const known = [
          lead.slots?.product ? `Product: ${lead.slots.product}` : null,
          lead.slots?.date ? `When: ${lead.slots.date}` : null,
          lead.slots?.location ? `Where: ${lead.slots.location}` : null,
        ].filter((line): line is string => line !== null);

        // wa.me refuses a plus and refuses separators -- the same rule
        // apps/workers/src/leads/notify.ts learned building the email link.
        // A link carrying a plus opens WhatsApp on a broken number.
        const waNumber = lead.phone.replace(/\D/g, '');

        return (
          <li key={lead.id} className={styles.item}>
            <p className={styles.meta}>
              Score {lead.score} · {statusLabel(lead.status)} · {formatDate(lead.createdAt)}
            </p>
            <p className={styles.phone}>{lead.phone}</p>

            {/* Null when the extraction job never ran or failed -- slice 4
                deliberately allows that. A screen that needed slots to
                render would lose the lead entirely over a job it did not
                run. */}
            {known.length > 0 ? (
              <ul className={styles.slots}>
                {known.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}

            <div className={styles.actions}>
              {/* FRONTEND.md: "Leads has 'WhatsApp them'" -- the one primary
                  action this screen offers, styled to match, but an anchor
                  rather than a Button because Button renders only <button>
                  and this has to be a real link a screen reader announces as
                  one. */}
              <a
                className={styles.whatsapp}
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp them
              </a>
              <Button variant="secondary" onClick={() => setOpen(open === lead.id ? null : lead.id)}>
                {open === lead.id ? 'Hide transcript' : 'Show transcript'}
              </Button>
              {confirming === lead.id ? null : (
                <Button
                  variant="danger"
                  // Shut while another row's delete is in flight. `error` and
                  // `busy` are shared, so a second prompt opened mid-request
                  // would be the one on screen when the answer arrives -- and
                  // an owner would be told a lead they never touched had
                  // failed, or watch their prompt close on someone else's
                  // success.
                  disabled={busy}
                  onClick={() => {
                    setConfirming(lead.id);
                    setError('');
                  }}
                >
                  Delete
                </Button>
              )}
            </div>

            {confirming === lead.id ? (
              <div className={styles.confirm}>
                <p className={styles.confirmText}>Delete this lead? This cannot be undone.</p>
                {error ? <Callout tone="error">{error}</Callout> : null}
                <div className={styles.actions}>
                  <Button variant="danger" busy={busy} onClick={() => void handleDelete(lead.id)}>
                    Yes, delete
                  </Button>
                  <Button
                    variant="secondary"
                    // The two-step confirm exists because a phone number gone
                    // is gone. If Cancel stays live while `busy` is true, a
                    // tap on it after "Yes, delete" hides this panel while
                    // the DELETE already in flight still lands -- the row is
                    // still gone on refresh, and a failure has nowhere left
                    // to render its error. A Cancel that does not cancel is
                    // that guarantee broken.
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null);
                      setError('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {open === lead.id ? (
              <ul className={styles.transcript}>
                {lead.transcript.map((line, index) => (
                  <li
                    key={index}
                    className={line.role === 'USER' ? styles.fromCustomer : styles.fromOwner}
                  >
                    {line.content}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Supplies the real mutation. Thin on purpose, the same shape as `Review`
 * and `Questions`: a Server Component may not hand a closure across the RSC
 * boundary, so `page.tsx` passes plain rows and the closure over `apiFetch`
 * is built here, on the client side of it.
 *
 * `DELETE /leads/:id` takes no body. There is nothing in the response worth
 * reading -- the id being gone is the whole result -- so this discards it
 * and refreshes instead of trying to reconcile a partial row locally.
 */
export function Leads({ leads }: { leads: OwnerLead[] }) {
  const router = useRouter();

  return (
    <LeadList
      leads={leads}
      onDelete={async (id) => {
        await apiFetch(`/leads/${id}`, { method: 'DELETE' });
        // Re-reads the Server Component, so a deleted lead is actually gone
        // from the list rather than the screen guessing locally that it is.
        router.refresh();
      }}
    />
  );
}
