'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewFact } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { themeAttrs } from '../../_bento/BentoPage.js';
import bento from '../../_bento/Bento.module.css';
import { FactCard } from './fact-card.js';
import styles from './review.module.css';

/** The page's colours, for the chat preview. */
export type ChatLook = Parameters<typeof themeAttrs>[0];

type Kind = 'accept' | 'reject';

interface Done {
  id: string;
  kind: Kind;
  claim: string;
}

/** How long a card takes to fly off the stack, matching the transition in review.module.css. */
const LEAVE_MS = 560;

/** Past this many facts, the progress line is one bar rather than a segment each. */
const MAX_SEGMENTS = 24;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Where a card sits in the stack: the top one flat, each one behind a step lower and smaller. */
function placement(index: number, leaving: Kind | null): CSSProperties {
  let transform = `translateY(${index * 16}px) scale(${1 - index * 0.04})`;
  if (leaving === 'accept') transform = 'translateX(115%) rotate(10deg)';
  if (leaving === 'reject') transform = 'translateX(-115%) rotate(-10deg)';
  return { zIndex: 10 - index, transform, opacity: leaving ? 0 : index === 2 ? 0.6 : 1 };
}

/**
 * The review queue, presentational. Takes `facts` plus the three mutation
 * functions and owns everything about how the stack responds to them:
 *
 * - `acted` is the set of ids that have been accepted or rejected. The
 *   visible stack is `facts.filter(f => !acted.has(f.id))`, computed fresh on
 *   every render from the `facts` prop -- never copied into state -- so that
 *   a refresh bringing genuinely new data is not fought by stale state (A2).
 * - `edits` holds a per-id claim override so an edited card shows the
 *   corrected text immediately, without waiting on a refresh.
 * - `errors` holds a per-id message, rendered on the card that failed.
 * - `log` is this session's accepts and rejects, newest first, for the side
 *   panel and the progress line.
 *
 * One fact at a time, on purpose: only the top card has controls. A card
 * accepted or rejected flies off (stamped), then leaves the stack; `onChanged`
 * fires once it has gone, so the refresh it causes cannot pull the card out
 * from under its own animation. `onChanged` also fires after every saved
 * edit. See `Review` below, which supplies `() => router.refresh()`.
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
  look,
  footer,
}: {
  facts: ReviewFact[];
  onAccept: (id: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onChanged: () => void;
  pending?: number;
  published?: boolean;
  look?: ChatLook;
  /** Under the side panel: whether the page is live, and Publish while it is not. */
  footer?: ReactNode;
}) {
  const [acted, setActed] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [log, setLog] = useState<Done[]>([]);
  const [leaving, setLeaving] = useState<{ id: string; kind: Kind } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [startTotal] = useState(() => Math.max(pending, facts.length));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const deck = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const visible = facts.filter((fact) => !acted.has(fact.id));
  const claimOf = (fact: ReviewFact) => edits[fact.id] ?? fact.claim;
  const total = Math.max(startTotal, log.length + visible.length);
  const remaining = total - log.length;

  function settle(fact: ReviewFact, kind: Kind) {
    const keepFocus = deck.current?.contains(document.activeElement) ?? false;
    setActed((prev) => new Set(prev).add(fact.id));
    setLog((prev) => [{ id: fact.id, kind, claim: claimOf(fact) }, ...prev]);
    setLeaving(null);
    setDraft(null);
    const left = remaining - 1;
    setSaid(`${kind === 'accept' ? 'Accepted' : 'Rejected'}. ${left > 0 ? `${plural(left, 'fact')} to check.` : 'Nothing left to review.'}`);
    onChanged();
    // The button that was pressed has gone with its card; the next card
    // takes the focus rather than leaving it on the page itself.
    if (keepFocus) {
      requestAnimationFrame(() => deck.current?.querySelector<HTMLElement>('article:not([aria-hidden])')?.focus());
    }
  }

  async function act(fact: ReviewFact, kind: Kind) {
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
      // Recorded here, not thrown -- `FactCard` keeps its textarea open with
      // the owner's draft intact on `false` (F2/A5).
      setErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
      return false;
    }
  }

  const top = visible[0];
  const fresh = startTotal === 0 && log.length === 0 && visible.length === 0;
  const accepted = log.filter((entry) => entry.kind === 'accept').length;
  const doneIndex = log.length;

  const progText = fresh ? 'Nothing to check yet' : remaining > 0 ? `${plural(remaining, 'fact')} to check` : 'All checked';

  return (
    <div className={styles.rv}>
      <div className={styles.stage}>
        <div className={styles.blobs} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className={styles.prog}>
          <b>{progText}</b>
          {fresh ? null : (
            <>
              {total <= MAX_SEGMENTS ? (
                <span className={styles.pbar} aria-hidden="true">
                  {Array.from({ length: total }, (_, i) => {
                    // Oldest decision on the left, the card on top next, the rest waiting.
                    const entry = i < doneIndex ? log[doneIndex - 1 - i] : undefined;
                    return <i key={i} data-state={entry ? entry.kind : i === doneIndex ? 'now' : undefined} />;
                  })}
                </span>
              ) : (
                <span className={styles.pbar} aria-hidden="true">
                  <span className={styles.track}>
                    <i data-state="accept" style={{ width: `${(accepted / total) * 100}%` }} />
                    <i data-state="reject" style={{ width: `${((log.length - accepted) / total) * 100}%` }} />
                  </span>
                </span>
              )}
              <span className={styles.doneText}>
                {log.length} of {total} done
              </span>
            </>
          )}
        </div>

        {visible.length > 0 ? (
          <>
            <div className={styles.deck} ref={deck}>
              {visible.slice(0, 3).map((fact, i) => {
                const isTop = i === 0;
                const out = isTop && leaving?.id === fact.id ? leaving.kind : null;
                return (
                  <FactCard
                    key={fact.id}
                    fact={{ ...fact, claim: claimOf(fact) }}
                    behind={!isTop}
                    edited={edits[fact.id] !== undefined && edits[fact.id] !== fact.claim}
                    leaving={out}
                    style={placement(i, out)}
                    onAccept={() => act(fact, 'accept')}
                    onReject={() => act(fact, 'reject')}
                    onEdit={handleEdit}
                    onDraft={setDraft}
                    error={errors[fact.id]}
                  />
                );
              })}
            </div>
            <p className={styles.rule}>One fact at a time, on purpose. Nothing reaches your customers until you accept it.</p>
          </>
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
            <p>{published ? 'Everything you accepted is already live on your page.' : 'Everything you accepted will be on your page once you publish it.'}</p>
          </div>
        )}

        <p className={styles.sr} role="status">
          {said}
        </p>
      </div>

      <aside className={styles.side} aria-label="What this changes">
        <section>
          <h3>
            Once accepted, the chat can say<span>Live as you edit</span>
          </h3>
          <div className={`${bento.theme} ${styles.chat}`} {...(look ? themeAttrs(look) : {})}>
            <span className={styles.chatLabel}>
              <i aria-hidden="true" />
              On your page
            </span>
            {top?.question ? <span className={styles.asked}>{top.question}</span> : null}
            <span className={styles.reply}>{top ? (draft ?? claimOf(top)) || '…' : 'Everything here is checked. The chat only says what you accepted.'}</span>
          </div>
        </section>

        <section>
          <h3>
            This session
            <span>{log.length ? `${accepted} accepted · ${log.length - accepted} rejected` : ''}</span>
          </h3>
          {log.length ? (
            <ul className={styles.log}>
              {log.map((entry) => (
                <li key={entry.id}>
                  <i data-kind={entry.kind} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d={entry.kind === 'accept' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 7l10 10M17 7L7 17'} />
                    </svg>
                  </i>
                  <span>
                    <b>{entry.kind === 'accept' ? 'Accepted' : 'Rejected'}</b> {entry.claim}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.noLog}>What you accept or reject shows up here.</p>
          )}
        </section>

        {footer ? <div className={styles.golive}>{footer}</div> : null}
      </aside>
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
  look,
  footer,
}: {
  facts: ReviewFact[];
  pending: number;
  published: boolean;
  look?: ChatLook;
  footer?: ReactNode;
}) {
  const router = useRouter();

  return (
    <ReviewQueue
      facts={facts}
      pending={pending}
      published={published}
      look={look}
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
