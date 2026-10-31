'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AdminPlan } from '@curios/core';
import { API_BASE, ApiError, apiFetch } from '../../../lib/api.js';
import { ago } from '../ago.js';
import { day, dayTime } from '../pages/format.js';
import { EmailFrame } from './email-frame.js';
import styles from './support.module.css';

// The API's JSON shapes (apps/api/src/modules/admin/admin-support.service.ts), dates as ISO strings.
export type SupportStatus = 'OPEN' | 'DONE' | 'SPAM';

export interface SupportThread {
  id: string;
  address: string;
  name: string | null;
  subject: string;
  status: SupportStatus;
  unread: boolean;
  lastMessageAt: string;
  attachmentCount: number;
  owner: { pageId: string; handle: string; displayName: string } | null;
}

export interface SupportMessage {
  id: string;
  direction: 'IN' | 'OUT';
  fromAddress: string;
  fromName: string | null;
  createdAt: string;
  text: string | null;
  html: string | null;
  /** OUT only. */
  sendStatus: 'SENDING' | 'SENT' | 'FAILED' | null;
  sentBy: { name: string } | null;
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number; inline: boolean }[];
}

export interface SupportThreadDetail {
  thread: SupportThread;
  owner: { pageId: string; handle: string; displayName: string; plan: AdminPlan; paidUntil: string | null } | null;
  messages: SupportMessage[];
}

type Filter = 'open' | 'done' | 'all' | 'spam';
type Counts = { open: number; done: number; spam: number };

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
  { key: 'spam', label: 'Spam' },
];

/**
 * While a reply is Sending, the thread is read again so it turns Sent or Not sent on its own: after
 * 5 s, then twice as long each time up to a minute, and 12 times at most per conversation opened.
 */
const SENDING_POLL_MS = 5000;
const SENDING_POLL_MAX_MS = 60_000;
const SENDING_POLLS = 12;
/** The API's STUCK_SENDING_MS: a reply Sending this long is taken as lost, and may be sent again. */
const STUCK_SENDING_MS = 15 * 60_000;

const isStuck = (m: SupportMessage) => m.sendStatus === 'SENDING' && Date.now() - Date.parse(m.createdAt) > STUCK_SENDING_MS;

/** The sending address's mailbox, "support@" or "hello@": an admin email does not go from support. */
const fromMailbox = (address: string) => `from ${address.slice(0, address.indexOf('@') + 1) || address}`;

function listPath(filter: Filter, q: string, before?: string): string {
  const qs = new URLSearchParams({ status: filter });
  if (q) qs.set('q', q);
  if (before) qs.set('before', before);
  return `/admin/support/threads?${qs.toString()}`;
}

const threadPath = (id: string) => `/admin/support/threads/${encodeURIComponent(id)}`;

/** A plain link, not a fetch: the admin cookie goes with it (same site) and the browser saves the file. */
const attachmentHref = (id: string) => `${API_BASE}/admin/support/attachments/${encodeURIComponent(id)}`;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something failed. Try again.');

/** Newest activity first, as the API orders them. */
const byLatest = (a: SupportThread, b: SupportThread) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);

