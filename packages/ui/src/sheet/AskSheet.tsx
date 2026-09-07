'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnswerBubble } from './AnswerBubble.js';
import styles from './AskSheet.module.css';

/** Same copy for every failure path. The visitor never sees a raw error. */
const FAILED = 'That answer failed. Try again.';

export interface AskSheetProps {
  /** The question the bar was showing when it was tapped. Asked immediately. */
  seed: string;
  onClose: () => void;
  /**
   * Injected rather than imported. It keeps NEXT_PUBLIC_API_URL and the fetch
   * out of this package, which is what lets the sheet be tested against a
   * hand-built ReadableStream instead of a network.
   */
  onAsk: (question: string) => Promise<ReadableStream<Uint8Array> | null>;
}

export function AskSheet({ seed, onClose, onAsk }: AskSheetProps) {
  const [answer, setAnswer] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The keyboard follows the eye. Without this, tab from an open sheet lands
    // somewhere behind it and the sheet is unusable without a mouse.
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function ask() {
      try {
        const body = await onAsk(seed);
        if (!body) {
          if (!cancelled) setAnswer(FAILED);
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
              };
              if (parsed.type === 'text' && parsed.text) {
                const chunk = parsed.text;
                if (!cancelled) setAnswer((a) => a + chunk);
              }
              if (parsed.type === 'error') {
                // Replaces, not appends: a half-answer followed by an apology
                // reads worse than the apology alone.
                if (!cancelled) setAnswer(parsed.message ?? FAILED);
                return;
              }
              if (parsed.type === 'done') return;
            } catch {
              // A malformed or truncated payload is dropped; the stream continues.
            }
          }
        }
      } catch {
        // A rejected fetch -- offline, DNS, a CORS regression -- throws rather
        // than resolving with response.ok === false. Uncaught, that is an
        // unhandled rejection and the visitor sees an empty sheet.
        if (!cancelled) setAnswer(FAILED);
      }
    }

    void ask();
    return () => {
      cancelled = true;
    };
  }, [seed, onAsk]);

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

  return (
    <div className={styles.scrim} onKeyDown={onKeyDown}>
      <div
        ref={panel}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Answer"
      >
        <div className={styles.header}>
          <p className={styles.question}>{seed}</p>
          <button ref={closeButton} type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>
        <AnswerBubble text={answer} />
      </div>
    </div>
  );
}
