'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureCard } from '../capture/CaptureCard.js';
import { AnswerBubble } from './AnswerBubble.js';
import styles from './ChatMode.module.css';

/** Same copy for every failure path. The visitor never sees a raw error. */
const FAILED = 'That answer failed. Try again.';

/** Up to this many of the page's questions greet a visitor with nothing typed yet. */
const MAX_CHIPS = 4;

/** One exchange. The list of these is the transcript an owner is eventually sent. */
interface Turn {
  question: string;
  answer: string;
}

export interface ChatModeProps {
  /**
   * Controlled by the caller, not this component: the whole point of the
   * claude.ai treatment is that the thread survives being hidden, so this
   * stays mounted across opens and closes rather than being conditionally
   * rendered.
   */
  open: boolean;
  onClose: () => void;
  /**
   * Injected rather than imported. It keeps NEXT_PUBLIC_API_URL and the fetch
   * out of this package, which is what lets chat mode be tested against a
   * hand-built ReadableStream instead of a network.
   *
   * `conversationId` is null for the first question of a thread and the id the
   * server returned for every one after.
   */
  onAsk: (
    question: string,
    conversationId: string | null,
  ) => Promise<ReadableStream<Uint8Array> | null>;
  /** Named in the top bar and the greeting, and on the capture card's consent line. */
  displayName: string;
  /** Rendered in the top bar next to the name. Omitted -- nothing, not a placeholder icon -- when there is none. */
  avatarUrl?: string | null;
  /** This page's suggested questions. Up to four become tappable chips before any turn exists. */
  questions: string[];
  /**
   * Omitted on a page that cannot capture -- a personal one, per BACKEND.md's
   * plan matrix. Without it the card is never offered, however the server
   * answers, because a field that posts nowhere is worse than no field.
   */
  onCapture?: (phone: string, conversationId: string) => Promise<void>;
}