export function SupportScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('open');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportThreadDetail | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The conversation the admin wants now: a slow answer for an earlier click is dropped.
  const wanted = useRef<string | null>(null);
  // Conversations whose read is being posted: a double click on an unread row posts it once. Once
  // it lands, the thread itself answers unread: false, so the id needs holding only until then.
  const marking = useRef(new Set<string>());
  // Reads of the open conversation made for a Sending reply; starts again with each send.
  const polls = useRef(0);

  function loadCounts() {
    apiFetch<Counts>('/admin/support/counts')
      .then(setCounts)
      .catch(() => setCounts(null));
  }

  useEffect(loadCounts, []);

  useEffect(() => {
    let live = true;
    setListError(null);
    apiFetch<{ threads: SupportThread[]; next: string | null }>(listPath(filter, q))
      .then((r) => {
        if (!live) return;
        setThreads(r.threads);
        setNext(r.next);
      })
      .catch(() => live && setListError('Couldn’t load conversations. Try again.'));
    return () => {
      live = false;
    };
  }, [filter, q]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Reads the open conversation again, without marking anything read. */
  async function reload(id: string) {
    try {
      const d = await apiFetch<SupportThreadDetail>(threadPath(id));
      if (wanted.current === id) setDetail(d);
    } catch {
      // The conversation on screen stays as it was; the next action or poll tries again.
    }
  }

  // A reply that is Sending turns Sent or Not sent when the mail worker is done with it.
  useEffect(() => {
    if (!detail?.messages.some((m) => m.sendStatus === 'SENDING') || polls.current >= SENDING_POLLS) return;
    const id = detail.thread.id;
    const delay = Math.min(SENDING_POLL_MS * 2 ** polls.current, SENDING_POLL_MAX_MS);
    const t = setTimeout(() => {
      polls.current += 1;
      void reload(id);
    }, delay);
    return () => clearTimeout(t);
  }, [detail]);

  async function open(id: string) {
    wanted.current = id;
    polls.current = 0;
    setOpenId(id);
    setDetail(null);
    setThreadError(null);
    setReplyError(null);
    setDraft('');
    let d: SupportThreadDetail;
    try {
      d = await apiFetch<SupportThreadDetail>(threadPath(id));
    } catch (e) {
      if (wanted.current === id) setThreadError(errorText(e));
      return;
    }
    if (wanted.current !== id) return;
    setDetail(d);
    if (!d.thread.unread || marking.current.has(id)) return;
    marking.current.add(id);
    try {
      await apiFetch(`${threadPath(id)}/read`, { method: 'POST' });
    } catch {
      // Still shown unread; opening it again tries again.
      return;
    } finally {
      marking.current.delete(id);
    }
    setThreads((ts) => ts?.map((t) => (t.id === id ? { ...t, unread: false } : t)) ?? ts);
    setDetail((cur) => (cur?.thread.id === id ? { ...cur, thread: { ...cur.thread, unread: false } } : cur));
  }

  function close() {
    wanted.current = null;
    setOpenId(null);
    setDetail(null);
    setThreadError(null);
  }

  async function more() {
    if (!next) return;
    try {
      const r = await apiFetch<{ threads: SupportThread[]; next: string | null }>(listPath(filter, q, next));
      setThreads((ts) => [...(ts ?? []), ...r.threads]);
      setNext(r.next);
    } catch (e) {
      setListError(errorText(e));
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!detail || !body || busy) return;
    const id = detail.thread.id;
    setBusy(true);
    setReplyError(null);
    try {
      const { message } = await apiFetch<{ message: SupportMessage }>(`${threadPath(id)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: body }),
      });
      setDraft('');
      polls.current = 0;
      setDetail((cur) => (cur?.thread.id === id ? { ...cur, messages: [...cur.messages, message] } : cur));
      setThreads((ts) => ts?.map((t) => (t.id === id ? { ...t, lastMessageAt: message.createdAt } : t)).sort(byLatest) ?? ts);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REPLY_NOT_QUEUED') {
        // The API kept the reply, marked Not sent: show it with its Retry rather than keep a draft
        // that would send it twice.
        setDraft('');
        setReplyError('Not sent: the mail queue could not be reached. Your reply is kept below. Press Retry on it.');
        await reload(id);
      } else {
        setReplyError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function retry(messageId: string) {
    if (!detail) return;
    const id = detail.thread.id;
    setReplyError(null);
    try {
      await apiFetch(`/admin/support/messages/${encodeURIComponent(messageId)}/retry`, { method: 'POST' });
    } catch (err) {
      // NOT_FAILED: it went, or another click already queued it. The thread says which.
      if (err instanceof ApiError && err.code === 'NOT_FAILED') await reload(id);
      else setReplyError(errorText(err));
      return;
    }
    // The API restarts the message's clock when it sends it again, so it is not Still sending at once.
    polls.current = 0;
    const now = new Date().toISOString();
    setDetail((cur) =>
      cur?.thread.id === id
        ? { ...cur, messages: cur.messages.map((m) => (m.id === messageId ? { ...m, sendStatus: 'SENDING', createdAt: now } : m)) }
        : cur,
    );
  }

  async function move(status: 'OPEN' | 'DONE', done: string) {
    if (!detail) return;
    const id = detail.thread.id;
    setBusy(true);
    setReplyError(null);
    try {
      await apiFetch(`${threadPath(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    } catch (err) {
      setReplyError(errorText(err));
      return;
    } finally {
      setBusy(false);
    }
    setDetail((cur) => (cur?.thread.id === id ? { ...cur, thread: { ...cur.thread, status } } : cur));
    // It stays on screen, but leaves a list it no longer belongs in.
    setThreads((ts) =>
      ts
        ?.map((t) => (t.id === id ? { ...t, status } : t))
        .filter((t) => t.id !== id || filter === 'all' || filter === status.toLowerCase()) ?? ts,
    );
    setToast(done);
    loadCounts();
    // The sidebar's Open count comes from the server layout.
    router.refresh();
  }

  const thread = detail?.thread;

  return (
    <>
      <div className={styles.head}>
        <h1>Support</h1>
        <p>Mail to support@curios.my</p>
      </div>

      <div className={styles.body}>
        <div className={styles.split} data-open={openId ? 'true' : undefined}>
          <section className={styles.side} aria-label="Conversation list">
            <form
              className={styles.search}
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setQ(text.trim());
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
              </svg>
              <input
                type="search"
                aria-label="Search conversations"
                placeholder="Sender or subject"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </form>

            <nav className={styles.tabs} aria-label="Filter conversations">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={styles.tab}
                  aria-current={f.key === filter ? 'true' : undefined}
                  onClick={() => {
                    setFilter(f.key);
                    setNext(null);
                  }}
                >
                  {f.label}
                  {f.key === 'open' && counts ? <small>{counts.open}</small> : null}
                </button>
              ))}
            </nav>

            {listError && (
              <p className={styles.error} role="alert">
                {listError}
              </p>
            )}
            <ul className={styles.list} aria-label="Conversations">
              {threads?.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={styles.item}
                    data-unread={t.unread ? 'true' : undefined}
                    aria-current={t.id === openId ? 'true' : undefined}
                    onClick={() => void open(t.id)}
                  >
                    <span className={styles.who}>
                      {t.unread && (
                        <>
                          <i className={styles.dot} aria-hidden="true" />
                          <span className={styles.sr}>Unread</span>
                        </>
                      )}
                      <b>{t.owner ? t.owner.displayName : t.address}</b>
                      <time dateTime={t.lastMessageAt}>{ago(new Date(t.lastMessageAt), new Date())}</time>
                    </span>
                    {t.owner && <code className={styles.mono}>curios.my/{t.owner.handle}</code>}
                    <span className={styles.subj}>
                      <span>{t.subject}</span>
                      {t.attachmentCount > 0 && (
                        <span
                          className={styles.clip}
                          role="img"
                          aria-label={`${t.attachmentCount} ${t.attachmentCount === 1 ? 'attachment' : 'attachments'}`}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
                          </svg>
                          {t.attachmentCount}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {threads?.length === 0 && <li className={styles.empty}>{q ? `Nothing matches “${q}”.` : 'Nothing here.'}</li>}
            </ul>
            {next && (
              <button type="button" className={styles.more} onClick={() => void more()}>
                Older
              </button>
            )}
          </section>

          <section className={styles.conv} aria-label="Conversation">
            {!openId && <p className={styles.pick}>Pick a conversation to read it.</p>}
            {openId && (
              <button type="button" className={styles.back} onClick={close}>
                Back to conversations
              </button>
            )}
            {threadError && (
              <p className={styles.error} role="alert">
                {threadError}
              </p>
            )}
            {openId && !detail && !threadError && <p className={styles.pick}>Opening…</p>}

            {detail && thread && (
              <>
                <div className={styles.top}>
                  <h2>{thread.subject}</h2>
                  <p>
                    {thread.name ? `${thread.name} · ` : ''}
                    <span className={styles.mono}>{thread.address}</span>
                    <span className={styles.state}>{thread.status === 'OPEN' ? 'Open' : thread.status === 'DONE' ? 'Done' : 'Spam'}</span>
                  </p>
                </div>

                {detail.owner && (
                  <section className={styles.owner} aria-label="Owner">
                    <div>
                      <b>{detail.owner.displayName}</b>
                      <code className={styles.mono}>curios.my/{detail.owner.handle}</code>
                    </div>
                    <dl>
                      <dt>Plan</dt>
                      <dd>{detail.owner.plan}</dd>
                      <dt>Paid until</dt>
                      <dd>{detail.owner.paidUntil ? day(new Date(detail.owner.paidUntil)) : '-'}</dd>
                    </dl>
                    <Link href={`/pages?page=${encodeURIComponent(detail.owner.pageId)}`}>Open in Pages</Link>
                  </section>
                )}

                <ol className={styles.msgs} aria-label="Messages">
                  {detail.messages.map((m) => (
                    <li key={m.id} className={styles.msg} data-dir={m.direction === 'OUT' ? 'out' : 'in'}>
                      <div className={styles.from}>
                        <b>{m.direction === 'OUT' ? (m.sentBy?.name ?? 'Curios Support') : (m.fromName ?? m.fromAddress)}</b>
                        <span>{m.direction === 'OUT' ? fromMailbox(m.fromAddress) : m.fromName ? m.fromAddress : ''}</span>
                        <time dateTime={m.createdAt}>{dayTime(new Date(m.createdAt))}</time>
                        {m.sendStatus === 'SENDING' && !isStuck(m) && <em className={styles.sending}>Sending…</em>}
                        {(m.sendStatus === 'FAILED' || isStuck(m)) && (
                          <>
                            <em className={styles.failed}>{m.sendStatus === 'FAILED' ? 'Not sent' : 'Still sending'}</em>
                            <button type="button" className={styles.link} onClick={() => void retry(m.id)}>
                              Retry
                            </button>
                          </>
                        )}
                      </div>
                      {m.html ? <EmailFrame html={m.html} text={m.text} /> : <div className={styles.text}>{m.text}</div>}
                      {m.attachments.length > 0 && (
                        <ul className={styles.files} aria-label="Attachments">
                          {m.attachments.map((a) => (
                            <li key={a.id}>
                              <a href={attachmentHref(a.id)} download={a.fileName}>
                                {/^image\/(?!svg)/i.test(a.contentType) ? (
                                  <img src={attachmentHref(a.id)} alt="" loading="lazy" />
                                ) : (
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M14 3H6v18h12V7zM14 3v4h4" />
                                  </svg>
                                )}
                                <span>{a.fileName}</span>
                                <small>{size(a.sizeBytes)}</small>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>

                <form className={styles.reply} onSubmit={(e) => void send(e)}>
                  <textarea
                    aria-label="Reply"
                    placeholder={`Reply to ${thread.address}`}
                    rows={5}
                    maxLength={20000}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {replyError && (
                    <p className={styles.error} role="alert">
                      {replyError}
                    </p>
                  )}
                  <div className={styles.acts}>
                    <p>Plain text, from support@curios.my.</p>
                    {thread.status === 'SPAM' ? (
                      <button type="button" className={styles.ghost} disabled={busy} onClick={() => void move('OPEN', 'Moved to Open.')}>
                        Not spam
                      </button>
                    ) : thread.status === 'DONE' ? (
                      <button type="button" className={styles.ghost} disabled={busy} onClick={() => void move('OPEN', 'Reopened.')}>
                        Reopen
                      </button>
                    ) : (
                      <button type="button" className={styles.ghost} disabled={busy} onClick={() => void move('DONE', 'Marked done.')}>
                        Mark done
                      </button>
                    )}
                    <button type="submit" className={styles.prim} disabled={busy || !draft.trim()}>
                      Send reply
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      </div>

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
