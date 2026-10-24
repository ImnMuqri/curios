'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Callout } from '@curios/ui';
import type { OwnerTopic, OwnerWording } from '@curios/db-read';
import { themeAttrs } from '../../_bento/BentoPage.js';
import bento from '../../_bento/Bento.module.css';
import { firstName, LeadCard } from '../_ui/lead-card.js';
import { PageReply } from '../_ui/page-reply.js';
import { VisitorQuestion } from '../_ui/visitor-question.js';
import { relativeTime } from '../_ui/relative-time.js';
import ui from '../_ui/editor.module.css';
import inbox from '../_ui/inbox.module.css';
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

/** The page's colours, for the chat preview. */
export type ChatLook = Parameters<typeof themeAttrs>[0];

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const toMessage = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'Something failed. Try again.');

/** Needs answer, Two answers, or Answered: what a topic is waiting on. */
export function topicState(topic: OwnerTopic): 'conflict' | 'needs' | 'answered' {
  if (topic.conflictAnswer !== null) return 'conflict';
  return topic.answer ? 'answered' : 'needs';
}

export const CHIP_WORDS = { conflict: 'Two answers', needs: 'Needs answer', answered: 'Answered' } as const;

/**
 * The chosen topic, on its own: what it is waiting on, how people asked it,
 * your answer and what the chat says with it, its FAQ page, and renaming,
 * merging and deleting it. Every change goes to the API and the screen is
 * refreshed from the server after, so what shows is what was saved.
 */