export function ChatMode({
  open,
  onClose,
  onAsk,
  displayName,
  avatarUrl,
  questions,
  onCapture,
}: ChatModeProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Whatever the server said on the last `done`. FRONTEND.md: "the client
   * never decides this" -- so this is stored, never computed from the turns on
   * screen.
   */
  const [qualified, setQualified] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  /**
   * A ref, not state. The streaming loop below reads it after awaits, and a
   * state value captured at render time would be the one from before the
   * previous answer finished -- so the second question would carry no id and
   * silently start a third thread.
   */
  const conversationId = useRef<string | null>(null);

  /**
   * Whether this instance currently owns the one history entry chat mode
   * pushes on entry. Cleared the moment it is consumed -- by the back
   * button, Escape, or a real popstate -- so a reopen always pushes exactly
   * one new entry rather than stacking them.
   */
  const pushedHistory = useRef(false);

  useEffect(() => {
    // Guarded on the ref, not just `open`: without it, React's Strict Mode
    // double-invoking this effect on the same mount would push two entries
    // for one open, and the first back gesture would only close chat mode
    // rather than returning to the bento.
    if (!open || pushedHistory.current) return;
    // No URL change -- this exists purely so the phone/browser back gesture
    // has something of ours to consume instead of leaving the page.
    history.pushState({ curiosChat: true }, '');
    pushedHistory.current = true;
  }, [open]);

  useEffect(() => {
    // The other half of the balance above: the browser or phone back
    // gesture pops the pushed entry without going through `leave` below, so
    // this is what actually closes chat mode when nothing here caused the
    // navigation.
    function onPopState() {
      if (!pushedHistory.current) return;
      pushedHistory.current = false;
      onClose();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [onClose]);

  /**
   * The back button and Escape share this. It consumes the pushed entry
   * itself, rather than waiting for the popstate that `history.back()`
   * eventually fires, so closing is immediate and not a bet on a real
   * browser's navigation timing -- the later popstate this triggers finds
   * `pushedHistory.current` already false and is a no-op.
   *
   * Guarded on that same ref, not just called unconditionally: a second
   * invocation before `open` has had a chance to flip false -- Escape
   * pressed twice in quick succession, or the back button clicked twice --
   * must not call `onClose` a second time for a chat mode that is, as far as
   * this component is concerned, already closed.
   */
  const leave = useCallback(() => {
    if (!pushedHistory.current) return;
    pushedHistory.current = false;
    history.back();
    onClose();
  }, [onClose]);

  useEffect(() => {
    // A `position: fixed` layer still lets the page behind it scroll on
    // touch unless the body itself is pinned.
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    // The keyboard follows the eye. There is no seed answer to wait on
    // anymore -- entering chat mode always lands on an empty composer, so it
    // is what gets the focus, not a close control.
    if (!open) return;
    input.current?.focus();
  }, [open]);

  /**
   * One question, from a chip or the composer. The streaming loop is the one
   * this file has always had; its two comments are load-bearing and were
   * paid for once already.
   */
  const send = useCallback(
    async (question: string) => {
      setBusy(true);
      setTurns((previous) => [...previous, { question, answer: '' }]);

      const append = (text: string) =>
        setTurns((previous) =>
          previous.map((turn, index) =>
            index === previous.length - 1 ? { ...turn, answer: turn.answer + text } : turn,
          ),
        );
      const replace = (text: string) =>
        setTurns((previous) =>
          previous.map((turn, index) =>
            index === previous.length - 1 ? { ...turn, answer: text } : turn,
          ),
        );

      try {
        const body = await onAsk(question, conversationId.current);
        if (!body) {
          replace(FAILED);
          return;
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();
        // SSE events routinely straddle chunk boundaries, so the tail of one
        // read is carried over and prefixed onto the next rather than parsed
        // as-is.
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          // { stream: true } holds back any multi-byte UTF-8 sequence cut in
          // half by this chunk boundary until the bytes completing it arrive.
          buffer += decoder.decode(value, { stream: true });
          const segments = buffer.split('\n\n');
          buffer = segments.pop() ?? '';

          for (const segment of segments) {
            if (!segment.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(segment.slice(6)) as {
                type: string;
                text?: string;
                message?: string;
                code?: string;
                conversationId?: string;
                intent?: { qualified?: boolean };
              };
              if (parsed.type === 'text' && parsed.text) append(parsed.text);
              if (parsed.type === 'error') {
                // The one error this acts on rather than only showing. A dead
                // id must be dropped, or every later question carries it and
                // fails for the same reason forever.
                if (parsed.code === 'CONVERSATION_NOT_FOUND') conversationId.current = null;
                // Replaces, not appends: a half-answer followed by an apology
                // reads worse than the apology alone.
                replace(parsed.message ?? FAILED);
                return;
              }
              if (parsed.type === 'done') {
                if (parsed.conversationId) conversationId.current = parsed.conversationId;
                setQualified(parsed.intent?.qualified === true);
                return;
              }
            } catch {
              // A malformed or truncated payload is dropped; the stream continues.
            }
          }
        }
      } catch {
        // A rejected fetch -- offline, DNS, a CORS regression -- throws rather
        // than resolving with response.ok === false. Uncaught, that is an
        // unhandled rejection and the visitor sees an empty thread.
        replace(FAILED);
      } finally {
        setBusy(false);
      }
    },
    [onAsk],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        leave();
        return;
      }
      if (event.key !== 'Tab') return;

      // A real trap. aria-modal tells assistive technology the rest of the
      // page is inert; it does not stop Tab, so the wrap is done by hand.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [leave],
  );

  const trimmed = draft.trim();
  const chips = questions.slice(0, MAX_CHIPS);

  return (
    <div
      ref={panel}
      className={styles.layer}
      // Kept mounted, not conditionally rendered, so the thread survives
      // being hidden -- `hidden` drops it from layout and the accessibility
      // tree, `inert` additionally stops it from being focused or clicked
      // should some other rule ever make it visible without `open` also
      // being true.
      hidden={!open}
      inert={!open}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={`Chat with ${displayName}`}
    >
      <div className={styles.topBar}>
        <button type="button" aria-label="Back to links" className={styles.back} onClick={leave}>
          ←
        </button>
        {avatarUrl ? <img src={avatarUrl} alt="" className={styles.avatar} /> : null}
        <p className={styles.name}>{displayName}</p>
      </div>

      <div className={styles.body}>
        {turns.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.greeting}>Hi! What do you want to know about {displayName}?</p>
            {chips.length > 0 ? (
              <div className={styles.chips}>
                {chips.map((question) => (
                  <button
                    key={question}
                    type="button"
                    className={styles.chip}
                    onClick={() => void send(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          turns.map((turn, index) => (
            <div key={`${index}-${turn.question}`} className={styles.turn}>
              <p className={styles.question}>{turn.question}</p>
              <AnswerBubble text={turn.answer} />
            </div>
          ))
        )}

        {qualified && onCapture ? (
          <CaptureCard
            shopName={displayName}
            // Chat mode supplies the conversation id, the same way it
            // supplies it to onAsk: this component owns the thread, so
            // nothing outside has to keep a second copy of which one is
            // current.
            onSubmit={(phone) => onCapture(phone, conversationId.current ?? '')}
          />
        ) : null}
      </div>

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || trimmed === '') return;
          setDraft('');
          void send(trimmed);
        }}
      >
        {/*
          A visible label, not a placeholder. FRONTEND.md bans blank prompt
          boxes, and a placeholder stops being a label the moment anyone
          types into it.
        */}
        <label className={styles.composerLabel} htmlFor="chat-input">
          Ask a question
        </label>
        <div className={styles.composerRow}>
          <input
            id="chat-input"
            ref={input}
            className={styles.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className={styles.send}
            disabled={busy || trimmed === ''}
            aria-busy={busy || undefined}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
