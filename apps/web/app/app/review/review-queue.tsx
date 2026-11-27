'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewFact } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { FactCard } from './fact-card.js';
import styles from './review.module.css';

type Kind = 'accept' | 'reject';

interface Done {
  id: string;
  kind: Kind;
  claim: string;
}

/** How long a card takes to fly off, matching the transition in review.module.css. */
const LEAVE_MS = 560;

/** The "Done" list shows the last few decisions; the count beside it is all of them. */
const DONE_SHOWN = 3;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Where a card goes when it is accepted or rejected: off to the right or the left, tilted. */
function leavingStyle(leaving: Kind | null): CSSProperties | undefined {
  if (leaving === 'accept') return { transform: 'translateX(115%) rotate(10deg)', opacity: 0 };
  if (leaving === 'reject') return { transform: 'translateX(-115%) rotate(-10deg)', opacity: 0 };
  return undefined;
}

/**
 * The review queue, presentational. Takes `facts` plus the three mutation
 * functions and owns everything about how the card responds to them:
 *
 * - `acted` is the set of ids that have been accepted or rejected. The
 *   visible queue is `facts.filter(f => !acted.has(f.id))`, computed fresh on
 *   every render from the `facts` prop -- never copied into state -- so that
 *   a refresh bringing genuinely new data is not fought by stale state (A2).
 * - `skipped` is the ids put off this session, in the order they were put
 *   off. Skip does not touch the fact: it only moves the card behind every
 *   fact not yet skipped, so it comes back once the others are checked. It
 *   lives here, not in the database, because the board's Skip is "later, in
 *   this sitting" and a fact nobody has decided on is still waiting after a
 *   reload, in the same order as before.
 * - `edits` holds a per-id claim override so an edited card shows the
 *   corrected text immediately, without waiting on a refresh.
 * - `errors` holds a per-id message, rendered on the card that failed.
 * - `log` is this session's accepts and rejects, newest first, for the
 *   progress line and the Done list.
 *
 * One fact at a time, on purpose: only the card on top is drawn. A card
 * accepted or rejected flies off (stamped), then leaves; `onChanged` fires
 * once it has gone, so the refresh it causes cannot pull the card out from
 * under its own animation. `onChanged` also fires after every saved edit.
 * See `Review` below, which supplies `() => router.refresh()`.
 *
 * `pending` is how many facts were waiting when the screen loaded, which can
 * be more than `facts` (the read is bounded), so the progress line counts
 * the real queue.
 */
