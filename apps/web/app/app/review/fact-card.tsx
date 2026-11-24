"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FactCategory } from "@curios/core";
import type { ReviewFact } from "@curios/db-read";
import { sourcePlace } from "../_ui/source-place.js";
import styles from "./review.module.css";

/** Each kind of fact: its tag's words. The board draws Price, Hours and Policy; the other four use the same tag. */
const CATEGORIES: Record<FactCategory, string> = {
  PRICE: "Price",
  HOURS: "Hours",
  POLICY: "Policy",
  LOCATION: "Location",
  PRODUCT: "Product",
  PERSON: "About",
  MISC: "Other",
};

/** Where the fact was found, in a few words: the address without its scheme, or "what you wrote". Null when nothing was kept. */
function fromOf(fact: ReviewFact): string | null {
  if (fact.sourceUrl) return sourcePlace(fact.sourceUrl);
  return fact.sourceText ? "what you wrote" : null;
}

/**
 * The board's "Read clearly from your menu page.", from the read confidence: 0.85 and up reads
 * clearly, 0.7 and up is fairly sure, the rest should be checked closely. The board says "your
 * menu page"; the app does not know what kind of page it was, so it names the address instead.
 */
export function readingLine(confidence: number, from: string | null): string {
  const tail = from ? ` from ${from}` : "";
  if (confidence >= 0.85) return `Read clearly${tail}.`;
  if (confidence >= 0.7) return `Fairly sure of this one${tail}.`;
  return `Check this one closely${tail}.`;
}

/** The line the claim came from, picked out, and a link to the page it was read on. */
function Source({ fact }: { fact: ReviewFact }) {
  if (!fact.sourceUrl && !fact.sourceText) return null;
  return (
    <div className={styles.src}>
      {/* FRONTEND.md: "the line it came from, for the review screen" --
          without it the owner is asked to approve a claim with no way to
          check it against anything. */}
      {fact.sourceText ? (
        fact.sourceBefore !== null || fact.sourceAfter !== null ? (
          // As the earlier board drew it: the line it sits in, faint, and the
          // words the fact came from picked out.
          <p data-picked="">
            “{fact.sourceBefore}
            <b>{fact.sourceText}</b>
            {fact.sourceAfter}”
          </p>
        ) : (
          <p>“{fact.sourceText}”</p>
        )
      ) : null}
      {/* FRONTEND.md: "numbers link to their source; an unverifiable
          metric is decoration". */}
      {fact.sourceUrl ? (
        <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer">
          Open source
        </a>
      ) : null}
    </div>
  );
}

/** Whether a modal layer (Help, a side sheet) is open, so the card's keys leave the keyboard to it. */
function dialogOpen(): boolean {
  return (
    document.querySelector(
      'dialog[open], [role="dialog"]:not([inert]):not([aria-hidden="true"])',
    ) !== null
  );
}

/** A place the owner types: F, S and A must not fire while they are in one. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    /^(input|textarea|select)$/i.test(target.tagName) ||
    target.isContentEditable
  );
}

/**
 * One fact, and what an owner can do to it: Fix it (correct the claim: Save keeps the fact in the queue, unverified, to accept afterwards), Skip
 * (put it off, it comes back later), or Accept it as written. F, S and A do the same from the
 * keyboard. Reject is still there, but quiet: a text button under the keys, so a wrong fact can be
 * thrown away without being the loudest thing on the card.
 *
 * There is no other control and there must never be. The product's single hard rule is that
 * nothing sets `verified: true` except an explicit human action on one specific fact -- no
 * select-all, no accept-remaining, no confidence threshold -- and this card is the surface that
 * would carry a violation if one were ever added. See "offers no control that acts on more than
 * this fact" in fact-card.test.tsx. The same guard is mirrored one level up, in
 * review-queue.test.tsx, because `ReviewQueue` -- not this card -- is where a bulk control would
 * actually be added (A4/F1).
 *
 * `onAccept`/`onReject` resolve to `Promise<void>`; `onEdit` resolves to `Promise<boolean>` --
 * `true` only when the claim was actually saved. This card awaits all three, for two reasons:
 *
 * 1. A local `busy` state, so every control is disabled while a mutation is in flight, and a
 *    double-tap on Save cannot fire two overlapping PATCHes where the later-resolving one wins
 *    the displayed claim.
 * 2. For Fix it specifically, the textarea and the owner's typed draft stay exactly as they were
 *    until `onEdit` resolves `true`. `FACT_DUPLICATE` is a normal outcome, not a crash, and
 *    closing the textarea on a failed edit throws the owner's prose away (A5).
 *
 * This card still does not know or care *why* a mutation fails -- `ReviewQueue` is the single
 * place that turns a failure into a rendered `error` message.
 *
 * `onSkip` is optional: without it there is no Skip. `canSkip` false (only one fact is left)
 * disables it. `leaving` is the stamp the card wears on its way out.
 */
