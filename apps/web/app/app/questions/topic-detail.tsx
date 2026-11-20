'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import type { OwnerTopic, OwnerWording, TopicChoice } from '@curios/db-read';
import type { themeAttrs } from '../../_bento/BentoPage.js';
import inbox from '../_ui/inbox.module.css';
import { InlineConfirm } from '../_ui/inline-confirm.js';
import { firstName, LeadCard } from '../_ui/lead-card.js';
import { failureText } from '../_ui/toast.js';
import { PageHead } from '../_ui/page-head.js';
import { PageReply } from '../_ui/page-reply.js';
import { relativeTime } from '../_ui/relative-time.js';
import { Switch } from '../_ui/switch.js';
import { VisitorQuestion } from '../_ui/visitor-question.js';
import styles from './questions.module.css';

// Function-typed properties, not method shorthand: they are handed around as
// bare values, and method syntax's implicit `this` trips unbound-method.
export interface TopicActions {
  answer: (topicId: string, answer: string) => Promise<void>;
  withdraw: (topicId: string) => Promise<void>;
  suppress: (topicId: string, suppressed: boolean) => Promise<void>;
  rename: (topicId: string, title: string) => Promise<void>;
  merge: (topicId: string, intoTopicId: string, keepAnswer: 'this' | 'into') => Promise<void>;
  resolve: (topicId: string, keep: 'answer' | 'conflict') => Promise<void>;
  deleteTopic: (topicId: string) => Promise<void>;
  split: (questionId: string) => Promise<void>;
  deleteWording: (questionId: string) => Promise<void>;
}

/** The page's look; the chat preview takes only its accent now, for the card's Send. */
export type ChatLook = Parameters<typeof themeAttrs>[0];

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const toMessage = (failure: unknown) => failureText(failure);

/**
 * Two answers, Answered (the owner's), Chat answered (no answer of the
 * owner's, but the model's latest reply answered it from the facts), or Needs
 * answer (it said it was not sure, or has not replied yet). The server's
 * filters split topics the same way (topics.query.ts).
 */
export function topicState(topic: Pick<OwnerTopic, 'answer' | 'conflictAnswer' | 'chat'>): 'conflict' | 'needs' | 'chat' | 'answered' {
  if (topic.conflictAnswer !== null) return 'conflict';
  if (topic.answer) return 'answered';
  return topic.chat?.answered ? 'chat' : 'needs';
}

export const CHIP_WORDS = { conflict: 'Two answers', needs: 'Needs answer', chat: 'Chat answered', answered: 'Answered' } as const;

/**
 * A topic's own screen, on the calm board (Dash.html `topic`): "‹ Questions", the header (the topic's name, how
 * often it was asked, its state, Rename), then a row each for how people ask it (split a wording
 * into its own topic, or delete it), your answer, how the chat replies with it, its FAQ page, and
 * "Same question as…" (merge) with Delete topic. Every change goes to the API and the screen is
 * refreshed from the server after, so what shows is what was saved.
 *
 * One way of reporting a failure: the screen's toast (`fail`). One InlineConfirm open at a time:
 * deleting a wording, deleting the topic and merging share the one `confirming`.
 */