export function TopicDetail({
  topic,
  others,
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
  onSelect,
  say,
}: {
  topic: OwnerTopic;
  /** Every other topic, for "Same question as…". */
  others: OwnerTopic[];
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
  /** Moves the selection: to the topic merged into, or to none after a delete. */
  onSelect: (id: string | null) => void;
  /** The screen's toast, which outlives this panel (a deleted topic, a merge). */
  say: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [merging, setMerging] = useState(false);
  const [intoId, setIntoId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The board's save: sparks off the Save button with every toast, and the
  // saved answer typing itself into the chat beside it.
  const [sparks, setSparks] = useState(0);
  const [typing, setTyping] = useState<{ text: string; shown: number } | null>(null);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // What was just saved, shown until the refreshed topic brings it back, so
  // the answer does not blink out between the save and the refresh.
  const [saved, setSaved] = useState<{ answer: string | null } | null>(null);
  useEffect(() => setSaved(null), [topic.answer]);
  const answer = saved ? saved.answer : topic.answer;

  useEffect(() => {
    if (renaming) titleRef.current?.focus();
  }, [renaming]);

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

  /** One request at a time. On success `after` runs and the screen refreshes; on failure the panel stays, with its input. */
  async function run(work: () => Promise<void>, after?: () => void, done?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      after?.();
      if (done) tell(done);
      onChanged();
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const state = topicState({ ...topic, answer });
  const text = draft ?? answer ?? '';
  const length = [...text.trim()].length;
  const dirty = text.trim() !== '' && text.trim() !== (answer ?? '');
  const live = state === 'answered';
  const into = others.find((other) => other.id === intoId) ?? null;
  const top = Math.max(1, ...topic.week);
  const weekTotal = topic.week.reduce((sum, n) => sum + n, 0);

  return (
    <div className={inbox.detailInner}>
      {renaming ? (
        <div className={styles.rename}>
          <input ref={titleRef} value={title} aria-label="Topic title" maxLength={titleMax} onChange={(event) => setTitle(event.target.value)} />
          <button
            type="button"
            className={styles.save}
            disabled={busy || title.trim() === ''}
            onClick={() => void run(() => actions.rename(topic.id, title.trim()), () => setRenaming(false), 'Renamed.')}
          >
            Save
          </button>
          <button type="button" className={styles.outline} onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className={styles.head}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <h2>{topic.title}</h2>
            <p>
              <span className={styles.chip} data-state={state}>
                {CHIP_WORDS[state]}
              </span>
              {plural(topic.askCount, 'ask')} in {plural(topic.wordings.length, 'wording')} · last asked {relativeTime(topic.lastAskedAt, now)}
            </p>
          </span>
          <span className={styles.spark} role="img" aria-label={`${plural(weekTotal, 'ask')} in the last 7 days`}>
            {topic.week.map((n, i) => (
              <i key={i} style={{ height: Math.max(4, Math.round((n / top) * 28)) }} />
            ))}
          </span>
        </div>
      )}

      <section className={inbox.section} aria-labelledby="wordings-title">
        <h3 id="wordings-title">
          How people asked it<span>Hover a wording to split or delete it</span>
        </h3>
        <ul className={styles.words}>
          {topic.wordings.map((wording) => (
            <WordingRow
              key={wording.id}
              wording={wording}
              canSplit={topic.wordings.length > 1}
              busy={busy}
              onSplit={() => void run(() => actions.split(wording.id), undefined, `“${wording.text}” is its own topic now. It will not be grouped back.`)}
              onDelete={() =>
                void run(
                  () => actions.deleteWording(wording.id),
                  topic.wordings.length === 1 ? () => onSelect(null) : undefined,
                  topic.wordings.length === 1 ? 'Wording deleted, and its topic with it.' : 'Wording deleted.',
                )
              }
            />
          ))}
        </ul>
      </section>

      {state === 'conflict' ? (
        <section className={inbox.section} aria-labelledby="conflict-title">
          <h3 id="conflict-title">
            Two answers, pick one<span>Two topics with answers became one</span>
          </h3>
          <div className={styles.conflict}>
            <button type="button" className={styles.pick} disabled={busy} onClick={() => void run(() => actions.resolve(topic.id, 'answer'), undefined, 'Kept your answer.')}>
              <small>This answer</small>
              <b>{topic.answer}</b>
              <span>Keep this one</span>
            </button>
            <button type="button" className={styles.pick} disabled={busy} onClick={() => void run(() => actions.resolve(topic.id, 'conflict'), undefined, 'Kept the other answer.')}>
              <small>The other answer</small>
              <b>{topic.conflictAnswer}</b>
              <span>Keep this one</span>
            </button>
          </div>
        </section>
      ) : (
        <section className={inbox.section} aria-labelledby="answer-title">
          <h3 id="answer-title">
            Your answer<span>The chat uses it for every wording above</span>
          </h3>
          <div className={styles.answerGrid}>
            <div className={styles.answer}>
              <textarea
                value={text}
                aria-label="Your answer"
                placeholder="Answer the way you'd reply on WhatsApp. Short is fine."
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className={styles.answerFoot}>
                <small data-over={length > answerMax || undefined}>
                  {length}/{answerMax}
                </small>
                {answer ? (
                  <button
                    type="button"
                    className={styles.ghost}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => actions.withdraw(topic.id),
                        () => {
                          setDraft(null);
                          setSaved({ answer: null });
                        },
                        'Answer withdrawn. The chat will say it is not sure.',
                      )
                    }
                  >
                    Withdraw
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.save}
                  disabled={busy || !dirty}
                  onClick={() =>
                    void run(
                      () => actions.answer(topic.id, text.trim()),
                      () => {
                        setSaved({ answer: text.trim() });
                        setDraft(null);
                        if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setTyping({ text: text.trim(), shown: 0 });
                      },
                      `Saved. The chat now answers all ${plural(topic.wordings.length, 'wording')} with it.`,
                    )
                  }
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
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
            </div>
            <div className={`${bento.theme} ${styles.chat}`} {...themeAttrs(look)} aria-label="How the chat replies">
              <span className={styles.chatLabel}>
                <i aria-hidden="true" />
                On your page
              </span>
              <VisitorQuestion>{topic.wordings[0]?.text ?? topic.title}</VisitorQuestion>
              {live ? (
                <PageReply name={pageName}>
                  {typing ? typing.text.slice(0, typing.shown) : answer}
                  {typing ? <span className={styles.caret} aria-hidden="true" /> : null}
                </PageReply>
              ) : (
                <>
                  <PageReply name={pageName}>I’m not sure about that one. Leave your number and {firstName(pageName)} will get back to you.</PageReply>
                  <LeadCard name={pageName} />
                  <span className={styles.replyNote}>Without your answer, the chat replies from your facts, or says it isn&apos;t sure.</span>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {publishesFaq ? <FaqRow topic={topic} live={live} faqMinAsks={faqMinAsks} handle={handle} busy={busy} onToggle={(suppressed) => void run(() => actions.suppress(topic.id, suppressed))} /> : null}

      <div className={styles.more}>
        <button
          type="button"
          className={styles.outline}
          onClick={() => {
            setTitle(topic.title);
            setRenaming(true);
          }}
        >
          Rename
        </button>
        {others.length > 0 ? (
          <button
            type="button"
            className={styles.outline}
            aria-expanded={merging}
            onClick={() => {
              setIntoId(null);
              setMerging(!merging);
            }}
          >
            Same question as…
          </button>
        ) : null}
        {merging ? (
          <div className={styles.merge} role="group" aria-label="Same question as">
            <p>
              <b>Same question as…</b> Its wordings and asks move into the one you pick.
            </p>
            <div className={styles.mergeChoices}>
              {others.map((other) => (
                <button key={other.id} type="button" className={styles.outline} aria-pressed={intoId === other.id} onClick={() => setIntoId(other.id)}>
                  {other.title}
                </button>
              ))}
            </div>
            {answer && into?.answer ? <p>Both have an answer. The one you merge into keeps its answer.</p> : null}
            <div className={styles.mergeActions}>
              <button
                type="button"
                className={styles.save}
                disabled={busy || !into}
                onClick={() => {
                  if (!into) return;
                  // The one merged into keeps its answer; this one's answer stays only when that one has none.
                  void run(
                    () => actions.merge(topic.id, into.id, into.answer ? 'into' : 'this'),
                    () => {
                      setMerging(false);
                      onSelect(into.id);
                    },
                    `Merged into “${into.title}”.`,
                  );
                }}
              >
                Merge
              </button>
              <button type="button" className={styles.outline} onClick={() => setMerging(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <span className={styles.moreEnd}>
          {deleting ? (
            <span className={styles.wordConfirm} role="group" aria-label="Confirm deleting this topic">
              Delete this topic and all its wordings?{answer ? ' Your answer goes too.' : ''}
              <button type="button" disabled={busy} onClick={() => void run(() => actions.deleteTopic(topic.id), () => onSelect(null), 'Topic deleted.')}>
                Delete topic
              </button>
              <button type="button" onClick={() => setDeleting(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className={styles.ghost} onClick={() => setDeleting(true)}>
              Delete topic
            </button>
          )}
        </span>
      </div>

      {error ? (
        <div className={styles.error}>
          <Callout tone="error">{error}</Callout>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One wording, as a pill: its words, how often, and (on hover or focus) the
 * two things the owner can do about it. Deleting asks first, because a
 * visitor typed these words and they cannot come back.
 */
function WordingRow({
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
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={styles.word} aria-label={wording.text}>
      <span>{wording.text}</span>
      <em>{wording.askCount}×</em>
      {confirming ? (
        <span className={styles.wordConfirm} role="group" aria-label="Confirm deleting this wording">
          Delete?
          <button type="button" disabled={busy} onClick={onDelete}>
            Yes
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            No
          </button>
        </span>
      ) : (
        <span className={styles.wordTools}>
          {canSplit ? (
            <button type="button" disabled={busy} aria-label={`Not the same question: ${wording.text}`} onClick={onSplit}>
              Not the same
            </button>
          ) : null}
          <button type="button" data-danger="" aria-label={`Delete wording: ${wording.text}`} onClick={() => setConfirming(true)}>
            Delete
          </button>
        </span>
      )}
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
    <section className={inbox.section} aria-label="FAQ page">
      <div className={styles.faq}>
        <span className={styles.faqText}>
          <b>{on ? 'On your FAQ page' : 'FAQ page'}</b>
          <span>{words}</span>
          {on ? (
            <a href={`/${handle}/faq/${topic.faqSlug}`} target="_blank" rel="noreferrer">
              curios.my/{handle}/faq/{topic.faqSlug}
            </a>
          ) : null}
        </span>
        {has ? (
          <button type="button" className={ui.switch} role="switch" aria-checked={on} aria-label="Show on your FAQ" disabled={busy} onClick={() => onToggle(on)}>
            <i />
          </button>
        ) : null}
      </div>
    </section>
  );
}