export function FactCard({
  fact,
  onAccept,
  onEdit,
  onReject,
  onSkip,
  canSkip = true,
  error,
  edited = false,
  leaving = null,
  style,
}: {
  fact: ReviewFact;
  onAccept: (id: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<boolean>;
  onReject: (id: string) => Promise<void>;
  onSkip?: (id: string) => void;
  canSkip?: boolean;
  error?: string;
  edited?: boolean;
  leaving?: "accept" | "reject" | null;
  style?: CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.claim);
  const [busy, setBusy] = useState(false);
  const locked = busy || leaving !== null;
  const card = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fixIt = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Fix it puts the cursor in the claim; leaving it puts focus back on Fix it, so the keys and Tab carry on.
  useEffect(() => {
    if (editing) {
      field.current?.focus();
      // The cursor goes after the claim, so typing adds to it.
      field.current?.setSelectionRange(
        field.current.value.length,
        field.current.value.length,
      );
    } else if (wasEditing.current) fixIt.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

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
    }
  }

  function startEditing() {
    setDraft(fact.claim);
    setEditing(true);
  }

  function skip() {
    onSkip?.(fact.id);
  }

  // F, S and A act on this card, the one on top, and only while the owner is not typing, no
  // dialog is open and the card itself is not behind one (the frame makes the screen inert).
  // The handler is rebuilt each render so it never reads a stale `editing` or `busy`.
  const onKey = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (
      editing ||
      locked ||
      typingIn(event.target) ||
      dialogOpen() ||
      card.current?.closest("[inert]")
    )
      return;
    const key = event.key.toLowerCase();
    if (key === "f") startEditing();
    else if (key === "s") {
      if (!onSkip || !canSkip) return;
      skip();
    } else if (key === "a") void handleAccept();
    else return;
    event.preventDefault();
  };
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handler.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const from = fromOf(fact);

  return (
    <article
      ref={card}
      className={styles.fc}
      style={style}
      aria-label="Fact to check"
      tabIndex={-1}
      data-leaving={leaving ?? undefined}
    >
      <div className={styles.srcLine}>
        <span className={styles.cat}>
          {CATEGORIES[fact.category] ?? CATEGORIES.MISC}
        </span>
        {from ? `from ${from}` : null}
      </div>

      {editing ? (
        <div className={styles.ced}>
          <textarea
            ref={field}
            aria-label="Claim"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </div>
      ) : (
        <h2 className={styles.claim}>
          {fact.claim}
          {edited ? <span className={styles.edited}>Edited</span> : null}
        </h2>
      )}

      <p className={styles.reading}>{readingLine(fact.confidence, from)}</p>

      {fact.question ? (
        <div className={styles.qx}>
          <small>A customer might ask</small>“{fact.question}”
        </div>
      ) : null}

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
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.ac}
              disabled={locked || !draft.trim()}
              onClick={() => void handleSave()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              ref={fixIt}
              className={styles.ed2}
              disabled={locked}
              aria-keyshortcuts="F"
              onClick={startEditing}
            >
              Fix it
            </button>
            {onSkip ? (
              <button
                type="button"
                className={styles.ed2}
                disabled={locked || !canSkip}
                aria-keyshortcuts="S"
                onClick={skip}
              >
                Skip
              </button>
            ) : null}
            <button
              type="button"
              className={styles.ac}
              disabled={locked}
              aria-keyshortcuts="A"
              onClick={() => void handleAccept()}
            >
              Accept
            </button>
          </>
        )}
      </div>

      {editing ? null : (
        <>
          <p className={styles.keys} aria-hidden="true">
            <kbd>F</kbd> Fix it <kbd>S</kbd> Skip <kbd>A</kbd> Accept
          </p>
          {/* Quiet on purpose: rejecting is the destructive choice, so it is a text button, not a
              fourth one beside the three, and it has no key. */}
          <button
            type="button"
            className={styles.rj}
            disabled={locked}
            onClick={() => void handleReject()}
          >
            Reject this fact
          </button>
        </>
      )}

      {leaving ? (
        <span className={styles.stamp} data-kind={leaving} aria-hidden="true">
          {leaving === "accept" ? "Accepted" : "Rejected"}
        </span>
      ) : null}
    </article>
  );
}
