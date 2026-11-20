'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { OwnerTopic, QuestionWeek, TopicChoice, TopicTotals } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { EmptyPeek } from '../_ui/empty-peek.js';
import inbox from '../_ui/inbox.module.css';
import { useRouteView } from '../_ui/own-view.js';
import { PageHead } from '../_ui/page-head.js';
import { Pager } from '../_ui/pager.js';
import { changeTone, StatStrip, type StatCard } from '../_ui/stat-strip.js';
import { useToast } from '../_ui/toast.js';
import { CHIP_WORDS, plural, toMessage, TopicDetail, topicState, type ChatLook, type TopicActions } from './topic-detail.js';
import styles from './questions.module.css';

/** The chips. The old "Chat answers" one is gone (owner, 19 Nov 2026); `?show=chat` opens as All. */
type Filter = 'all' | 'needs' | 'answered';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs', label: 'Needs you' },
  { id: 'answered', label: 'Answered' },
];

/** What a filter that matches nothing says. */
const EMPTY: Record<Exclude<Filter, 'all'>, [string, string]> = {
  needs: ['Nothing needs you', 'Questions the chat is not sure about land here.'],
  answered: ['Nothing answered yet', 'Answer a topic and it moves here.'],
};

/** How many ways a card names before "+N more": the rest are on the topic's own screen. */
const WAYS_SHOWN = 6;

/** Whether a topic belongs in a filter, as the server filters them (a chat-answered one is in neither Needs you nor Answered). */
const inFilter = (filter: Filter, topic: OwnerTopic) => {
  const state = topicState(topic);
  return filter === 'all' || (filter === 'needs' ? state === 'needs' || state === 'conflict' : state === 'answered');
};

/** Whether a topic answers the search box: its title, or any way people asked it. */
export function topicMatches(topic: OwnerTopic, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return topic.title.toLowerCase().includes(q) || topic.wordings.some((wording) => wording.text.toLowerCase().includes(q));
}

