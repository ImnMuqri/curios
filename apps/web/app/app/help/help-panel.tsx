'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { HELP_SCREEN_NAMES, HELP_SUGGESTIONS, helpScreenFor, searchGuide, type PublicHelpEntry, type PublicHelpSection } from '@curios/core/help';
import { ApiError, apiFetch } from '../../../lib/api.js';
import { PeekBody } from '../_ui/peek.js';
import { SUPPORT_MAILTO } from './help-context.js';
import styles from './help.module.css';

/**
 * The dashboard's Help (design/help/help-chat-design.md, board "App · Help"). Answers come only
 * from the help guide, through POST /help/ask; the source strip and the screen button are built
 * from the entry id the API sends back, never from the model's words. Topics are the same guide,
 * searched here without a model, so they work while the chat rests. The thread survives closing the
 * panel and moving between screens, for the browser session.
 */

type Support = 'closed' | 'open' | 'sent';

export type HelpItem =
  | {
      kind: 'answer';
      /** The HelpQuestion row, for Yes/No and support. */
      id: string;
      /** What the owner asked, or the topic's question. */
      asked: string;
      answer: string;
      entry: { id: string; question: string; open: string | null };
      feedback: 'yes' | 'no' | null;
      support: Support;
    }
  | { kind: 'unknown'; id: string; asked: string; answer: string; support: Support }
  /** "Can't find it? Email support" from Topics: no question, only a note. */
  | { kind: 'direct'; support: Support }
  | { kind: 'pending'; asked: string };

type View = 'chat' | 'topics';

interface Stored {
  items: HelpItem[];
  view: View;
}

const STORE_KEY = 'curios-help';

function load(): Stored {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      // A question still waiting when the tab closed has no answer to come back to.
      return { items: parsed.items.filter((i) => i.kind !== 'pending'), view: parsed.view === 'topics' ? 'topics' : 'chat' };
    }
  } catch {
    // Unreadable or blocked: start fresh.
  }
  return { items: [], view: 'chat' };
}

function save(state: Stored) {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // No storage: the thread lasts while the page does.
  }
}

/** **bold** to <b>, lines to paragraphs. Nothing else from the answer becomes markup. */
function Answer({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n+/)
        .filter((line) => line.trim())
        .map((line, i) => (
          <p key={i} className={styles.text}>
            {line.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 === 1 ? <b key={j}>{part}</b> : <Fragment key={j}>{part}</Fragment>))}
          </p>
        ))}
    </>
  );
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const BookIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
  </svg>
);

const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** "Open Facts & sources", from the entry's screen. */
function openLabel(path: string): string {
  const name = HELP_SCREEN_NAMES[helpScreenFor(path)];
  return `Open ${name.replace(/^the /, '')}`;
}

function PeekWaving() {
  const clip = `hp-${useId().replace(/:/g, '')}`;
  return (
    <svg className={styles.peek} viewBox="0 0 160 150" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <ellipse cx="80" cy="84" rx="54" ry="49" />
        </clipPath>
      </defs>
      <ellipse cx="80" cy="143" rx="40" ry="4" fill="var(--line)" />
      <ellipse cx="63" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
      <ellipse cx="97" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
      <circle cx="19" cy="100" r="10" fill="var(--peek-hand)" />
      <circle cx="139" cy="60" r="10" fill="var(--peek-hand)" />
      <PeekBody clipId={clip} look={{ x: 67, y: 85 }} mouth="smile" />
    </svg>
  );
}