export function TopicDetail({
  topic,
  others,
  backHref,
  hrefFor,
  publishesFaq,
  faqMinAsks,
  handle,
  answerMax,
  titleMax,
  look,
  pageName,
  now,
  actions,
  onChanged,
  onGo,
  say,
  fail,
}: {
  topic: OwnerTopic;
  /** Every other topic, from any page of the list: what this one can merge into. */
  others: TopicChoice[];
  /** The list this screen came from: "‹ Questions", and where a deleted topic lands. */
  backHref: string;
  /** Another topic's own screen (where a merge lands). */
  hrefFor: (topicId: string) => string;
  publishesFaq: boolean;
  faqMinAsks: number;
  handle: string;
  answerMax: number;
  titleMax: number;
  look: ChatLook;
  /** The page's display name, for the "{Name}’s page" label above its reply. */
  pageName: string;
  now: Date;
  actions: TopicActions;
  onChanged: () => void;
  /** Goes to an address: after a delete or a merge this topic's screen is not the place to stay. */
  onGo: (href: string) => void;
  /** The screen's toast, which outlives this panel (a deleted topic, a merge). */
  say: (text: string) => void;
  /** The same toast's failure tone: every failure on this screen goes there. */
  fail: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [intoId, setIntoId] = useState('');
  // The one confirm that is open: 'topic', 'merge', or `word:<id>`.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The board's save: sparks off the Save button with every toast, and the
  // saved answer typing itself into the chat beside it.
  const [sparks, setSparks] = useState(0);
  const [typing, setTyping] = useState<{ text: string; shown: number } | null>(null);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const wasConfirming = useRef<string | null>(null);
  // What was just saved, shown until the refreshed topic brings it back, so
  // the answer does not blink out between the save and the refresh.
  const [saved, setSaved] = useState<{ answer: string | null } | null>(null);
  useEffect(() => setSaved(null), [topic.answer]);
  const answer = saved ? saved.answer : topic.answer;

  useEffect(() => {
    if (renaming) titleRef.current?.focus();
  }, [renaming]);

  // A wording's confirm closed without leaving: focus goes back to its ✕.
  useEffect(() => {
    const was = wasConfirming.current;
    wasConfirming.current = confirming;
    if (confirming !== null || !was?.startsWith('word:')) return;
    document.querySelector<HTMLElement>(`[data-word-delete="${CSS.escape(was.slice(5))}"]`)?.focus();
  }, [confirming]);

  function tell(text: string) {
    say(text);
    setSparks((n) => n + 1);
  }

  useEffect(() => {
    if (sparks === 0) return;
    const timer = setTimeout(() => setSparks(0), 560);
    return () => clearTimeout(timer);
  }, [sparks]);

  // Two characters every 22ms, as the board types; all at once for anyone who
  // asked for less motion.
  useEffect(() => {
    if (!typing) return;
    if (typing.shown >= typing.text.length) {
      setTyping(null);
      return;
    }
    const timer = setTimeout(() => setTyping((t) => t && { ...t, shown: t.shown + 2 }), 22);
    return () => clearTimeout(timer);
  }, [typing]);

  /**
   * One request at a time. On success `after` runs, then either the screen goes to `navigate` or it
   * refreshes from the server. A failure is thrown to the caller, which reports it once, in the toast.
   */
  async function go(work: () => Promise<void>, options: { after?: () => void; done?: string; navigate?: string } = {}) {
    // Another change is still saving: say so, as a failure, so a confirm stays open instead of closing as if it had gone through.
    if (inFlight.current) throw new Error('One moment: the last change is still saving.');
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
      options.after?.();
      if (options.done) tell(options.done);
      if (options.navigate) onGo(options.navigate);
      else onChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** For a plain button: a failure is the toast's. */
  const attempt = (work: () => Promise<void>, options?: Parameters<typeof go>[1]) => void go(work, options).catch((failure: unknown) => fail(toMessage(failure)));
  const onError = (failure: unknown) => fail(toMessage(failure));
  const openConfirm = (id: string) => (open: boolean) => setConfirming((current) => (open ? id : current === id ? null : current));

  const state = topicState({ ...topic, answer });
  const text = draft ?? answer ?? '';
  const length = [...text.trim()].length;
  const dirty = text.trim() !== '' && text.trim() !== (answer ?? '');
  const over = length > answerMax;
  const live = state === 'answered';
  const into = others.find((other) => other.id === intoId) ?? null;
  const tag = (
    <span className={`${inbox.tag} ${styles.subTag}`} data-tone={state === 'answered' ? 'ok' : state === 'chat' ? undefined : 'wait'}>
      {CHIP_WORDS[state]}
    </span>
  );

  return (
    <>
      <Link className={styles.back} href={backHref}>
        <span aria-hidden="true">‹</span>Questions
      </Link>
      <PageHead
        kicker="Questions · Topic"
        title={topic.title}
        summary={
          <>
            {plural(topic.askCount, 'ask')}, in {plural(topic.wordings.length, 'way')}. Last asked {relativeTime(topic.lastAskedAt, now)}.{tag}
          </>
        }
      >
        {!renaming ? (
          <button
            type="button"
            className={styles.litePill}
            onClick={() => {
              setTitle(topic.title);
              setRenaming(true);
            }}
          >
            Rename
          </button>
        ) : null}
      </PageHead>

      <div className={inbox.body}>
        {renaming ? (
          <div className={styles.rename}>
            <input ref={titleRef} className={styles.renameInput} value={title} aria-label="Topic title" maxLength={titleMax} onChange={(event) => setTitle(event.target.value)} />
            <button
              type="button"
              className={styles.darkPill}
              disabled={busy || title.trim() === ''}
              onClick={() => attempt(() => actions.rename(topic.id, title.trim()), { after: () => setRenaming(false), done: 'Renamed.' })}
            >
              Save
            </button>
            <button type="button" className={styles.litePill} onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </div>
        ) : null}

        <Row title="How people ask" line="Hover a wording to split it into its own topic, or delete it.">
          <ul className={styles.words} aria-label="How people ask">
            {topic.wordings.map((wording) => (
              <Wording
                key={wording.id}
                wording={wording}
                canSplit={topic.wordings.length > 1}
                busy={busy}
                onSplit={() => attempt(() => actions.split(wording.id), { done: `“${wording.text}” is its own topic now. It will not be grouped back.` })}
                onDelete={() => setConfirming(`word:${wording.id}`)}
              />
            ))}
          </ul>
          {topic.wordings.map((wording) =>
            confirming === `word:${wording.id}` ? (
              <div key={wording.id} className={styles.confirmSlot}>
                <InlineConfirm
                  trigger="Delete wording"
                  question={
                    <>
                      Delete “{wording.text}”? Someone typed these words, and they cannot come back.
                      {topic.wordings.length === 1 ? ' It is the topic’s last wording, so the topic goes with it.' : ''}
                    </>
                  }
                  yes="Yes, delete it"
                  no="Keep it"
                  open
                  onOpenChange={openConfirm(`word:${wording.id}`)}
                  onError={onError}
                  onYes={() =>
                    go(() => actions.deleteWording(wording.id), {
                      done: topic.wordings.length === 1 ? 'Wording deleted, and its topic with it.' : 'Wording deleted.',
                      navigate: topic.wordings.length === 1 ? backHref : undefined,
                    })
                  }
                />
              </div>
            ) : null,
          )}
        </Row>

        {state === 'conflict' ? (
          <Row title="Two answers, pick one" line="Two topics with answers became one.">
            <div className={styles.conflict}>
              <button type="button" className={styles.pick} disabled={busy} onClick={() => attempt(() => actions.resolve(topic.id, 'answer'), { done: 'Kept your answer.' })}>
                <small>This answer</small>
                <b>{topic.answer}</b>
                <span>Keep this one</span>
              </button>
              <button type="button" className={styles.pick} disabled={busy} onClick={() => attempt(() => actions.resolve(topic.id, 'conflict'), { done: 'Kept the other answer.' })}>
                <small>The other answer</small>
                <b>{topic.conflictAnswer}</b>
                <span>Keep this one</span>
              </button>
            </div>
          </Row>
        ) : (
          <Row title="Your answer" line="The chat uses it for every wording above.">
            <textarea
              className={styles.answerField}
              value={text}
              aria-label="Your answer"
              placeholder="Answer the way you’d reply on WhatsApp. Short is fine."
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className={styles.btns}>
              <small data-over={over || undefined}>
                {length}/{answerMax}
              </small>
              {answer ? (
                <button
                  type="button"
                  className={styles.litePill}
                  disabled={busy}
                  onClick={() =>
                    attempt(() => actions.withdraw(topic.id), {
                      after: () => {
                        setDraft(null);
                        setSaved({ answer: null });
                      },
                      done: 'Answer withdrawn. The chat replies from your facts, or says it is not sure.',
                    })
                  }
                >
                  Withdraw
                </button>
              ) : null}
              <button
                type="button"
                className={styles.darkPill}
                disabled={busy || !dirty || over}
                onClick={() =>
                  attempt(() => actions.answer(topic.id, text.trim()), {
                    after: () => {
                      setSaved({ answer: text.trim() });
                      setDraft(null);
                      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setTyping({ text: text.trim(), shown: 0 });
                    },
                    done: `Saved. The chat now answers all ${plural(topic.wordings.length, 'way')} with it.`,
                  })
                }
              >
                {answer ? 'Update answer' : 'Save answer'}
                {sparks > 0 ? (
                  <span key={sparks} className={styles.sparks} aria-hidden="true">
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((r) => (
                      <i key={r} style={{ '--r': `${r}deg` } as CSSProperties} />
                    ))}
                  </span>
                ) : null}
              </button>
            </div>
          </Row>
        )}

        {state !== 'conflict' ? (
          <Row title="How the chat replies" line="On your page, right now.">
            {/* The dashboard's neutral chat, not the page's colours; only its accent stays, for the card's Send. */}
            <div className={styles.xchat} style={{ '--accent': look.accentColor } as CSSProperties} aria-label="How the chat replies">
              {live ? (
                <>
                  <VisitorQuestion>{topic.wordings[0]?.text ?? topic.title}</VisitorQuestion>
                  <PageReply name={pageName}>
                    {typing ? typing.text.slice(0, typing.shown) : answer}
                    {typing ? <span className={styles.caret} aria-hidden="true" /> : null}
                  </PageReply>
                </>
              ) : topic.chat ? (
                // What the chat really said, the last time it was asked.
                <>
                  <VisitorQuestion>{topic.chat.asked}</VisitorQuestion>
                  <PageReply name={pageName}>{topic.chat.reply}</PageReply>
                </>
              ) : (
                <>
                  <VisitorQuestion>{topic.wordings[0]?.text ?? topic.title}</VisitorQuestion>
                  <PageReply name={pageName}>I’m not sure about that one. Leave your number and {firstName(pageName)} will get back to you.</PageReply>
                  <LeadCard name={pageName} />
                </>
              )}
            </div>
            {!live ? (
              <p className={styles.hint}>
                {topic.chat
                  ? topic.chat.answered
                    ? `Answered from your facts, ${relativeTime(topic.chat.at, now)}. Write your own answer and the chat uses it instead.`
                    : `The chat wasn’t sure, ${relativeTime(topic.chat.at, now)}. Your answer replaces this reply.`
                  : 'No reply kept for this topic yet. Without your answer, the chat replies from your facts, or says it isn’t sure.'}
              </p>
            ) : null}
          </Row>
        ) : null}

        {publishesFaq ? <FaqRow topic={topic} live={live} faqMinAsks={faqMinAsks} handle={handle} busy={busy} onToggle={(suppressed) => attempt(() => actions.suppress(topic.id, suppressed))} /> : null}

        <Row title="Same question as…" line="Both have an answer? The one you merge into keeps its answer." last>
          {others.length > 0 ? (
            <>
              <label className={styles.pickField}>
                <small>Merge into</small>
                <select
                  className={styles.pickSelect}
                  value={intoId}
                  onChange={(event) => {
                    setIntoId(event.target.value);
                    setConfirming((current) => (current === 'merge' ? null : current));
                  }}
                >
                  <option value="">Pick a topic</option>
                  {others.map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.title}
                    </option>
                  ))}
                </select>
              </label>
              {into ? (
                <div className={styles.confirmSlot}>
                  <InlineConfirm
                    trigger="Merge"
                    tone="quiet"
                    question={
                      <>
                        Merge into “{into.title}”? Its wordings and asks move into the one you pick.
                        {answer && into.answer ? ' Both have an answer: the one you merge into keeps its answer.' : ''}
                      </>
                    }
                    yes="Yes, merge"
                    no="Not yet"
                    open={confirming === 'merge'}
                    onOpenChange={openConfirm('merge')}
                    onError={onError}
                    // The one merged into keeps its answer; this one's answer stays only when that one has none.
                    onYes={() => go(() => actions.merge(topic.id, into.id, into.answer ? 'into' : 'this'), { done: `Merged into “${into.title}”.`, navigate: hrefFor(into.id) })}
                  />
                </div>
              ) : null}
            </>
          ) : null}
          <div className={styles.confirmSlot}>
            <InlineConfirm
              trigger="Delete topic"
              question={`Delete this topic and all its wordings?${answer ? ' Your answer goes too.' : ''}`}
              yes="Yes, delete topic"
              no="Keep it"
              open={confirming === 'topic'}
              onOpenChange={openConfirm('topic')}
              onError={onError}
              onYes={() => go(() => actions.deleteTopic(topic.id), { done: 'Topic deleted.', navigate: backHref })}
            />
          </div>
        </Row>
      </div>
    </>
  );
}

