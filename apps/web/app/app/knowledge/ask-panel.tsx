'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { themeAttrs } from '../../_bento/BentoPage.js';
import bento from '../../_bento/Bento.module.css';
import { apiFetch } from '../../../lib/api.js';
import styles from './knowledge.module.css';

/** The page's colours, for the chat. */
export type ChatLook = Parameters<typeof themeAttrs>[0];

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Where an answer came from, when it was the owner's own words. */
  from?: 'answer' | 'facts';
}

/** How many earlier turns go with a question: the API takes ten. */
const HISTORY = 10;

/**
 * "Ask your page": the owner asks a question the way a customer would, and
 * sees what the chat says, from only what is on this screen. Nothing it asks
 * reaches Questions or the month's conversations (POST /chat/test).
 * Presentational: `onAsk` is injected.
 */
export function AskPanel({
  look,
  suggestions,
  onAsk,
}: {
  look?: ChatLook;
  suggestions: string[];
  onAsk: (question: string, history: Turn[]) => Promise<{ reply: string; from: 'answer' | 'facts' }>;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ask, setAsk] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const chat = useRef<HTMLDivElement>(null);
  const theme = look ? themeAttrs(look) : null;

  useEffect(() => {
    const box = chat.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [turns, thinking]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || thinking) return;
    const history = turns.slice(-HISTORY).map(({ role, content }) => ({ role, content }));
    setTurns((prev) => [...prev, { role: 'user', content: q }]);
    setAsk('');
    setError('');
    setThinking(true);
    try {
      const answer = await onAsk(q, history);
      setTurns((prev) => [...prev, { role: 'assistant', content: answer.reply, from: answer.from }]);
    } catch (failure) {
      // The question comes back to the box, so it can be sent again.
      setTurns((prev) => prev.slice(0, -1));
      setAsk(q);
      setError(failure instanceof Error ? failure.message : 'That answer failed. Try again.');
    } finally {
      setThinking(false);
    }
  }

  return (
    <aside
      className={styles.tester}
      aria-label="Try your page"
      // The accent, for the send button; the chat below takes the whole look.
      data-on-accent={theme?.['data-on-accent']}
      style={theme?.style}
    >
      <h2>Ask your page</h2>
      <p>Test what the chat says, using only what&apos;s here.</p>

      <div ref={chat} className={`${bento.theme} ${styles.tchat}`} {...(theme ?? {})} role="log" aria-live="polite" aria-label="Your page's answers">
        {turns.length === 0 && !thinking ? (
          <span className={styles.tchatEmpty}>
            Ask something, the way a customer would.
            <br />
            It answers only from what’s here.
          </span>
        ) : null}
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <span key={i} className={styles.u}>
              {turn.content}
            </span>
          ) : (
            <span key={i} style={{ display: 'contents' }}>
              <span className={styles.a}>{turn.content}</span>
              {turn.from === 'answer' ? (
                <span className={styles.from}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  Your answer on Questions
                </span>
              ) : null}
            </span>
          ),
        )}
        {thinking ? (
          <span className={styles.a} aria-label="Thinking">
            <span className={styles.dots}>
              <i />
              <i />
              <i />
            </span>
          </span>
        ) : null}
      </div>

      {suggestions.length > 0 ? (
        <div className={styles.sugg} role="group" aria-label="Try asking">
          {suggestions.map((q) => (
            <button key={q} type="button" disabled={thinking} onClick={() => void send(q)}>
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className={styles.tin}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(ask);
        }}
      >
        <input aria-label="Ask your page" placeholder="Ask like a customer would" maxLength={500} value={ask} onChange={(event) => setAsk(event.target.value)} />
        <button type="submit" aria-label="Send" disabled={thinking || !ask.trim()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

/** The real `onAsk`. A server component cannot pass functions. */
export function Ask({ look, suggestions }: { look?: ChatLook; suggestions: string[] }) {
  return (
    <AskPanel
      look={look}
      suggestions={suggestions}
      onAsk={(question, history) =>
        apiFetch<{ reply: string; from: 'answer' | 'facts' }>('/chat/test', { method: 'POST', body: JSON.stringify({ question, history }) })
      }
    />
  );
}