export function ReviewQueue({
  facts,
  onAccept,
  onEdit,
  onReject,
  onChanged,
  pending = facts.length,
  published = true,
  head,
  footer,
}: {
  facts: ReviewFact[];
  onAccept: (id: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onChanged: () => void;
  pending?: number;
  published?: boolean;
  /** The screen's header (PageHead), at the top of the column. */
  head?: ReactNode;
  /** Under the header: whether the page is live, and Publish while it is not. */
  footer?: ReactNode;
}) {
  const [acted, setActed] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [log, setLog] = useState<Done[]>([]);
  const [leaving, setLeaving] = useState<{ id: string; kind: Kind } | null>(null);
  const [said, setSaid] = useState('');
  const [startTotal] = useState(() => Math.max(pending, facts.length));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const deck = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const waiting = facts.filter((fact) => !acted.has(fact.id));
  // Not yet put off first, in the order they came; then the ones put off, the longest ago first.
  const visible = [
    ...waiting.filter((fact) => !skipped.includes(fact.id)),
    ...skipped.flatMap((id) => waiting.filter((fact) => fact.id === id)),
  ];
  const claimOf = (fact: ReviewFact) => edits[fact.id] ?? fact.claim;
  const total = Math.max(startTotal, log.length + visible.length);
  const remaining = total - log.length;

  function settle(fact: ReviewFact, kind: Kind) {
    const keepFocus = deck.current?.contains(document.activeElement) ?? false;
    setActed((prev) => new Set(prev).add(fact.id));
    setLog((prev) => [{ id: fact.id, kind, claim: claimOf(fact) }, ...prev]);
    setLeaving(null);
    const left = remaining - 1;
    setSaid(`${kind === 'accept' ? 'Accepted' : 'Rejected'}. ${left > 0 ? `${plural(left, 'fact')} to check.` : 'Nothing left to review.'}`);
    onChanged();
    // The button that was pressed has gone with its card; the next card
    // takes the focus rather than leaving it on the page itself.
    if (keepFocus) {
      requestAnimationFrame(() => deck.current?.querySelector<HTMLElement>('article')?.focus());
    }
  }

  function clearError(id: string) {
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function act(fact: ReviewFact, kind: Kind) {
    clearError(fact.id);
    try {
      await (kind === 'accept' ? onAccept(fact.id) : onReject(fact.id));
    } catch (failure) {
      setErrors((prev) => ({ ...prev, [fact.id]: toMessage(failure) }));
      return;
    }
    if (reducedMotion()) {
      settle(fact, kind);
      return;
    }
    setLeaving({ id: fact.id, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => settle(fact, kind), LEAVE_MS);
  }

  function skip(id: string) {
    // Nothing is sent: the fact stays exactly as it was, waiting. It goes behind the others.
    const keepFocus = deck.current?.contains(document.activeElement) ?? false;
    setSkipped((prev) => [...prev.filter((other) => other !== id), id]);
    clearError(id);
    // Names the fact now on top, so two skips in a row do not announce the same words.
    const next = visible.find((fact) => fact.id !== id);
    setSaid(`Skipped. It comes back later.${next ? ` Next: ${claimOf(next)}.` : ''} ${plural(remaining, 'fact')} to check.`);
    if (keepFocus) {
      requestAnimationFrame(() => deck.current?.querySelector<HTMLElement>('article')?.focus());
    }
  }

  async function handleEdit(id: string, claim: string): Promise<boolean> {
    clearError(id);
    try {
      await onEdit(id, claim);
      // Per A3: `editFact` leaves `verified: false`. The fact is still
      // unreviewed, so it stays in the queue -- only the claim it shows
      // changes. Accept and Reject remove the card; Fix it updates it in
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
      // Recorded here, not thrown -- `FactCard` keeps its textarea open with
      // the owner's draft intact on `false` (F2/A5).
      setErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
      return false;
    }
  }

  const top = visible[0];
  const fresh = startTotal === 0 && log.length === 0 && visible.length === 0;
  const upNext = visible.slice(1, 3);
  const allChecked = visible.length === 0 && remaining <= 0;
  // The all-done card shows; on a page not public yet it carries Publish instead of the header.
  const publishInDone = Boolean(footer) && allChecked && !fresh && !published;

  return (
    <div className={styles.rv}>
      {head ? <div className={styles.head}>{head}</div> : null}
      {/* At the top, under the header, with the screen's other notices (owner, 24 Nov 2026: the
          side panel is gone). Publish stays here, whatever the queue holds. */}
      {/* Once the queue is done on a page that is not public yet, Publish moves into the all-done
          card as its one action, so it is the next thing the owner sees (owner, 28 Nov 2026). */}
      {footer && !publishInDone ? <div className={styles.golive}>{footer}</div> : null}

      {/* Nothing to count before any fact arrives, or once all are checked: the heading says so. */}
      {fresh || allChecked ? null : (
        <div className={styles.prog}>
          <span>
            <b>{remaining > 0 ? `${remaining} left` : 'All checked'}</b>
            {remaining > 0 ? ' to check' : ''}
          </span>
          <i role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={log.length} aria-label={`${log.length} of ${total} checked`}>
            <span style={{ width: `${total ? (log.length / total) * 100 : 0}%` }} />
          </i>
          <small>
            {log.length} of {total} done
          </small>
        </div>
      )}

      {top ? (
        <div className={styles.rv2}>
          <div className={styles.deck} ref={deck}>
            <FactCard
              key={top.id}
              fact={{ ...top, claim: claimOf(top) }}
              edited={edits[top.id] !== undefined && edits[top.id] !== top.claim}
              leaving={leaving?.id === top.id ? leaving.kind : null}
              style={leavingStyle(leaving?.id === top.id ? leaving.kind : null)}
              onAccept={() => act(top, 'accept')}
              onReject={() => act(top, 'reject')}
              onEdit={handleEdit}
              onSkip={skip}
              canSkip={visible.length > 1}
              error={errors[top.id]}
            />
          </div>

          {upNext.length > 0 || log.length > 0 ? (
          <aside className={styles.side} aria-label="Up next and done">
            {upNext.length > 0 ? (
              <>
                <p className={styles.sh}>
                  Up next <u>{Math.max(remaining - 1, upNext.length)}</u>
                </p>
                {upNext.map((fact, i) => (
                  <div className={styles.mini} key={fact.id}>
                    <small>{i === 0 ? 'Next' : 'Then'}</small>
                    <b>{claimOf(fact)}</b>
                  </div>
                ))}
              </>
            ) : null}
            {log.length > 0 ? (
              <>
                <p className={styles.sh}>
                  Done <u>{log.length}</u>
                </p>
                {log.slice(0, DONE_SHOWN).map((entry) => (
                  <div className={`${styles.mini} ${styles.dim}`} key={entry.id} data-kind={entry.kind}>
                    <small>{entry.kind === 'accept' ? 'Accepted' : 'Rejected'}</small>
                    <b>{entry.claim}</b>
                  </div>
                ))}
              </>
            ) : null}
          </aside>
          ) : null}
        </div>
      ) : fresh ? (
        <div className={styles.esCard}>
          <div className={styles.es}>
            <div className={styles.esArt} aria-hidden="true">
              <div className={styles.esRows}>
                <span data-tone="hijau">
                  <i />
                  <b />
                  <em />
                </span>
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
              </div>
              <span className={styles.esBadge}>
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            </div>
            <h2>Nothing to review yet</h2>
            <p>Add your website, your Instagram or a few honest paragraphs. Every fact Curios finds waits here until you accept it, one at a time.</p>
            <div className={styles.esActs}>
              <a className={styles.prim} href="/app/knowledge?tab=sources&add=1">
                Add a source
              </a>
              <a className={styles.btn2} href="/app/knowledge?tab=facts&add=1">
                Write a fact yourself
              </a>
            </div>
          </div>
        </div>
      ) : remaining > 0 ? (
        // More were waiting than one read brings; the refresh after the
        // last card brings the next ones.
        <p className={styles.rule}>Bringing up the next facts…</p>
      ) : (
        <div className={styles.alldone}>
          <div className={styles.burst} aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} data-tone={i % 4} style={{ '--a': `${i * 30}deg`, animationDelay: `${150 + (i % 3) * 40}ms` } as CSSProperties} />
            ))}
            <svg viewBox="0 0 110 110" width="110" height="110">
              <circle cx="55" cy="55" r="40" />
              <path d="M37 56l12 12 25-26" />
            </svg>
          </div>
          <h2>Nothing left to review</h2>
          <p>{published ? 'Everything you accepted is already live on your page.' : 'Last step: publish your page so visitors can see it.'}</p>
          {publishInDone ? (
            <div className={`${styles.golive} ${styles.doneLive}`}>{footer}</div>
          ) : (
            <a className={styles.btn2} href="/app/knowledge?tab=facts">
              See your facts
            </a>
          )}
        </div>
      )}

      <p className={styles.sr} role="status">
        {said}
      </p>
    </div>
  );
}

/**
 * Supplies the real `apiFetch` closures, and the one real `onChanged`:
 * `router.refresh()`. Thin on purpose, same shape as `Claim` and `Ingest`: a
 * Server Component cannot hand a function to a Client Component, so
 * `page.tsx` passes only plain data, and the closures over `apiFetch` are
 * built here, entirely on the client side of that boundary.
 */
export function Review({
  facts,
  pending,
  published,
  head,
  footer,
}: {
  facts: ReviewFact[];
  pending: number;
  published: boolean;
  head?: ReactNode;
  footer?: ReactNode;
}) {
  const router = useRouter();

  return (
    <ReviewQueue
      facts={facts}
      pending={pending}
      published={published}
      head={head}
      footer={footer}
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
