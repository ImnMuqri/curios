'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureCard } from '../capture/CaptureCard.js';
import { AnswerBubble } from './AnswerBubble.js';
import styles from './AskSheet.module.css';

/** Same copy for every failure path. The visitor never sees a raw error. */
const FAILED = 'That answer failed. Try again.';

/** One exchange. The list of these is the transcript an owner is eventually sent. */
interface Turn {
  question: string;
  answer: string;
}

export interface AskSheetProps {
  /** The question the bar was showing when it was tapped. Asked immediately. */
  seed: string;
  onClose: () => void;
  /**
   * Injected rather than imported. It keeps NEXT_PUBLIC_API_URL and the fetch
   * out of this package, which is what lets the sheet be tested against a
   * hand-built ReadableStream instead of a network.
   *
   * `conversationId` is null for the first question of a thread and the id the
   * server returned for every one after.
   */
  onAsk: (
    question: string,
    conversationId: string | null,
  ) => Promise<ReadableStream<Uint8Array> | null>;
  /** Named on the capture card's consent line, so the visitor knows who gets their number. */
  shopName?: string;
  /**
   * Omitted on a page that cannot capture -- a personal one, per BACKEND.md's
   * plan matrix. Without it the card is never offered, however the server
   * answers, because a field that posts nowhere is worse than no field.
   */
  onCapture?: (phone: string, conversationId: string) => Promise<void>;
}

export function AskSheet({ seed, onClose, onAsk, shopName, onCapture }: AskSheetProps) {
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
  const closeButton = useRef<HTMLButtonElement>(null);

  /**
   * A ref, not state. The streaming loop below reads it after awaits, and a
   * state value captured at render time would be the one from before the
   * previous answer finished -- so the second question would carry no id and
   * silently start a third thread.
   */
  const conversationId = useRef<string | null>(null);

  useEffect(() => {
    // The keyboard follows the eye. Without this, tab from an open sheet lands
    // somewhere behind it and the sheet is unusable without a mouse.
    closeButton.current?.focus();
  }, []);

  /**
   * One question, from the seed or from the composer. The streaming loop is the
   * one this file has always had; its two comments are load-bearing and were
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
        // unhandled rejection and the visitor sees an empty sheet.
        replace(FAILED);
      } finally {
        setBusy(false);
      }
    },
    [onAsk],
  );

  /**
   * Whether the seed has gone out. React mounts every component twice in
   * development, running this effect twice on the same instance; without the
   * guard the seed was sent twice -- two model calls, two conversations against
   * the page's cap, and both answers streamed into one bubble. A ref survives
   * that remount, where state set in the first pass would not yet be visible.
   * Not an abort on cleanup: by then the server has already opened the
   * conversation and started the model call, so the only fix is not to send.
   */
  const seedSent = useRef(false);

  useEffect(() => {
    if (seedSent.current) return;
    seedSent.current = true;
    void send(seed);
    // Empty on purpose: the seed is asked once, when the sheet opens.
    // Depending on `send` or `seed` would re-ask the first question in the
    // middle of a thread. (No eslint-disable here -- the react-hooks plugin
    // is not configured in this package, so naming its rule is itself an
    // error.)
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        onClose();
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
    [onClose],
  );

  const trimmed = draft.trim();

  return (
    <div className={styles.scrim} onKeyDown={onKeyDown}>
      <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-label="Answer">
        <div className={styles.header}>
          <p className={styles.title}>Ask about this page</p>
          <button ref={closeButton} type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>

        {turns.map((turn, index) => (
          <div key={`${index}-${turn.question}`} className={styles.turn}>
            <p className={styles.question}>{turn.question}</p>
            <AnswerBubble text={turn.answer} />
          </div>
        ))}

        {qualified && onCapture ? (
          <CaptureCard
            shopName={shopName ?? 'the shop'}
            // The sheet supplies the conversation id, the same way it supplies
            // it to onAsk: this component owns the thread, so nothing outside
            // has to keep a second copy of which one is current.
            onSubmit={(phone) => onCapture(phone, conversationId.current ?? '')}
          />
        ) : null}

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
          <label className={styles.composerLabel} htmlFor="ask-more">
            Ask another question
          </label>
          <div className={styles.composerRow}>
            <input
              id="ask-more"
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
    </div>
  );
}
