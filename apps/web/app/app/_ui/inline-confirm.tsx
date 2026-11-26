'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FAILED } from './toast.js';
import styles from './inbox.module.css';
import { Callout } from '@curios/ui';

/**
 * A second look before something that cannot be taken back (Dash.html `.xcf2` / `.xcfb`): the
 * trigger gives way to a soft panel with the question and two pills, the move (`yes`, the action
 * fill) and the way out (`no`, white). Focus goes to the way out; Escape or `no` closes it and puts
 * focus back on the trigger. `tone` is the trigger's look: `danger` a red text link (Cancel order,
 * Not received), `quiet` a small white pill (Mark refunded).
 *
 * "yes" waits for `onYes`. While its promise is pending the panel stays, both pills are
 * aria-disabled and the panel aria-busy, so the move cannot be sent twice (aria-disabled, not
 * disabled, so focus is not dropped from the pressed pill). When it settles:
 * - on success the panel closes and focus goes back to the trigger, or, given `done`, that line
 *   takes the confirm's place (the board's "Done.", Dash.html 1896);
 * - on failure the panel stays open with the pills live again, and the error goes to `onError`
 *   (the page's toast) or, without one, a line under the question. Never an unhandled rejection.
 *
 * Open state is the component's own, unless the page passes `open` with `onOpenChange`: that is how
 * a page keeps one confirm open at a time (a single `confirming` id for all of them).
 *
 *   <InlineConfirm trigger="Cancel order" question="Cancel #14? You will owe Mira RM235."
 *     yes="Yes, cancel" no="Keep it" onYes={cancel} />
 */
export function InlineConfirm({
  trigger,
  question,
  yes,
  no,
  onYes,
  tone = 'danger',
  done,
  onError,
  open: openProp,
  onOpenChange,
}: {
  trigger: string;
  question: ReactNode;
  yes: string;
  no: string;
  onYes: () => void | Promise<unknown>;
  tone?: 'danger' | 'quiet';
  /** After a successful yes, this line takes the confirm's place ("Done."). */
  done?: ReactNode;
  /** Where a failed yes goes (a toast). Without it the panel says so under the question. */
  onError?: (error: unknown) => void;
  /** Controlled open state; pass it with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  // Where focus goes on the render after a change: the way out on open, the trigger on close.
  const focusNext = useRef<'keep' | 'opener' | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const target = focusNext.current === 'keep' ? keep.current : focusNext.current === 'opener' ? opener.current : null;
    focusNext.current = null;
    target?.focus();
  }, [open]);

  function setOpen(next: boolean, focus: 'keep' | 'opener' | null) {
    focusNext.current = focus;
    setFailed(false);
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  }

  function close() {
    if (sending.current) return;
    setOpen(false, 'opener');
  }

  async function confirm() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onYes();
    } catch (error) {
      sending.current = false;
      if (!mounted.current) return;
      setBusy(false);
      if (onError) onError(error);
      else setFailed(true);
      return;
    }
    sending.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (done !== undefined) setFinished(true);
    setOpen(false, done !== undefined ? null : 'opener');
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    // preventDefault is what a surrounding sheet or Help honours (use-modal ignores a handled Escape): React's
    // root listener sits on the root container, below the document theirs are on, so a listener there still sees the key; only preventDefault tells it.
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  if (finished) {
    return (
      <div className={styles.confirm} data-tone={tone}>
        <p className={styles.confirmDone} role="status">
          {done}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.confirm} data-open={open || undefined} data-tone={tone}>
      <button
        ref={opener}
        type="button"
        className={styles.confirmTrigger}
        hidden={open}
        aria-expanded={open}
        onClick={() => setOpen(true, 'keep')}
      >
        {trigger}
      </button>
      {open ? (
        <div className={styles.confirmPanel} role="group" aria-label={trigger} aria-busy={busy || undefined} onKeyDown={onKeyDown}>
          <p>{question}</p>
          {failed ? (
            <Callout tone="error">
              {FAILED}
            </Callout>
          ) : null}
          <div className={styles.confirmButtons}>
            <button type="button" className={styles.confirmYes} aria-disabled={busy || undefined} onClick={() => void confirm()}>
              {yes}
            </button>
            <button ref={keep} type="button" className={styles.confirmNo} aria-disabled={busy || undefined} onClick={close}>
              {no}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