/** A row of a topic's screen: its heading and line in a 240px column, its content beside it (Dash.html .row.xrow). */
function Row({ title, line, last, children }: { title: string; line: string; last?: boolean; children?: ReactNode }) {
  return (
    <div className={styles.xrow} data-last={last || undefined}>
      <div className={styles.rh}>
        <h3>{title}</h3>
        <p>{line}</p>
      </div>
      <div className={styles.xr}>{children}</div>
    </div>
  );
}

/**
 * One wording, as a chip: its words, how often, and (on hover or focus, always on touch) the two
 * things the owner can do about it. Deleting asks first, in the row's one confirm, because a
 * visitor typed these words and they cannot come back.
 */
function Wording({
  wording,
  canSplit,
  busy,
  onSplit,
  onDelete,
}: {
  wording: OwnerWording;
  canSplit: boolean;
  busy: boolean;
  onSplit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={styles.word} aria-label={wording.text}>
      <span>{wording.text}</span>
      <em>{wording.askCount}</em>
      <span className={styles.tools}>
        {canSplit ? (
          <button type="button" disabled={busy} title="Split" aria-label={`Not the same question: ${wording.text}`} onClick={onSplit}>
            <span aria-hidden="true">⇱</span>
          </button>
        ) : null}
        <button type="button" data-danger="" data-word-delete={wording.id} disabled={busy} title="Delete" aria-label={`Delete wording: ${wording.text}`} onClick={onDelete}>
          <span aria-hidden="true">✕</span>
        </button>
      </span>
    </li>
  );
}

