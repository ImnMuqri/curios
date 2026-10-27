'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnerTopic, TopicChoice, TopicTotals } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { PageHead } from '../_ui/page-head.js';
import { Pager } from '../_ui/pager.js';
import ui from '../_ui/editor.module.css';
import panel from '../panel.module.css';
import { relativeTime } from '../_ui/relative-time.js';
import { useToast } from '../_ui/toast.js';
import { CHIP_WORDS, plural, TopicDetail, topicState, type ChatLook, type TopicActions } from './topic-detail.js';
import inbox from '../_ui/inbox.module.css';
import styles from './questions.module.css';

type Filter = 'all' | 'needs' | 'chat' | 'answered';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs', label: 'Needs you' },
  { id: 'chat', label: 'By chat' },
  { id: 'answered', label: 'Answered' },
];

/** What a filter that matches nothing says. */
const EMPTY: Record<Exclude<Filter, 'all'>, [string, string]> = {
  needs: ['Nothing needs you', 'Questions the chat is not sure about land here.'],
  chat: ['Nothing yet', 'Questions the chat answers from your facts land here.'],
  answered: ['Nothing answered yet', 'Answer a topic and it moves here.'],
};

/** Whether a topic belongs in a filter, as the server filters them. */
const inFilter = (filter: Filter, topic: OwnerTopic) => {
  const state = topicState(topic);
  return filter === 'all' || (filter === 'needs' ? state === 'needs' || state === 'conflict' : state === filter);
};

/**
 * What visitors ask, grouped by topic, and the one screen that changes what
 * the page says back. Three figures, the topics down the left (most asked
 * first, filtered), the chosen one on the right.
 *
 * Presentational: it takes the rows and the mutations, and `Questions` below
 * supplies the real ones.
 */