/** The "Asked this week" card's line: signed against last week, or the same. */
export function weekLine(thisWeek: number, lastWeek: number): string {
  const diff = thisWeek - lastWeek;
  if (diff === 0) return 'Same as last week';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} on last week`;
}

/** Of the week's asks with a recorded outcome, the share the page answered: 0..1, and 0 (never NaN) when none was recorded (the card then shows a dash). */
export function answerShare({ answered, recorded }: { answered: number; recorded: number }): number {
  return recorded > 0 ? Math.min(1, Math.max(0, answered / recorded)) : 0;
}

/** The list's address for a filter and page: the first page of All is plain /app/questions. */
export function listHref(show: Filter, page = 1): string {
  const query = new URLSearchParams();
  if (show !== 'all') query.set('show', show);
  if (page > 1) query.set('page', String(page));
  const text = query.toString();
  return text ? `/app/questions?${text}` : '/app/questions';
}

/** A topic's own screen. The list's filter and page ride along, so "‹ Questions" goes back to where it was. */
export function topicHref(id: string, show: Filter = 'all', page = 1): string {
  const query = new URLSearchParams({ topic: id });
  if (show !== 'all') query.set('show', show);
  if (page > 1) query.set('page', String(page));
  return `/app/questions?${query.toString()}`;
}

/**
 * What visitors ask, grouped by topic, on the calm board (Dash.html `questions` and `topic`).
 *
 * The list: the header ("Inbox", Questions, one line, See your FAQ), three stat cards (the topics
 * waiting on an answer, the share the page answered this week with its bar, this week's asks with
 * their spark), the chips and search, then a card for each topic, most asked first: its name (a
 * link to its own screen), how many asks in how many ways, the ways, and either a box to write
 * its answer once or the answer. The search narrows the topics on this page; the chips and the
 * pager go to the server.
 *
 * A topic's own screen (`topic`, from `?topic=`) is a screen of its own at every width: "‹ Questions"
 * back, then its rows (TopicDetail). Focus goes to its heading on the way in and back to the topic's
 * title link (or the first card) on the way out, the screen scrolled to the top each time.
 *
 * Presentational: it takes the rows and the mutations, and `Questions` below supplies the real ones.
 */
export function QuestionsScreen({
  topics,
  topic = null,
  paging = { page: 1, pages: 1 },
  show = 'all',
  onShow,
  onGo,
  totals,
  choices,
  week,
  answerRate,
  publishesFaq,
  faqMinAsks,
  handle,
  publicUrl,
  answerMax,
  titleMax,
  look,
  pageName,
  now,
  actions,
  onChanged,
}: {
  topics: OwnerTopic[];
  /** The topic whose own screen is open (`?topic=`); the list is not on screen then. */
  topic?: OwnerTopic | null;
  /** Which seven, most asked first, and how many pages of them the filter has. */
  paging?: { page: number; pages: number };
  /** The filter the server applied before paging (`?show=`). */
  show?: Filter;
  /** Asks the server for another filter's list; left out, a filter only narrows the topics in hand. */
  onShow?: (show: Filter) => void;
  /** Goes to an address (after a merge or a delete, the topic's screen is not the place to stay). */
  onGo?: (href: string) => void;
  /** Figures over every topic, not this screenful; left out, they are counted from `topics`. */
  totals?: TopicTotals;
  /** Every topic, to merge into from any page; left out, the topics in hand. */
  choices?: TopicChoice[];
  week: QuestionWeek;
  /** Of the last seven days' asks with a recorded outcome, how many the chat could answer. */
  answerRate: { answered: number; recorded: number };
  /** Whether this page publishes /faq pages -- false for a personal page. */
  publishesFaq: boolean;
  faqMinAsks: number;
  handle: string;
  /** The page's full address, for "Copy your link". */
  publicUrl: string;
  answerMax: number;
  titleMax: number;
  look: ChatLook;
  pageName: string;
  now: Date;
  actions: TopicActions;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(show);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  // What each card is typing, and what was just saved from it (shown until the server's read brings it back).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { say, fail, toast } = useToast();
  const screenRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  // A fresh read from the server is the truth again.
  useEffect(() => setSaved({}), [topics]);

  // The topic screen is its own route: scrolled to the top and focused on the way in, back on its card on the way out.
  useRouteView({ screen: screenRef, openId: topic?.id ?? null, row: (id) => `[data-topic-link="${CSS.escape(id)}"]`, firstRow: '[data-topic-link]' });

  const waiting = totals?.topics.needs ?? topics.filter((t) => inFilter('needs', t)).length;
  const answeredTopics = totals?.topics.answered ?? topics.filter((t) => topicState(t) === 'answered').length;
  const rate = answerShare(answerRate);
  const shown = topics.filter((t) => inFilter(filter, t) && topicMatches(t, query));

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard here: the address is in the page's own header to select.
    }
  }

  async function saveCard(t: OwnerTopic) {
    const text = (drafts[t.id] ?? '').trim();
    if (inFlight.current || text === '' || [...text].length > answerMax) return;
    inFlight.current = true;
    setSaving(t.id);
    try {
      await actions.answer(t.id, text);
      setSaved((current) => ({ ...current, [t.id]: text }));
      setDrafts((current) => {
        const { [t.id]: _gone, ...rest } = current;
        return rest;
      });
      say(`Saved. The chat now answers all ${plural(t.wordings.length, 'way')} with it.`);
      onChanged();
    } catch (failure) {
      fail(toMessage(failure));
    } finally {
      inFlight.current = false;
      setSaving(null);
    }
  }

  function choose(next: Filter) {
    setFilter(next);
    onShow?.(next);
  }

  const cards: StatCard[] = [
    {
      id: 'needs',
      label: 'Needs your answer',
      value: waiting,
      urgent: true,
      filter: 'needs',
      go: (
        <>
          Answer it <span aria-hidden="true">→</span>
        </>
      ),
    },
    {
      id: 'rate',
      label: 'Answered by your page',
      // Nothing recorded this week: no rate to give (a 0% would say the page failed every question).
      // 0% only when asks were recorded and none was answered.
      value: answerRate.recorded > 0 ? `${Math.round(rate * 100)}%` : '–',
      line: answerRate.recorded > 0 ? `${answerRate.answered} of ${answerRate.recorded} this week` : week.thisWeek > 0 ? 'No answers recorded yet' : 'Nothing asked this week',
      lineTone: answerRate.recorded > 0 && rate > 0 ? 'up' : 'flat',
      rate: answerRate.recorded > 0 ? rate : undefined,
    },
    {
      id: 'week',
      label: 'Asked this week',
      value: week.thisWeek,
      line: weekLine(week.thisWeek, week.lastWeek),
      lineTone: changeTone(week.thisWeek - week.lastWeek),
      // Exactly the week: seven Malaysian days, today last.
      spark: Array.from({ length: 7 }, (_, i) => week.days[week.days.length - 7 + i] ?? 0),
    },
  ];

  // Nothing to answer yet: the totals say so over every topic; without them, the topics in hand.
  const none = (totals ? totals.topics.all : topics.length) === 0 && topic === null;

  return (
    <>
      <div ref={screenRef} className={inbox.screen}>
        {topic ? (
          <TopicDetail
            key={topic.id}
            topic={topic}
            others={(choices ?? topics).filter((t) => t.id !== topic.id)}
            backHref={listHref(show, paging.page)}
            hrefFor={(id) => topicHref(id, show, paging.page)}
            publishesFaq={publishesFaq}
            faqMinAsks={faqMinAsks}
            handle={handle}
            answerMax={answerMax}
            titleMax={titleMax}
            look={look}
            pageName={pageName}
            now={now}
            actions={actions}
            onChanged={onChanged}
            onGo={(href) => onGo?.(href)}
            say={say}
            fail={fail}
          />
        ) : (
          <>
            <PageHead kicker="Inbox" title="Questions" summary="Answer a topic once and your page uses it for every way people ask.">
              {publishesFaq ? (
                <a className={styles.litePill} href={`/${handle}/faq`} target="_blank" rel="noreferrer">
                  See your FAQ
                </a>
              ) : null}
            </PageHead>

            <div className={inbox.body}>
              {none ? (
                <EmptyPeek
                  title="No questions yet"
                  line="When visitors ask your page something, it lands here, grouped by topic. Answer once and the chat uses it for every way people ask."
                >
                  <button type="button" className={styles.darkPill} onClick={() => void copyLink()}>
                    {copied ? 'Copied' : 'Copy your link'}
                  </button>
                  <a className={styles.litePill} href={`/${handle}#ask`} target="_blank" rel="noreferrer">
                    Try asking your page
                  </a>
                </EmptyPeek>
              ) : (
                <>
                  <StatStrip label="Questions at a glance" cards={cards} active={filter === 'needs' ? 'needs' : null} onFilter={(next) => choose((next as Filter | null) ?? 'all')} />

                  <div className={inbox.fbar}>
                    <div className={inbox.chips} role="group" aria-label="Show topics">
                      {FILTERS.map((f) => {
                        // One count everywhere: the chip says what the card says (and the sidebar badge).
                        const count = f.id === 'needs' ? waiting : f.id === 'answered' ? answeredTopics : 0;
                        return (
                          <button key={f.id} type="button" className={inbox.chip} aria-pressed={filter === f.id} onClick={() => choose(f.id)}>
                            {f.label}
                            {count > 0 ? <u>{count}</u> : null}
                          </button>
                        );
                      })}
                    </div>
                    <label className={inbox.search}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d="M20 20l-3.5-3.5" />
                      </svg>
                      <input type="search" value={query} placeholder="Search questions" aria-label="Search questions" onChange={(event) => setQuery(event.target.value)} />
                    </label>
                  </div>

                  {shown.length === 0 ? (
                    query.trim() ? (
                      <p className={styles.empty}>
                        <b>No match</b>
                        <small>No topic on this page matches “{query.trim()}”.</small>
                      </p>
                    ) : filter !== 'all' ? (
                      <p className={styles.empty}>
                        <b>{EMPTY[filter][0]}</b>
                        <small>{EMPTY[filter][1]}</small>
                      </p>
                    ) : null
                  ) : (
                    <ul className={styles.qa} aria-label="Topics">
                      {shown.map((t, i) => {
                        const answer = saved[t.id] ?? t.answer;
                        const state = topicState({ ...t, answer });
                        const text = drafts[t.id] ?? '';
                        const length = [...text.trim()].length;
                        const over = length > answerMax;
                        return (
                          <li key={t.id} className={styles.qc} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                            <div className={styles.hd}>
                              <Link className={styles.title} href={topicHref(t.id, show, paging.page)} data-topic-link={t.id}>
                                {t.title}
                              </Link>
                              <span className={inbox.tag} data-tone={state === 'answered' ? 'ok' : state === 'chat' ? undefined : 'wait'}>
                                {state === 'needs' ? 'Needs your answer' : CHIP_WORDS[state]}
                              </span>
                              <small>
                                {plural(t.askCount, 'ask')} · {plural(t.wordings.length, 'way')}
                              </small>
                            </div>
                            <ul className={styles.ways} aria-label="How people ask">
                              {t.wordings.slice(0, WAYS_SHOWN).map((w) => (
                                <li key={w.id}>{w.text}</li>
                              ))}
                              {t.wordings.length > WAYS_SHOWN ? <li>+{t.wordings.length - WAYS_SHOWN} more</li> : null}
                            </ul>
                            {state === 'answered' ? (
                              <p className={styles.ans}>{answer}</p>
                            ) : state === 'conflict' ? (
                              <p className={styles.ans}>Two topics with answers became one. Open it to pick the answer to keep.</p>
                            ) : (
                              <form
                                className={styles.in}
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void saveCard(t);
                                }}
                              >
                                <textarea
                                  rows={1}
                                  value={text}
                                  aria-label={`Your answer to ${t.title}`}
                                  placeholder="Write your answer once. The page uses it every time."
                                  onChange={(event) => setDrafts((current) => ({ ...current, [t.id]: event.target.value }))}
                                />
                                {over ? <span className={styles.over}>{length - answerMax} over</span> : null}
                                <button type="submit" className={styles.darkPill} disabled={saving !== null || text.trim() === '' || over}>
                                  Save answer
                                </button>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {paging.pages > 1 ? (
                    <div className={styles.foot}>
                      <Pager page={paging.page} pages={paging.pages} href={(page) => listHref(show, page)} label="More topics" />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </>
        )}
      </div>
      {toast}
    </>
  );
}

const post = (path: string, body: unknown) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }).then(() => undefined);

/** Supplies the real mutations; a Server Component may not hand closures across the RSC boundary. */
export function Questions(props: Omit<Parameters<typeof QuestionsScreen>[0], 'actions' | 'onChanged' | 'now' | 'onShow' | 'onGo'> & { now: string }) {
  const router = useRouter();

  const actions: TopicActions = {
    answer: (id, answer) => post(`/topics/${id}/answer`, { answer }),
    withdraw: (id) => apiFetch(`/topics/${id}/answer`, { method: 'DELETE' }).then(() => undefined),
    suppress: (id, suppressed) => post(`/topics/${id}/suppress`, { suppressed }),
    rename: (id, title) => apiFetch(`/topics/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }).then(() => undefined),
    merge: (id, intoTopicId, keepAnswer) => post(`/topics/${id}/merge`, { intoTopicId, keepAnswer }),
    resolve: (id, keep) => post(`/topics/${id}/resolve`, { keep }),
    deleteTopic: (id) => apiFetch(`/topics/${id}`, { method: 'DELETE' }).then(() => undefined),
    split: (id) => post(`/questions/${id}/split`, {}),
    deleteWording: (id) => apiFetch(`/questions/${id}`, { method: 'DELETE' }).then(() => undefined),
  };

  return (
    <QuestionsScreen
      {...props}
      now={new Date(props.now)}
      actions={actions}
      onChanged={() => router.refresh()}
      onShow={(show) => router.push(listHref(show))}
      onGo={(href) => {
        router.push(href);
        // The move changed what needs the owner, and a navigation re-renders only this screen: the layout's
        // counts (sidebar, phone menu, More dot, bell) come with a refresh, as after every other move.
        router.refresh();
      }}
    />
  );
}
