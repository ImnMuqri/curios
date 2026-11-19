'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import styles from './inbox.module.css';

/**
 * A second look before something that cannot be taken back (Dash.html `.xcf2` / `.xcfb`): the
 * trigger gives way to a soft panel with the question and two pills, the move (`yes`, the action
 * fill) and the way out (`no`, white). Focus goes to the way out; Escape or `no` closes it and puts
 * focus back on the trigger. `tone` is the trigger's look: `danger` a red text link (Cancel order,
 * Not received), `quiet` a small white pill (Mark refunded).
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
}: {
  trigger: string;
  question: string;
  yes: string;
  no: string;
  onYes: () => void | Promise<unknown>;
  tone?: 'danger' | 'quiet';
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // Where focus goes on the render after a change: the way out on open, the trigger on close.
  const focusNext = useRef<'keep' | 'opener' | null>(null);

  useEffect(() => {
    const target = focusNext.current === 'keep' ? keep.current : focusNext.current === 'opener' ? opener.current : null;
    focusNext.current = null;
    target?.focus();
  }, [open]);

  function close() {
    focusNext.current = 'opener';
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  }

  return (
    <div className={styles.confirm} data-open={open || undefined} data-tone={tone}>
      <button
        ref={opener}
        type="button"
        className={styles.confirmTrigger}
        hidden={open}
        aria-expanded={open}
        onClick={() => {
          focusNext.current = 'keep';
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open ? (
        <div className={styles.confirmPanel} role="group" aria-label={trigger} onKeyDown={onKeyDown}>
          <p>{question}</p>
          <div className={styles.confirmButtons}>
            <button
              type="button"
              className={styles.confirmYes}
              onClick={() => {
                close();
                void onYes();
              }}
            >
              {yes}
            </button>
            <button ref={keep} type="button" className={styles.confirmNo} onClick={close}>
              {no}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
