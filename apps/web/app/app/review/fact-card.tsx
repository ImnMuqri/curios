'use client';

import { useState, type CSSProperties } from 'react';
import type { FactCategory } from '@curios/core';
import type { ReviewFact } from '@curios/db-read';
import { sourcePlace } from '../_ui/source-place.js';
import styles from './review.module.css';

/**
 * Each kind of fact: its chip's words, its tone, and its icon. The board draws
 * Price, Hours and Policy; the other four follow the same chips.
 */
const CATEGORIES: Record<FactCategory, { label: string; tone: string; icon: string }> = {
  PRICE: { label: 'Price', tone: 'amber', icon: 'M12 3v18M16.5 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7' },
  HOURS: { label: 'Hours', tone: 'biru', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2' },
  POLICY: { label: 'Policy', tone: 'hijau', icon: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z' },
  LOCATION: { label: 'Location', tone: 'rose', icon: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  PRODUCT: { label: 'Product', tone: 'biru', icon: 'M4 7.5L12 3l8 4.5v9L12 21l-8-4.5zM4 7.5l8 4.5 8-4.5M12 12v9' },
  PERSON: { label: 'About', tone: 'rose', icon: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1' },
  MISC: { label: 'Other', tone: 'grey', icon: 'M4 6h16M4 12h16M4 18h10' },
};

const GLOBE = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18';
const INSTAGRAM = 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';
const TEXT = 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5';

/** How clearly the claim was read from its source, in the board's three words. */
export function readingOf(confidence: number): { text: string; tone: string } {
  if (confidence >= 0.85) return { text: 'Read clearly', tone: 'hijau' };
  if (confidence >= 0.7) return { text: 'Fairly sure', tone: 'kuning' };
  return { text: 'Check closely', tone: 'merah' };
}

/** The chip, the reading, the question and where the claim was found: what every card in the stack shows. */
function CardTop({ fact }: { fact: ReviewFact }) {
  const category = CATEGORIES[fact.category] ?? CATEGORIES.MISC;
  const reading = readingOf(fact.confidence);
  return (
    <>
      <div className={styles.top}>
        <span className={styles.cat} data-tone={category.tone}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={category.icon} />
          </svg>
          {category.label}
        </span>
        <span className={styles.conf} data-tone={reading.tone} title="How clearly it was read from the source">
          {reading.text}
          <i aria-hidden="true">
            <i style={{ width: `${Math.round(Math.max(0, Math.min(1, fact.confidence)) * 100)}%` }} />
          </i>
        </span>
      </div>
      {fact.question ? (
        <p className={styles.fq}>
          A customer might ask: <b>{fact.question}</b>
        </p>
      ) : null}
    </>
  );
}

function Source({ fact }: { fact: ReviewFact }) {
  if (!fact.sourceUrl && !fact.sourceText) return null;
  const place = fact.sourceUrl ? sourcePlace(fact.sourceUrl) : null;
  return (
    <div className={styles.src}>
      <div className={styles.sl}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={!place ? TEXT : place.startsWith('instagram.com') ? INSTAGRAM : GLOBE} />
        </svg>
        {place ? `Found on ${place}` : 'Found in what you wrote'}
        {/* FRONTEND.md: "numbers link to their source; an unverifiable
            metric is decoration". */}
        {fact.sourceUrl ? (
          <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer">
            Open source
          </a>
        ) : null}
      </div>
      {/* FRONTEND.md: "the line it came from, for the review screen" --
          without it the owner is asked to approve a claim with no way to
          check it against anything. */}
      {fact.sourceText ? (
        fact.sourceBefore !== null || fact.sourceAfter !== null ? (
          // As the board draws it: the line it sits in, faint, and the words
          // the fact came from picked out.
          <p data-picked="">
            “{fact.sourceBefore}
            <b>{fact.sourceText}</b>
            {fact.sourceAfter}”
          </p>
        ) : (
          <p>“{fact.sourceText}”</p>
        )
      ) : null}
    </div>
  );
}

/**
 * One fact, and the three things an owner can do to it: accept it as
 * written, correct the claim, or reject it.
 *
 * There is no fourth control and there must never be. The product's single
 * hard rule is that nothing sets `verified: true` except an explicit human
 * action on one specific fact -- no select-all, no accept-remaining, no
 * confidence threshold -- and this card is the surface that would carry a
 * violation if one were ever added. See "offers no control that acts on more
 * than this fact" in fact-card.test.tsx. The same guard is mirrored one level
 * up, in review-queue.test.tsx, because `ReviewQueue` -- not this card -- is
 * where a bulk control would actually be added (A4/F1).
 *
 * `onAccept`/`onReject` resolve to `Promise<void>`; `onEdit` resolves to
 * `Promise<boolean>` -- `true` only when the claim was actually saved. This
 * card awaits all three, for two reasons:
 *
 * 1. A local `busy` state, so every control is disabled while a mutation is
 *    in flight, and a double-tap on Save cannot fire two overlapping PATCHes
 *    where the later-resolving one wins the displayed claim.
 * 2. For Edit specifically, the textarea and the owner's typed draft stay
 *    exactly as they were until `onEdit` resolves `true`. `FACT_DUPLICATE`
 *    is a normal outcome, not a crash, and closing the textarea on a failed
 *    edit throws the owner's prose away (A5).
 *
 * This card still does not know or care *why* a mutation fails --
 * `ReviewQueue` is the single place that turns a failure into a rendered
 * `error` message.
 *
 * `onDraft` tells the queue what the claim reads while it is being edited
 * (null when it is not), for the chat preview beside the stack. `leaving` is
 * the stamp the card wears on its way out. `behind` is a card further down
 * the stack: the same face with no controls, out of the way of a screen
 * reader and the keyboard. It is the same component as the top card so that
 * moving up the stack is a transition, not a remount.
 */
export function FactCard({
  fact,
  onAccept,
  onEdit,
  onReject,
  onDraft,
  error,
  edited = false,
  leaving = null,
  behind = false,
  style,
}: {
  fact: ReviewFact;
  onAccept: (id: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<boolean>;
  onReject: (id: string) => Promise<void>;
  onDraft?: (draft: string | null) => void;
  error?: string;
  edited?: boolean;
  leaving?: 'accept' | 'reject' | null;
  behind?: boolean;
  style?: CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.claim);
  const [busy, setBusy] = useState(false);
  const locked = busy || leaving !== null;

  // All three catch and use `finally`. `ReviewQueue` handles its own
  // failures, so none of these can reject today -- but this card is exported
  // and rendered independently, and a handler that rejected would leave
  // `busy` stuck true: every control disabled, no recourse but a reload. The
  // catch is empty on purpose: rendering a failure is `ReviewQueue`'s job,
  // and rethrowing would reach `void handleAccept()` as an unhandled
  // rejection. See "leaves the card usable if a handler rejects".
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
    if (!draft.trim()) return;
    setBusy(true);
    let saved = false;
    try {
      saved = await onEdit(fact.id, draft.trim());
    } catch {
      // See above. `saved` stays false, so the draft survives.
    } finally {
      setBusy(false);
    }
    // Only a successful save closes the textarea (A5).
    if (saved) {
      setEditing(false);
      onDraft?.(null);
    }
  }

  function changeDraft(value: string) {
    setDraft(value);
    onDraft?.(value);
  }

  if (behind) {
    return (
      <article className={`${styles.fc} ${styles.behind}`} style={style} aria-hidden="true" inert>
        <CardTop fact={fact} />
        <p className={styles.claim}>{fact.claim}</p>
        <Source fact={fact} />
      </article>
    );
  }

  return (
    <article className={styles.fc} style={style} aria-label="Fact to check" tabIndex={-1} data-leaving={leaving ?? undefined}>
      <CardTop fact={fact} />

      {editing ? (
        <div className={styles.ced}>
          <textarea aria-label="Claim" value={draft} onChange={(event) => changeDraft(event.target.value)} />
        </div>
      ) : (
        <p className={styles.claim}>
          {fact.claim}
          {edited ? <span className={styles.edited}>Edited</span> : null}
        </p>
      )}

      <Source fact={fact} />

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.facts}>
        {editing ? (
          <>
            <button
              type="button"
              className={styles.ed2}
              disabled={locked}
              onClick={() => {
                setDraft(fact.claim);
                setEditing(false);
                onDraft?.(null);
              }}
            >
              Cancel
            </button>
            <button type="button" className={`${styles.ac} ${styles.save}`} disabled={locked || !draft.trim()} onClick={() => void handleSave()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            {/* merah, because rejection is the destructive action on this
                screen and that is the only thing merah is for. */}
            <button type="button" className={styles.rj} disabled={locked} onClick={() => void handleReject()}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Reject
            </button>
            <button
              type="button"
              className={styles.ed2}
              disabled={locked}
              onClick={() => {
                setDraft(fact.claim);
                setEditing(true);
                onDraft?.(fact.claim);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
              </svg>
              Edit
            </button>
            <button type="button" className={styles.ac} disabled={locked} onClick={() => void handleAccept()}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              Accept
            </button>
          </>
        )}
      </div>

      {leaving ? (
        <span className={styles.stamp} data-kind={leaving} aria-hidden="true">
          {leaving === 'accept' ? 'Accepted' : 'Rejected'}
        </span>
      ) : null}
    </article>
  );
}
