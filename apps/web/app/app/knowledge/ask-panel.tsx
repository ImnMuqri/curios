'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Thinking } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';
import { PageReply } from '../_ui/page-reply.js';
import { VisitorQuestion } from '../_ui/visitor-question.js';
import styles from './knowledge.module.css';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Where an answer came from: the owner's own words, the facts, the month's limit, or chat paused by the Curios team. */
  from?: 'answer' | 'facts' | 'limit' | 'off';
  /** For an answer from the facts: where those facts came from ("keklina.example/menu"). */
  sources?: string[];
}

/** What the tester answers with. */
export type TestAnswer = { reply: string; from: 'answer' | 'facts' | 'limit' | 'off'; sources?: string[] };

/** How many earlier turns go with a question: the API takes ten. */
const HISTORY = 10;

/**
 * Peek standing and whistling, eyes up, while nothing has been asked yet: the
 * Knowledge board's `.pw`, in the mascot's tokens. It bobs and two notes float
 * up from it, unless the device asks for less motion (knowledge.module.css).
 * The clip that shades the body needs an id of its own on the page.
 */
function PeekWhistling() {
  const clip = `pw-${useId().replace(/:/g, '')}`;
  return (
    <svg className={styles.pw} viewBox="0 0 200 170" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <ellipse cx="90" cy="88" rx="54" ry="49" />
        </clipPath>
      </defs>
      <ellipse cx="90" cy="160" rx="46" ry="4.5" className={styles.pwGround} />
      <ellipse cx="73" cy="148" rx="13" ry="8" fill="var(--peek-foot)" />
      <ellipse cx="107" cy="148" rx="13" ry="8" fill="var(--peek-foot)" />
      <g className={styles.pwBob}>
        <circle cx="37" cy="112" r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
        <circle cx="143" cy="112" r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
        <g clipPath={`url(#${clip})`}>
          <rect x="30" y="34" width="120" height="110" fill="var(--peek-shade)" />
          <ellipse cx="83" cy="80" rx="54" ry="48" fill="var(--peek-body)" />
        </g>
        <ellipse cx="65" cy="58" rx="9" ry="5" fill="var(--peek-shine)" transform="rotate(-30 65 58)" />
        {/* Eyes up, to the notes. */}
        <ellipse cx="76" cy="84" rx="11.5" ry="13.5" fill="var(--on-photo)" />
        <ellipse cx="105" cy="84" rx="11.5" ry="13.5" fill="var(--on-photo)" />
        <circle cx="80" cy="79" r="6.6" fill="var(--light-ink)" />
        <circle cx="109" cy="79" r="6.6" fill="var(--light-ink)" />
        <circle cx="82.2" cy="76" r="2.1" fill="var(--on-photo)" />
        <circle cx="111.2" cy="76" r="2.1" fill="var(--on-photo)" />
        {/* The whistling "o". */}
        <ellipse cx="99" cy="107" rx="3.6" ry="4.2" fill="var(--light-ink)" />
      </g>
      <g className={styles.pwNote1}>
        <g transform="translate(16 -12)" className={styles.pwInk}>
          <path d="M126 70v-14l9-3v13" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="123.5" cy="70.5" rx="3.6" ry="2.8" />
          <ellipse cx="132.5" cy="67" rx="3.6" ry="2.8" />
        </g>
      </g>
      <g className={styles.pwNote2}>
        <g transform="translate(14 -8)" className={styles.pwInk}>
          <path d="M150 48V36" fill="none" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M150 36q6 2 5 8" fill="none" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="147.5" cy="48.5" rx="3.6" ry="2.8" />
        </g>
      </g>
    </svg>
  );
}

/**
 * "Ask your page": the owner asks a question the way a customer would, and
 * sees what the chat says, from only what is on this screen. Nothing it asks
 * reaches Questions or the month's conversations (POST /chat/test).
 * Presentational: `onAsk` is injected.
 *
 * A normal AI chat on the dashboard's neutral panel (Dashboard v2), not the
 * page's own colours: this is the owner's tool, so it follows the dashboard
 * into dark mode, and its send button is the brand's.
 */
export function AskPanel({
  pageName,
  suggestions,
  onAsk,
}: {
  /** The page's display name, for the "{Name}’s page" label above its answers. */
  pageName?: string;
  suggestions: string[];
  onAsk: (question: string, history: Turn[]) => Promise<TestAnswer>;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ask, setAsk] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const chat = useRef<HTMLDivElement>(null);

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
      setTurns((prev) => [...prev, { role: 'assistant', content: answer.reply, from: answer.from, sources: answer.sources }]);
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
    <aside className={styles.tester} aria-label="Try your page">
      <h2>Ask your page</h2>
      <p>Test what the chat says, using only what&apos;s here.</p>

      <div ref={chat} className={styles.tchat} role="log" aria-live="polite" aria-label="Your page's answers">
        {turns.length === 0 && !thinking ? (
          <div className={styles.tempty}>
            <PeekWhistling />
            <b>Nothing asked yet</b>
            <span>Ask the way a customer would. Your page answers only from the facts on the left.</span>
          </div>
        ) : null}
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <VisitorQuestion key={i} className={styles.u}>
              {turn.content}
            </VisitorQuestion>
          ) : (
            <span key={i} style={{ display: 'contents' }}>
              <PageReply name={pageName} className={styles.a}>
                {turn.content}
              </PageReply>
              {turn.from === 'answer' || turn.from === 'limit' || turn.from === 'off' || (turn.from === 'facts' && turn.sources?.length) ? (
                <span className={styles.from}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  {turn.from === 'answer'
                    ? 'Your answer on Questions'
                    : turn.from === 'limit'
                      ? 'The fixed reply: this month’s limit is reached'
                      : turn.from === 'off'
                        ? 'Chat is paused across Curios for a moment, so your page gives the short fixed reply. It’s not your monthly limit.'
                        : (turn.sources ?? []).join(' · ')}
                </span>
              ) : null}
            </span>
          ),
        )}
        {thinking ? (
          <PageReply name={pageName} className={styles.a} label="Inquiring">
            <Thinking />
          </PageReply>
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
export function Ask({ pageName, suggestions }: { pageName?: string; suggestions: string[] }) {
  return (
    <AskPanel
      pageName={pageName}
      suggestions={suggestions}
      onAsk={(question, history) =>
        apiFetch<TestAnswer>('/chat/test', { method: 'POST', body: JSON.stringify({ question, history }) })
      }
    />
  );
}