export function QuestionsScreen({
  topics,
  paging = { page: 1, pages: 1 },
  show = 'all',
  onShow,
  totals,
  choices,
  askedThisWeek,
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
  /** Which seven, most asked first, and how many pages of them the filter has. */
  paging?: { page: number; pages: number };
  /** The filter the server applied before paging (`?show=`). */
  show?: Filter;
  /** Asks the server for another filter's list; left out, a filter only narrows the topics in hand. */
  onShow?: (show: Filter) => void;
  /** Figures over every topic, not this screenful; left out, they are counted from `topics`. */
  totals?: TopicTotals;
  /** Every topic, to merge into from any page; left out, the topics in hand. */
  choices?: TopicChoice[];
  askedThisWeek: number;
  /** Of the last thirty days' asks with a recorded outcome, how many the chat could answer. */
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
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { say, toast } = useToast(2600);

  const waiting = totals?.topics.needs ?? topics.filter((topic) => inFilter('needs', topic)).length;
  const totalAsks = totals?.asks ?? topics.reduce((sum, topic) => sum + topic.askCount, 0);
  const answeredAsks = totals?.answeredAsks ?? topics.filter((topic) => topicState(topic) === 'answered').reduce((sum, topic) => sum + topic.askCount, 0);
  // The board's figure, from what the chat recorded of each ask; until it has
  // recorded any, the share with the owner's own answer, which is the most
  // that can be said without guessing (and never more than the true share).
  const recorded = answerRate.recorded > 0;
  const pct = recorded
    ? Math.round((answerRate.answered / answerRate.recorded) * 100)
    : totalAsks === 0
      ? 0
      : Math.round((answeredAsks / totalAsks) * 100);
  const shown = topics.filter((topic) => inFilter(filter, topic));
  const chosen = shown.find((topic) => topic.id === selected) ?? shown[0] ?? null;
  const most = Math.max(1, ...topics.map((topic) => topic.askCount));

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard here: the address is in the page's own header to select.
    }
  }

  return (
    <>
      <PageHead title="Questions" note="What visitors ask your page, grouped by topic">
        {publishesFaq ? (
          <a className={panel.secondaryLink} href={`/${handle}/faq`} target="_blank" rel="noreferrer">
            See your FAQ
          </a>
        ) : null}
      </PageHead>

      <ul className={inbox.stats} aria-label="This week">
        <li className={inbox.kpi}>
          <span>
            <b>{askedThisWeek}</b>
            <span>Questions asked this week</span>
          </span>
        </li>
        <li className={inbox.kpi}>
          <span>
            <b>{waiting}</b>
            <span>Topics waiting for your answer</span>
          </span>
        </li>
        <li className={inbox.kpi}>
          <span>
            <b>{pct}%</b>
            <span>{recorded ? 'Of asks the chat can answer' : 'Of asks with your own answer'}</span>
          </span>
        </li>
      </ul>

      {/* No topics at all: a filter that matches none is the list's own empty line, below. */}
      {(choices ? choices.length : topics.length) === 0 ? (
        <div className={inbox.board} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className={inbox.detail} style={{ display: 'grid', placeItems: 'center', minHeight: 420 }}>
            <div className={ui.empty} style={{ border: 0 }}>
              <div className={ui.emptyArt} aria-hidden="true">
                <span className={ui.ghostRows}>
                  <span data-tone="biru"><i /><b /><em /></span>
                  <span data-tone="amber"><i /><b /><em /></span>
                  <span data-tone="rose"><i /><b /><em /></span>
                </span>
                <span className={ui.emptyBadge}>
                  <svg viewBox="0 0 24 24" width="21" height="21">
                    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01" />
                  </svg>
                </span>
              </div>
              <h3>No questions yet</h3>
              <p>When visitors ask your page something, it lands here, grouped by topic. Answer once and the chat uses it for every way people ask.</p>
              <span className={styles.mergeActions}>
                <button type="button" className={ui.primaryButton} onClick={() => void copyLink()}>
                  {copied ? 'Copied' : 'Copy your link'}
                </button>
                <a className={styles.outline} href={`/${handle}#ask`} target="_blank" rel="noreferrer">
                  Try asking your page
                </a>
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className={inbox.board}>
          <div className={inbox.list}>
            <div className={inbox.filters} role="tablist" aria-label="Show topics" style={{ '--at': FILTERS.findIndex((f) => f.id === filter), '--n': FILTERS.length } as CSSProperties}>
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => {
                  setFilter(f.id);
                  onShow?.(f.id);
                }}>
                  {f.label}
                  {f.id === 'needs' && waiting > 0 ? <i aria-label={`${waiting} waiting`}>{waiting}</i> : null}
                </button>
              ))}
            </div>
            {shown.length === 0 && filter !== 'all' ? (
              <p className={inbox.listEmpty}>
                <b>{EMPTY[filter][0]}</b>
                {EMPTY[filter][1]}
              </p>
            ) : (
              <ul className={inbox.rows} aria-label="Topics">
                {shown.map((topic, i) => {
                  const state = topicState(topic);
                  return (
                    <li key={topic.id}>
                      <button
                        type="button"
                        className={inbox.row}
                        aria-current={chosen?.id === topic.id}
                        style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                        onClick={() => setSelected(topic.id)}
                      >
                        <span className={styles.rowTop}>
                          <span className={styles.rowTitle}>{topic.title}</span>
                          <span className={styles.chip} data-state={state}>
                            {CHIP_WORDS[state]}
                          </span>
                        </span>
                        <span className={styles.rowMeta}>
                          {plural(topic.askCount, 'ask')} · {plural(topic.wordings.length, 'wording')} · {relativeTime(topic.lastAskedAt, now)}
                        </span>
                        <span
                          className={styles.bar}
                          data-needs={state === 'needs' || state === 'conflict' ? '' : undefined}
                          data-current={chosen?.id === topic.id ? '' : undefined}
                          aria-hidden="true"
                        >
                          <i style={{ width: `${Math.round((topic.askCount / most) * 100)}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Pager page={paging.page} pages={paging.pages} href={(page) => listHref(show, page)} label="More topics" />
          </div>
          <div className={inbox.detail}>
            {chosen ? (
              <TopicDetail
                key={chosen.id}
                topic={chosen}
                others={(choices ?? topics).filter((topic) => topic.id !== chosen.id)}
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
                onSelect={setSelected}
                say={say}
              />
            ) : null}
          </div>
        </div>
      )}
      {toast}
    </>
  );
}

/** The list's address for a filter and page: the first page of All is plain /app/questions. */
export function listHref(show: Filter, page = 1): string {
  const query = new URLSearchParams();
  if (show !== 'all') query.set('show', show);
  if (page > 1) query.set('page', String(page));
  const text = query.toString();
  return text ? `/app/questions?${text}` : '/app/questions';
}

const post = (path: string, body: unknown) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }).then(() => undefined);

/** Supplies the real mutations; a Server Component may not hand closures across the RSC boundary. */
export function Questions(props: Omit<Parameters<typeof QuestionsScreen>[0], 'actions' | 'onChanged' | 'now' | 'onShow'> & { now: string }) {
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

  return <QuestionsScreen {...props} now={new Date(props.now)} actions={actions} onChanged={() => router.refresh()} onShow={(show) => router.push(listHref(show))} />;
}
