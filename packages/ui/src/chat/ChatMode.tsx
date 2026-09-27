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

/**
 * The ancestor `BentoPage` renders with `data-bento-page`. This component is
 * never portalled and never full-screen -- it is a state of that same page --
 * so it reaches up through the real DOM tree to it rather than taking it as
 * a prop, which would make a server component carry chat-mode's own state.
 */
function findPage(node: HTMLElement | null): HTMLElement | null {
  return node?.closest<HTMLElement>('[data-bento-page]') ?? null;
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
  /** Named on the capture card's consent line. The page's own header already shows it; this does not repeat it. */
  displayName: string;
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
  const end = useRef<HTMLDivElement>(null);

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

  /**
   * The owner's own complaint about the first version of this: a full-screen
   * layer "looks like it opened another page". Chat mode is a state of the
   * same page instead -- `data-mode="chat"` on the page root is what
   * Bento.module.css collapses the grid and bio against, and what hides the
   * ask bar in favour of the composer below. `BentoPage` is a server
   * component and holds none of this itself, so it is set here by direct DOM
   * mutation on the ancestor rather than through a prop.
   *
   * The folded-away content is also marked `inert` and `aria-hidden` here,
   * in the same effect: native `inert` is what removes it from the tab order
   * (nothing else does, now that this is not a modal dialog with a manual
   * focus trap), and `aria-hidden` backs it up for anything that only reads
   * ARIA. Both flip back the moment chat mode closes.
   *
   * The returned cleanup reverses exactly what this run applied, using the
   * `page`/`foldaway` nodes captured in its own closure rather than looking
   * them up again -- `panel.current` is already null by the time a passive
   * effect's cleanup runs on unmount, so re-deriving them there would find
   * nothing. Without this, an unmount while chat mode is open (an error
   * boundary, a route change tearing this component down but not the page
   * around it, React Strict Mode's own mount/unmount/remount) would leave
   * the bento permanently hidden and inert with nothing left alive to ever
   * undo it.
   */
  useEffect(() => {
    const page = findPage(panel.current);
    if (!page) return;

    if (open) page.dataset.mode = 'chat';
    else delete page.dataset.mode;

    const foldaway = page.querySelector<HTMLElement>('[data-foldaway]');
    if (foldaway) {
      foldaway.inert = open;
      if (open) foldaway.setAttribute('aria-hidden', 'true');
      else foldaway.removeAttribute('aria-hidden');
    }

    return () => {
      delete page.dataset.mode;
      if (foldaway) {
        foldaway.inert = false;
        foldaway.removeAttribute('aria-hidden');
      }
    };
  }, [open]);

  /**
   * "What do you want to know?" (rendered by `Ask`, outside this component)
   * doubles as chat mode's own empty-state greeting, so it has to disappear
   * once there is a transcript to show instead -- something only this
   * component, not the server-rendered page around it, knows. Keyed on the
   * turn count rather than `turns` itself, so a streaming answer's growing
   * text does not re-touch the DOM on every chunk.
   *
   * Cleared on cleanup for the same reason the effect above clears its own
   * attributes: an unmount must not leave this behind on a page element that
   * outlives this component.
   */
  useEffect(() => {
    const page = findPage(panel.current);
    if (!page) return;
    if (turns.length > 0) page.dataset.hasTurns = 'true';
    else delete page.dataset.hasTurns;

    return () => {
      delete page.dataset.hasTurns;
    };
  }, [turns.length]);

  useEffect(() => {
    // The keyboard follows the eye. There is no seed answer to wait on
    // anymore -- entering chat mode always lands on an empty composer, so it
    // is what gets the focus, not a close control.
    if (!open) return;
    input.current?.focus();
  }, [open]);

  /**
   * Nothing here is `position: fixed` anymore, so the page scrolls normally
   * and a lock would just fight the visitor's own scrolling. What used to be
   * a lock is now this: keep the newest line of the conversation in view as
   * it streams in, the same way any chat surface does. Keyed on the whole
   * `turns` array, not its length, so this also fires as an answer's text
   * grows chunk by chunk, not just when a new turn is added.
   */
  useEffect(() => {
    if (turns.length === 0) return;
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

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

  /**
   * Escape only, now. The old manual Tab-wrap existed because `aria-modal`
   * does not itself stop Tab reaching what it labels inert -- but this is no
   * longer a modal dialog laid over the page, and the content it replaces is
   * marked genuinely `inert` above, which natively removes it from the tab
   * order. There is nothing left for a hand-rolled trap to do.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') leave();
    },
    [leave],
  );

  const trimmed = draft.trim();
  const chips = questions.slice(0, MAX_CHIPS);

  return (
    <div
      ref={panel}
      className={styles.panel}
      // Kept mounted, not conditionally rendered, so the thread survives
      // being hidden -- `hidden` drops it from layout and the accessibility
      // tree, `inert` additionally stops it from being focused or clicked
      // should some other rule ever make it visible without `open` also
      // being true.
      hidden={!open}
      inert={!open}
      onKeyDown={onKeyDown}
    >
      <button type="button" aria-label="Back to links" className={styles.back} onClick={leave}>
        ←
      </button>

      {turns.length === 0 ? (
        chips.length > 0 ? (
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
        ) : null
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

      {/* Scrolled into view as the thread grows; carries no content of its own. */}
      <div ref={end} />

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