export function HelpPanel({
  firstName,
  email,
  onClose,
  navigate,
}: {
  firstName: string | null;
  email: string | null;
  onClose: () => void;
  /** Tests pass a spy; otherwise the router. */
  navigate?: (href: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/app';
  const screen = helpScreenFor(pathname);
  const go = navigate ?? ((href: string) => router.push(href));

  const [state, setState] = useState<Stored>({ items: [], view: 'chat' });
  const [loaded, setLoaded] = useState(false);
  const [guide, setGuide] = useState<PublicHelpSection[] | null>(null);
  const [resting, setResting] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openSection, setOpenSection] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setState(load());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) save(state);
  }, [state, loaded]);

  // The guide, once per panel: Topics, the suggestions' questions, and whether the chat is resting.
  useEffect(() => {
    let gone = false;
    apiFetch<{ sections: PublicHelpSection[]; chat: boolean }>('/help/guide')
      .then((g) => {
        if (gone) return;
        setGuide(g.sections);
        if (!g.chat) setResting(true);
      })
      .catch(() => {
        // Topics stay empty; the composer still works and support is still there.
      });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  useEffect(() => {
    if (state.view === 'chat') body.current?.scrollTo?.({ top: body.current.scrollHeight });
  }, [state.items.length, state.view]);

  const entries = useMemo(() => new Map((guide ?? []).flatMap((s) => s.entries.map((e) => [e.id, e] as const))), [guide]);

  const update = useCallback((fn: (items: HelpItem[]) => HelpItem[], view?: View) => {
    setState((was) => ({ items: fn(was.items), view: view ?? was.view }));
  }, []);
  const at = (i: number, patch: Partial<HelpItem>) =>
    update((items) => items.map((item, j) => (j === i ? ({ ...item, ...patch } as HelpItem) : item)));

  async function ask(question: string) {
    const text = question.trim();
    if (!text || resting) return;
    setError(null);
    setDraft('');
    // The last few answered turns, so "and yearly?" means something.
    const history = state.items
      .flatMap((item) => (item.kind === 'answer' || item.kind === 'unknown' ? [{ role: 'user' as const, content: item.asked }, { role: 'assistant' as const, content: item.answer }] : []))
      .slice(-6);
    update((items) => [...items, { kind: 'pending', asked: text }], 'chat');
    try {
      const res = await apiFetch<
        | { state: 'answer'; id: string; entryId: string; answer: string; question: string; open: string | null }
        | { state: 'unknown'; id: string; answer: string }
        | { state: 'resting' }
      >('/help/ask', { method: 'POST', body: JSON.stringify({ question: text, screen, history }) });
      if (res.state === 'resting') {
        setResting(true);
        update((items) => items.filter((i) => !(i.kind === 'pending' && i.asked === text)), 'topics');
        return;
      }
      const item: HelpItem =
        res.state === 'answer'
          ? { kind: 'answer', id: res.id, asked: text, answer: res.answer, entry: { id: res.entryId, question: res.question, open: res.open }, feedback: null, support: 'closed' }
          : { kind: 'unknown', id: res.id, asked: text, answer: res.answer, support: 'open' };
      update((items) => items.map((i) => (i.kind === 'pending' && i.asked === text ? item : i)));
    } catch (err) {
      update((items) => items.filter((i) => !(i.kind === 'pending' && i.asked === text)));
      setDraft(text);
      setError(err instanceof ApiError && err.status === 429 ? err.message : 'Help could not answer just now. Try again, or browse the topics.');
    }
  }

  async function pickTopic(entry: PublicHelpEntry) {
    setError(null);
    try {
      const { id } = await apiFetch<{ id: string }>('/help/topic', { method: 'POST', body: JSON.stringify({ entryId: entry.id, screen }) });
      update(
        (items) => [...items, { kind: 'answer', id, asked: entry.question, answer: entry.answer, entry: { id: entry.id, question: entry.question, open: entry.open }, feedback: null, support: 'closed' }],
        'chat',
      );
    } catch {
      setError('That topic could not open just now. Try again.');
    }
  }

  function feedback(i: number, item: Extract<HelpItem, { kind: 'answer' }>, helped: boolean) {
    at(i, { feedback: helped ? 'yes' : 'no', support: helped ? 'closed' : 'open' });
    void apiFetch(`/help/${encodeURIComponent(item.id)}/feedback`, { method: 'POST', body: JSON.stringify({ helped }) }).catch(() => {
      // A lost Yes/No is only a count.
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  function open(href: string) {
    go(href);
    // On a phone the panel covers the screen it just opened.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches) onClose();
  }

  const searched = query.trim() ? searchGuide(guide ?? [], query) : null;
  const suggestions = HELP_SUGGESTIONS[screen].map((id) => entries.get(id)).filter((e): e is PublicHelpEntry => Boolean(e));
  const empty = state.items.length === 0;
  const topics = state.view === 'topics';

  return (
    <>
      <button type="button" className={styles.scrim} aria-label="Close help" onClick={onClose} />
      <aside className={styles.panel} role="dialog" aria-modal="false" aria-labelledby="help-title">
        <div className={styles.head}>
          {topics ? (
            <button type="button" className={styles.iconButton} aria-label="Back to the chat" onClick={() => setState((s) => ({ ...s, view: 'chat' }))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          ) : null}
          <div className={styles.title}>
            <h2 id="help-title">{topics ? 'Help topics' : 'Help'}</h2>
            <p>Answers from the Curios help guide</p>
          </div>
          {topics ? null : (
            <button type="button" className={styles.iconButton} aria-label="Browse topics" title="Browse topics" onClick={() => setState((s) => ({ ...s, view: 'topics' }))}>
              <BookIcon />
            </button>
          )}
          <button type="button" className={styles.iconButton} aria-label="Close help" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className={styles.body} ref={body}>
          {topics ? (
            <>
              <label className={styles.search}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
                </svg>
                <input type="search" placeholder="Search the guide" aria-label="Search the guide" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <div className={styles.topics}>
                {searched ? (
                  searched.length > 0 ? (
                    <div className={styles.entries}>
                      {searched.map((e) => (
                        <button key={e.id} type="button" onClick={() => void pickTopic(e)}>
                          {e.question}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.none}>Nothing in the guide matches that.</p>
                  )
                ) : (
                  (guide ?? []).map((section, i) => (
                    <div key={section.title} className={styles.section}>
                      <button type="button" className={styles.sectionHead} aria-expanded={openSection === i} onClick={() => setOpenSection(openSection === i ? null : i)}>
                        <b>{section.title}</b>
                        <span>{section.entries.length} questions</span>
                        <Arrow />
                      </button>
                      {openSection === i ? (
                        <div className={styles.entries}>
                          {section.entries.map((e) => (
                            <button key={e.id} type="button" onClick={() => void pickTopic(e)}>
                              {e.question}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              <p className={styles.foot}>
                Can’t find it?{' '}
                <button type="button" onClick={() => update((items) => [...items, { kind: 'direct', support: 'open' }], 'chat')}>
                  Email support
                </button>
              </p>
            </>
          ) : empty ? (
            <>
              <div className={styles.empty}>
                <PeekWaving />
                <h3>{firstName ? `Hi ${firstName}. What can I help with?` : 'What can I help with?'}</h3>
                <p>I answer from the Curios help guide. If something isn’t in it, I’ll say so and you can ask our team.</p>
              </div>
              {suggestions.length > 0 ? (
                <>
                  <p className={styles.label}>People on {HELP_SCREEN_NAMES[screen]} often ask</p>
                  <div className={styles.suggestions}>
                    {suggestions.map((e) => (
                      <button key={e.id} type="button" onClick={() => void pickTopic(e)}>
                        <span>{e.question}</span>
                        <Arrow />
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <button type="button" className={styles.allTopics} onClick={() => setState((s) => ({ ...s, view: 'topics' }))}>
                <BookIcon />
                Browse all topics
              </button>
            </>
          ) : (
            state.items.map((item, i) => (
              <div key={i} className={styles.thread}>
                {item.kind !== 'direct' ? <p className={styles.question}>{item.asked}</p> : null}
                {item.kind === 'direct' ? null : (
                  <div>
                    <p className={styles.who}>
                      <span className={styles.mark} aria-hidden="true">
                        <i />
                        <i />
                      </span>
                      Curios help
                    </p>
                    {item.kind === 'pending' ? (
                      <span className={styles.typing} role="status" aria-label="Looking in the guide">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <Answer text={item.answer} />
                    )}
                    {item.kind === 'answer' ? (
                      <>
                        <div className={styles.source}>
                          <span>From the guide · {item.entry.question}</span>
                          {item.entry.open ? (
                            <button type="button" className={styles.open} onClick={() => open(item.entry.open!)}>
                              {openLabel(item.entry.open)}
                              <Arrow />
                            </button>
                          ) : null}
                        </div>
                        {item.feedback === null ? (
                          <div className={styles.feedback}>
                            <span>Did this help?</span>
                            <button type="button" aria-label="Yes, it helped" onClick={() => feedback(i, item, true)}>
                              Yes
                            </button>
                            <button type="button" aria-label="No, it didn’t help" onClick={() => feedback(i, item, false)}>
                              No
                            </button>
                          </div>
                        ) : item.feedback === 'yes' ? (
                          <p className={styles.glad}>
                            <Check />
                            Glad that helped.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )}
                {item.kind !== 'pending' && item.support !== 'closed' ? (
                  <SupportCard
                    email={email}
                    sent={item.support === 'sent'}
                    needsNote={item.kind === 'direct'}
                    send={async (note) => {
                      await apiFetch('/help/support', {
                        method: 'POST',
                        body: JSON.stringify({ ...(item.kind === 'direct' ? {} : { id: item.id }), ...(note.trim() ? { note } : {}), screen }),
                      });
                      at(i, { support: 'sent' });
                    }}
                  />
                ) : null}
              </div>
            ))
          )}
        </div>

        {topics ? null : (
          <form className={styles.composer} onSubmit={onSubmit}>
            {resting ? (
              <p className={styles.resting} role="status">
                Help chat is resting.{' '}
                <button type="button" onClick={() => setState((s) => ({ ...s, view: 'topics' }))}>
                  Search the guide instead.
                </button>
              </p>
            ) : null}
            <div className={styles.composerRow}>
              <input ref={input} aria-label="Ask about Curios" placeholder="Ask about Curios…" value={draft} maxLength={500} disabled={resting} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" aria-label="Ask" disabled={resting || !draft.trim()}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </form>
        )}
        {topics && error ? (
          <p className={`${styles.error} ${styles.topicsError}`} role="alert">
            {error}
          </p>
        ) : null}
      </aside>
    </>
  );
}

function SupportCard({ email, sent, needsNote, send }: { email: string | null; sent: boolean; needsNote: boolean; send: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const to: ReactNode = email ? <b>{email}</b> : 'your email';

  if (sent) {
    return (
      <div className={styles.sent} role="status">
        <p className={styles.supportTitle}>
          <Check />
          Sent to support
        </p>
        <p className={styles.supportText}>
          We’ll reply to {to} by email. You can keep asking here in the meantime.
        </p>
      </div>
    );
  }

  async function submit() {
    if (needsNote && !note.trim()) {
      setError('Write what you need help with.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await send(note);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : 'It didn’t send. Try again, or email support@curios.my.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.support}>
      <p className={styles.supportTitle}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
        </svg>
        Still stuck? Email support
      </p>
      <p className={styles.supportText}>
        {needsNote ? <>Tell the Curios team what you need. They reply to {to}.</> : <>We’ll send this question and the answer above to the Curios team. They reply to {to}.</>}
      </p>
      <textarea
        className={styles.note}
        aria-label={needsNote ? 'What you need help with' : 'Anything to add'}
        placeholder={needsNote ? 'What do you need help with?' : 'Anything to add? What you tried, what you expected…'}
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className={styles.supportButtons}>
        <button type="button" className={styles.send} disabled={busy} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Send to support'}
        </button>
        <a className={styles.mailto} href={SUPPORT_MAILTO}>
          or email support@curios.my
        </a>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
