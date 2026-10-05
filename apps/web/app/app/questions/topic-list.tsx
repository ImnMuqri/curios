'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import type { OwnerTopic, OwnerWording } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import styles from './questions.module.css';
import { EmptyState } from '../_ui/empty-state.js';

export interface TopicActions {
  answer(topicId: string, answer: string): Promise<void>;
  withdraw(topicId: string): Promise<void>;
  suppress(topicId: string, suppressed: boolean): Promise<void>;
  rename(topicId: string, title: string): Promise<void>;
  merge(topicId: string, intoTopicId: string, keepAnswer: 'this' | 'into'): Promise<void>;
  resolve(topicId: string, keep: 'answer' | 'conflict'): Promise<void>;
  deleteTopic(topicId: string): Promise<void>;
  split(questionId: string): Promise<void>;
  deleteWording(questionId: string): Promise<void>;
}

const toMessage = (failure: unknown) =>
  failure instanceof Error ? failure.message : 'Something failed. Try again.';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type Mode = 'view' | 'answer' | 'rename' | 'merge' | 'delete';

/**
 * One folded-out wording: its words, how often it was typed, and the two
 * things the owner can do about it. Keeps its own busy/error so a failure here
 * is not mistaken for a failure of the topic.
 */
function WordingRow({
  wording,
  canSplit,
  actions,
  onChanged,
}: {
  wording: OwnerWording;
  canSplit: boolean;
  actions: TopicActions;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A ref, not just `busy`: two taps before React re-renders both see busy false.
  const inFlight = useRef(false);

  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      setConfirming(false);
      onChanged();
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <li className={styles.wording}>
      <span className={styles.wordingText}>{wording.text}</span>
      <span className={styles.wordingCount}>{wording.askCount}×</span>
      {confirming ? (
        <div className={styles.confirm} role="group" aria-label="Confirm deleting this wording">
          <p>Delete this wording? A visitor typed these words; this cannot be undone.</p>
          <Button variant="danger" busy={busy} onClick={() => void run(() => actions.deleteWording(wording.id))}>
            Delete wording
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <div className={styles.wordingActions}>
          {canSplit ? (
            <Button variant="secondary" busy={busy} onClick={() => void run(() => actions.split(wording.id))}>
              Not the same question
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </div>
      )}
      {error ? <Callout tone="error">{error}</Callout> : null}
    </li>
  );
}

function TopicRow({
  topic,
  others,
  publishesFaq,
  answerMax,
  titleMax,
  actions,
  onChanged,
}: {
  topic: OwnerTopic;
  /** Every other topic, for "Same as…". */
  others: OwnerTopic[];
  publishesFaq: boolean;
  answerMax: number;
  titleMax: number;
  actions: TopicActions;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('view');
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState(topic.title);
  const [intoId, setIntoId] = useState('');
  const [keep, setKeep] = useState<'this' | 'into' | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menuButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const mergeId = `merge-${topic.id}`;
  const menuId = `menu-${topic.id}`;

  const extra = topic.wordings.length - 1;
  const answerId = `answer-${topic.id}`;
  const titleId = `title-${topic.id}`;

  // A panel that opens takes focus to its first field, so the keyboard user
  // lands where they are about to type.
  useEffect(() => {
    const target = mode === 'answer' ? answerId : mode === 'rename' ? titleId : mode === 'merge' ? mergeId : null;
    if (target) document.getElementById(target)?.focus();
  }, [mode, answerId, titleId, mergeId]);
  const into = others.find((other) => other.id === intoId);
  const bothAnswered = Boolean(topic.answer && into?.answer);
  const showFaq = publishesFaq && topic.faqSlug !== null;

  /** Runs one request. On success `after` closes whatever was open; on failure the panel stays, with its input. */
  async function run(work: () => Promise<void>, after: () => void, focusId?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      after();
      onChanged();
    } catch (failure) {
      setError(toMessage(failure));
      // A busy submit-less Button keeps focus, but a re-render can still drop it; put it back on the field.
      if (focusId) document.getElementById(focusId)?.focus();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function close() {
    setMode('view');
    setError('');
  }

  function openMode(next: Mode) {
    setMenuOpen(false);
    setError('');
    setMode(next);
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menuOpen) {
      event.stopPropagation();
      setMenuOpen(false);
      menuButton.current?.focus();
    }
  }

  function mergeKeep(): 'this' | 'into' | null {
    if (bothAnswered) return keep === '' ? null : keep;
    return !topic.answer && into?.answer ? 'into' : 'this';
  }

  return (
    <li className={styles.row}>
      <div className={styles.main}>
        <p className={styles.title}>{topic.title}</p>
        <p className={styles.sub}>
          {extra > 0 ? (
            <button
              type="button"
              className={styles.more}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              +{extra} other wording{extra === 1 ? '' : 's'}
            </button>
          ) : null}
          {extra > 0 ? ' · ' : null}
          {topic.answer ? <>Answered: “{topic.answer}”</> : 'Not answered yet'}
          {showFaq ? (topic.faqSuppressed ? ' · Hidden from /faq' : ' · Live on /faq') : ''}
        </p>
      </div>
      <span className={styles.count}>{topic.askCount}×</span>
      <div className={styles.rowActions}>
        {topic.answer ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setDraft(topic.answer ?? '');
              openMode('answer');
            }}
          >
            Edit
          </Button>
        ) : (
          <Button
            disabled={busy}
            onClick={() => {
              setDraft('');
              openMode('answer');
            }}
          >
            Answer
          </Button>
        )}
        <div className={styles.menuWrap} onKeyDown={onMenuKeyDown}>
          <button
            ref={menuButton}
            type="button"
            className={styles.menuButton}
            aria-label={`More actions for ${topic.title}`}
            aria-controls={menuOpen ? menuId : undefined}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <ul id={menuId} className={styles.menu} aria-label={`Actions for ${topic.title}`}>
              {others.length > 0 ? (
                <li>
                  <button type="button" onClick={() => { setIntoId(''); setKeep(''); openMode('merge'); }}>
                    Same as…
                  </button>
                </li>
              ) : null}
              <li>
                <button type="button" onClick={() => { setTitleDraft(topic.title); openMode('rename'); }}>
                  Rename
                </button>
              </li>
              {showFaq ? (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      // The item unmounts with the list; park focus on the ⋯ button now and after.
                      setMenuOpen(false);
                      menuButton.current?.focus();
                      void run(() => actions.suppress(topic.id, !topic.faqSuppressed), () => undefined).then(() =>
                        menuButton.current?.focus(),
                      );
                    }}
                  >
                    {topic.faqSuppressed ? 'Show on FAQ' : 'Hide from FAQ'}
                  </button>
                </li>
              ) : null}
              <li>
                <button type="button" onClick={() => openMode('delete')}>
                  Delete topic
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      </div>

      {topic.conflictAnswer !== null ? (
        <div className={styles.panel}>
          <Callout tone="action">Two answers — pick one</Callout>
          <div className={styles.choice}>
            <p>{topic.answer}</p>
            <Button
              aria-label={`Keep this answer: ${topic.answer ?? ''}`}
              disabled={busy}
              onClick={() => void run(() => actions.resolve(topic.id, 'answer'), () => undefined)}
            >
              Keep this
            </Button>
          </div>
          <div className={styles.choice}>
            <p>{topic.conflictAnswer}</p>
            <Button
              variant="secondary"
              aria-label={`Keep this answer: ${topic.conflictAnswer}`}
              disabled={busy}
              onClick={() => void run(() => actions.resolve(topic.id, 'conflict'), () => undefined)}
            >
              Keep this
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'answer' ? (
        <div className={styles.panel}>
          <Field
            id={answerId}
            label="Answer"
            multiline
            hint={`Up to ${answerMax} characters.`}
            value={draft}
            onChange={setDraft}
          />
          <div className={styles.actions}>
            <Button
              busy={busy}
              onClick={() => {
                if (draft.trim() === '') return;
                void run(() => actions.answer(topic.id, draft.trim()), close, answerId);
              }}
            >
              Save
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'rename' ? (
        <div className={styles.panel}>
          <Field
            id={titleId}
            label="Title"
            hint={`Up to ${titleMax} characters.`}
            value={titleDraft}
            onChange={setTitleDraft}
          />
          <div className={styles.actions}>
            <Button busy={busy} onClick={() => void run(() => actions.rename(topic.id, titleDraft.trim()), close, titleId)}>
              Save title
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'merge' ? (
        <div className={styles.panel}>
          <label className={styles.select}>
            Same question as
            <select
              id={mergeId}
              aria-label="Same question as"
              value={intoId}
              onChange={(event) => { setIntoId(event.target.value); setKeep(''); }}
            >
              <option value="">Choose a topic</option>
              {others.map((other) => (
                <option key={other.id} value={other.id}>{other.title}</option>
              ))}
            </select>
          </label>
          {bothAnswered ? (
            <fieldset className={styles.keepChoice}>
              <legend>Both have an answer. Which one stays?</legend>
              <label>
                <input type="radio" name={`keep-${topic.id}`} checked={keep === 'this'} onChange={() => setKeep('this')} />
                Keep this answer
              </label>
              <label>
                <input type="radio" name={`keep-${topic.id}`} checked={keep === 'into'} onChange={() => setKeep('into')} />
                Keep theirs: “{into?.answer}”
              </label>
            </fieldset>
          ) : null}
          <div className={styles.actions}>
            <Button
              busy={busy}
              disabled={!into || mergeKeep() === null}
              onClick={() => {
                const choice = mergeKeep();
                if (!into || choice === null) return;
                void run(() => actions.merge(topic.id, into.id, choice), close);
              }}
            >
              Merge
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'delete' ? (
        <div className={styles.panel}>
          <div className={styles.confirm} role="group" aria-label="Confirm deleting this topic">
            <p>
              Delete this topic and its {plural(topic.wordings.length, 'wording')}?{topic.answer ? ' Your answer goes too, and this cannot be undone.' : ' This cannot be undone.'}
            </p>
            <Button variant="danger" busy={busy} onClick={() => void run(() => actions.deleteTopic(topic.id), close)}>
              Delete it
            </Button>
            <Button variant="secondary" disabled={busy} onClick={close}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}

      {open && extra > 0 ? (
        <ul className={styles.wordings}>
          {topic.wordings.map((wording) => (
            <WordingRow
              key={wording.id}
              wording={wording}
              canSplit={topic.wordings.length > 1}
              actions={actions}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className={styles.panel}>
          <Callout tone="error">{error}</Callout>
        </div>
      ) : null}
    </li>
  );
}

/**
 * What visitors ask, one compact row per topic, most asked first.
 *
 * Presentational: it takes the rows and the mutations, and `Topics` below
 * supplies the real ones, the same split as `FactList`/`Facts`.
 */
export function TopicList({
  topics,
  publishesFaq,
  answerMax,
  titleMax,
  actions,
  onChanged,
}: {
  topics: OwnerTopic[];
  /** Whether this page publishes /faq pages -- false for a personal page. */
  publishesFaq: boolean;
  answerMax: number;
  titleMax: number;
  actions: TopicActions;
  onChanged: () => void;
}) {
  if (topics.length === 0) {
    return (
      <EmptyState icon="questions" title="No questions yet">
        Share your link, and what people ask your page shows up here, grouped by topic.
      </EmptyState>
    );
  }

  return (
    <ul className={styles.list}>
      {topics.map((topic) => (
        <TopicRow
          key={topic.id}
          topic={topic}
          others={topics.filter((other) => other.id !== topic.id)}
          publishesFaq={publishesFaq}
          answerMax={answerMax}
          titleMax={titleMax}
          actions={actions}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}

const post = (path: string, body: unknown) =>
  apiFetch(path, { method: 'POST', body: JSON.stringify(body) }).then(() => undefined);

/** Supplies the real mutations; a Server Component may not hand closures across the RSC boundary. */
export function Topics({
  topics,
  publishesFaq,
  answerMax,
  titleMax,
}: {
  topics: OwnerTopic[];
  publishesFaq: boolean;
  answerMax: number;
  titleMax: number;
}) {
  const router = useRouter();

  const actions: TopicActions = {
    answer: (id, answer) => post(`/topics/${id}/answer`, { answer }),
    withdraw: (id) => apiFetch(`/topics/${id}/answer`, { method: 'DELETE' }).then(() => undefined),
    suppress: (id, suppressed) => post(`/topics/${id}/suppress`, { suppressed }),
    rename: (id, title) =>
      apiFetch(`/topics/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }).then(() => undefined),
    merge: (id, intoTopicId, keepAnswer) => post(`/topics/${id}/merge`, { intoTopicId, keepAnswer }),
    resolve: (id, keep) => post(`/topics/${id}/resolve`, { keep }),
    deleteTopic: (id) => apiFetch(`/topics/${id}`, { method: 'DELETE' }).then(() => undefined),
    split: (id) => post(`/questions/${id}/split`, {}),
    deleteWording: (id) => apiFetch(`/questions/${id}`, { method: 'DELETE' }).then(() => undefined),
  };

  return (
    <TopicList
      topics={topics}
      publishesFaq={publishesFaq}
      answerMax={answerMax}
      titleMax={titleMax}
      actions={actions}
      onChanged={() => router.refresh()}
    />
  );
}