/** Whether the topic has an FAQ page, why not when it has none, and the switch to hide or show it. */
function FaqRow({
  topic,
  live,
  faqMinAsks,
  handle,
  busy,
  onToggle,
}: {
  topic: OwnerTopic;
  live: boolean;
  faqMinAsks: number;
  handle: string;
  busy: boolean;
  onToggle: (suppressed: boolean) => void;
}) {
  const has = live && topic.faqSlug !== null;
  const on = has && !topic.faqSuppressed;
  const words = on
    ? 'Its own page, so people searching can find your answer.'
    : has
      ? 'Hidden from your FAQ. The chat still uses the answer.'
      : topic.askCount < faqMinAsks
        ? `A topic gets an FAQ page once it is asked ${faqMinAsks} times and you have answered it.`
        : 'Answer it and it gets its own FAQ page, found on Google.';

  return (
    <Row title={on ? 'On your FAQ page' : 'FAQ page'} line={words}>
      {has ? (
        <div className={styles.faq}>
          {on ? (
            <a href={`/${handle}/faq/${topic.faqSlug}`} target="_blank" rel="noreferrer">
              curios.my/{handle}/faq/{topic.faqSlug}
            </a>
          ) : (
            <span style={{ flex: 1 }} />
          )}
          <Switch checked={on} label="Show on your FAQ" disabled={busy} onChange={() => onToggle(on)} />
        </div>
      ) : null}
    </Row>
  );
}
