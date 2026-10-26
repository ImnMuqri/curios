'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { KnowledgeSource } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { checkSource, FILE_ACCEPT, fileSize, ingestSource, type IngestionResult, type Source, type SourceWay } from '../onboarding/source-input.js';
import { sourcePlace } from '../_ui/source-place.js';
import { useToast } from '../_ui/toast.js';
import { ICONS, sourceKind } from './facts-tab.js';
import styles from './knowledge.module.css';

const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');

// Pinned to Malaysian time: this renders on a UTC server and again in the
// browser, and an unpinned date differs between them for sources added
// 00:00-08:00 MYT. Not billing-copy's formatDate: it pulls in the core
// barrel, which a client component may not import.
const addedOn = (value: Date) =>
  value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });
const facts = (n: number) => `${n} ${n === 1 ? 'fact' : 'facts'}`;
const reading = (status: KnowledgeSource['status']) => status === 'QUEUED' || status === 'RUNNING';

/** What a source is, in the words of its card. */
function what(source: KnowledgeSource): string {
  if (source.sourceUrl) return 'Link';
  return /\.(pdf|docx|txt|md)$/i.test(source.label) ? 'File' : 'Pasted text';
}

/** How a read that just finished went, kept for the card after the list re-reads. */
type Outcome = { found: number; recheck: boolean; text: boolean };

/**
 * Asks how a source's read is going until it finishes, then says so once.
 * Its own timer rather than a cached query: a re-check reads the same source
 * again, and a cached "finished" from the last read would end it at once.
 */
function useReading(
  id: string,
  fetchStatus: (id: string) => Promise<IngestionResult>,
  onSettled: (result: IngestionResult) => void,
  onProgress: (progress: number) => void,
  intervalMs = 2000,
) {
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const moved = useRef(onProgress);
  moved.current = onProgress;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const result = await fetchStatus(id);
        if (stopped) return;
        moved.current(result.progress);
        if (result.status === 'SUCCEEDED' || result.status === 'FAILED') {
          settled.current(result);
          return;
        }
      } catch {
        // A failed poll is tried again on the next tick.
      }
      if (!stopped) timer = setTimeout(() => void ask(), intervalMs);
    };
    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, fetchStatus, intervalMs]);
}

/** The bar along the foot of a source being read, filling as far as the read has got. */
function ReadingWatch({
  id,
  fetchStatus,
  onSettled,
  onProgress,
}: {
  id: string;
  fetchStatus: (id: string) => Promise<IngestionResult>;
  onSettled: (result: IngestionResult) => void;
  onProgress: (progress: number) => void;
}) {
  const [progress, setProgress] = useState(0);
  useReading(id, fetchStatus, onSettled, (next) => {
    setProgress(next);
    onProgress(next);
  });
  return (
    <span className={styles.sprog} aria-hidden="true">
      <i style={{ width: `${Math.max(4, progress)}%` }} />
    </span>
  );
}

/** The form for one more source: a link, pasted text, or a file. */
function AddSource({
  pageId,
  pastedTextMax,
  onAdd,
  onDone,
  onCancel,
}: {
  pageId: string;
  pastedTextMax: number;
  onAdd: (source: Source) => Promise<{ ingestionId: string; truncated?: boolean }>;
  onDone: (result: { ingestionId: string; truncated: boolean; text: boolean }) => void;
  onCancel: () => void;
}) {
  const [way, setWay] = useState<SourceWay>('link');
  const [sourceUrl, setSourceUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const problem = checkSource(way, { sourceUrl, pastedText, file }, pastedTextMax);
    if (problem && 'paste' in problem) {
      setWay('text');
      setNotice(problem.paste);
      return;
    }
    if (problem) {
      setError(problem.error);
      return;
    }
    setBusy(true);
    try {
      const result = await onAdd(
        way === 'text' ? { pageId, pastedText } : way === 'file' && file ? { pageId, file } : { pageId, sourceUrl: sourceUrl.trim() },
      );
      onDone({ ingestionId: result.ingestionId, truncated: Boolean(result.truncated), text: way !== 'link' });
    } catch (failure) {
      setError(toMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className={styles.addSrc} onSubmit={(event) => void submit(event)} aria-label="Add a source">
      <div className={styles.seg} role="group" aria-label="Source type">
        {(
          [
            ['link', 'A link'],
            ['text', 'Paste text'],
            ['file', 'A file'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={way === id}
            onClick={() => {
              setWay(id);
              setError('');
              setNotice('');
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {notice ? <p className={styles.note}>{notice}</p> : null}

      {way === 'link' ? (
        <input
          ref={first}
          className={styles.inp}
          type="url"
          inputMode="url"
          autoComplete="off"
          aria-label="Link to read"
          placeholder="https://your-site.com/about"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
        />
      ) : way === 'text' ? (
        <textarea
          aria-label="Text to read"
          placeholder="Paste your menu, price list or FAQ"
          value={pastedText}
          autoFocus
          onChange={(event) => setPastedText(event.target.value)}
        />
      ) : (
        <label
          className={styles.drop}
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files[0];
            if (dropped) setFile(dropped);
          }}
        >
          <input
            type="file"
            accept={FILE_ACCEPT}
            aria-label="A file to read"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) setFile(chosen);
            }}
          />
          <b>{file ? file.name : 'Choose a file, or drop it here'}</b>
          <span>{file ? `${fileSize(file.size)}. Click to choose a different one.` : 'A menu, a price list, a brochure. PDF, Word (.docx) or text, up to 5 MB.'}</span>
        </label>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.addActs}>
        <button type="submit" className={styles.prim} disabled={busy}>
          {busy ? 'Starting…' : 'Read it'}
        </button>
        <button type="button" className={styles.btn2} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The owner's sources, presentational: each a card with what it is, when it
 * was added and how many facts it gave, read again (links) or removed. A
 * source being read shimmers until it finishes, then says what it found.
 * Handlers are injected; `onChanged` is the one place a success asks the
 * server to re-read.
 */
export function SourceList({
  sources,
  pageId,
  pastedTextMax,
  startAdding = false,
  onAdd,
  onRemove,
  onRecheck,
  fetchStatus,
  onChanged,
}: {
  sources: KnowledgeSource[];
  pageId: string;
  pastedTextMax: number;
  /** Open with the form showing: "Add a source" from elsewhere. */
  startAdding?: boolean;
  onAdd: (source: Source) => Promise<{ ingestionId: string; truncated?: boolean }>;
  onRemove: (id: string) => Promise<{ removedFacts: number }>;
  onRecheck: (id: string) => Promise<void>;
  fetchStatus: (id: string) => Promise<IngestionResult>;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(startAdding);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Read since this screen opened, before the list has caught up: a source
  // just added or just sent to be read again.
  const [started, setStarted] = useState<Record<string, { recheck: boolean; text: boolean }>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  // How far each read has got, as its own poll last said.
  const [percents, setPercents] = useState<Record<string, number>>({});
  const { say, toast } = useToast();
  // A file cut short is worth more than a moment's toast: it stays until the next add.
  const [cut, setCut] = useState('');

  async function act(id: string, run: () => Promise<unknown>, after?: () => void) {
    setBusy(id);
    setErrors(({ [id]: _gone, ...rest }) => rest);
    try {
      await run();
      setConfirming(null);
      after?.();
      onChanged();
    } catch (failure) {
      setErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
    } finally {
      setBusy(null);
    }
  }

  function settle(source: KnowledgeSource, result: IngestionResult) {
    const how = started[source.id] ?? { recheck: source.tracked && source.factCount > 0, text: source.sourceUrl === null };
    setStarted(({ [source.id]: _done, ...rest }) => rest);
    if (result.status === 'SUCCEEDED') setOutcomes((prev) => ({ ...prev, [source.id]: { found: result.extractedCount, ...how } }));
    onChanged();
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.introRow}>
        <p className={styles.intro}>Links and text Curios read to learn about you. New facts go to Review first.</p>
        {adding || sources.length === 0 ? null : (
          <button type="button" className={styles.prim} onClick={() => setAdding(true)}>
            + Add a source
          </button>
        )}
      </div>

      {adding ? (
        <AddSource
          pageId={pageId}
          pastedTextMax={pastedTextMax}
          onAdd={onAdd}
          onCancel={() => setAdding(false)}
          onDone={(result) => {
            setAdding(false);
            setStarted((prev) => ({ ...prev, [result.ingestionId]: { recheck: false, text: result.text } }));
            setCut(result.truncated ? `That file is long, so your page read the first ${pastedTextMax.toLocaleString('en-MY')} characters of it.` : '');
            onChanged();
          }}
        />
      ) : null}

      {cut ? (
        <p className={styles.note} role="status">
          {cut}
        </p>
      ) : null}
      {toast}

      {sources.length === 0 ? (
        adding ? null : (
          <div className={styles.es}>
            <div className={styles.esArt} aria-hidden="true">
              <div className={styles.esRows}>
                <span data-tone="biru">
                  <i />
                  <b />
                  <em />
                </span>
                <span data-tone="rose">
                  <i />
                  <b />
                  <em />
                </span>
                <span data-tone="amber">
                  <i />
                  <b />
                  <em />
                </span>
              </div>
              <span className={styles.esBadge}>
                <svg viewBox="0 0 24 24">
                  <path d={ICONS.web} />
                </svg>
              </span>
            </div>
            <h3>No sources yet</h3>
            <p>A link to your website, Instagram or Linktree, or a few pasted paragraphs. Curios reads it and sends what it finds to Review.</p>
            <div className={styles.esActs}>
              <button type="button" className={styles.prim} onClick={() => setAdding(true)}>
                + Add a source
              </button>
            </div>
          </div>
        )
      ) : (
        <ul className={styles.srcs}>
          {sources.map((source) => {
            const outcome = outcomes[source.id];
            // Finished as soon as its own poll says so, even if the list has
            // not caught up yet.
            const isReading = (reading(source.status) && !outcome) || source.id in started;
            const kind = sourceKind(source.label);
            const label = source.sourceUrl ? sourcePlace(source.label) : source.label;
            return (
              <li key={source.id} className={styles.src}>
                {isReading ? (
                  <>
                    <span className={styles.scan} aria-hidden="true" />
                    <ReadingWatch
                      id={source.id}
                      fetchStatus={fetchStatus}
                      onSettled={(result) => settle(source, result)}
                      onProgress={(next) => setPercents((prev) => ({ ...prev, [source.id]: next }))}
                    />
                  </>
                ) : null}
                <span className={styles.sic} data-kind={kind} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d={ICONS[kind]} />
                  </svg>
                </span>
                <span className={styles.sm}>
                  <b title={source.label}>{label}</b>
                  <span>
                    {isReading
                      ? `Reading… ${Math.max(4, percents[source.id] ?? 0)}%`
                      : source.status === 'FAILED'
                        ? `Could not read it · added ${addedOn(source.createdAt)}`
                        : `${what(source)} · added ${addedOn(source.createdAt)}${source.tracked ? '' : ' · Facts from before tracking are listed under Facts'}`}
                  </span>
                  {!isReading && source.status === 'FAILED' && source.error ? <p className={styles.error}>{source.error}</p> : null}
                  {!isReading && outcome ? (
                    outcome.found > 0 ? (
                      <span className={styles.newFacts}>
                        {outcome.found === 1 ? '1 new fact is waiting for you.' : `${outcome.found} new facts are waiting for you.`}{' '}
                        <a href="/app/review">Go to Review</a>
                      </span>
                    ) : outcome.recheck ? (
                      <span className={styles.newFacts}>No new facts. Everything it found was already there.</span>
                    ) : (
                      <span className={styles.newFacts}>
                        {outcome.text
                          ? 'Nothing to use in that. Try a few sentences about what you sell, your prices, or your hours.'
                          : 'Nothing to use there. Some sites, Instagram and TikTok especially, do not let us read them. Paste the text instead.'}
                      </span>
                    )
                  ) : null}
                  {errors[source.id] ? (
                    <p className={styles.error} role="alert">
                      {errors[source.id]}
                    </p>
                  ) : null}
                </span>

                {!isReading && source.status === 'SUCCEEDED' && source.tracked && confirming !== source.id ? (
                  <span className={styles.sfc}>
                    <b>{source.factCount}</b>
                    <span>{source.factCount === 1 ? 'fact' : 'facts'}</span>
                  </span>
                ) : null}

                {isReading ? null : confirming === source.id ? (
                  <span className={styles.confirm} role="group" aria-label="Confirm removal">
                    <span>
                      {source.tracked
                        ? `Remove it and its ${facts(source.factCount)}? Facts another source also says are removed too.`
                        : 'Remove this entry? Its older facts stay under Facts.'}
                    </span>
                    <button type="button" disabled={busy === source.id} onClick={() => void act(source.id, () => onRemove(source.id), () => say('Source removed, with its facts.'))}>
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className={styles.acts}>
                    {source.sourceUrl ? (
                      <button
                        type="button"
                        className={styles.icb}
                        title="Read again"
                        aria-label={`Read ${label} again`}
                        disabled={busy === source.id}
                        onClick={() =>
                          void act(
                            source.id,
                            () => onRecheck(source.id),
                            () => {
                              setStarted((prev) => ({ ...prev, [source.id]: { recheck: true, text: false } }));
                              setOutcomes(({ [source.id]: _old, ...rest }) => rest);
                              say(`Reading ${label} again. New facts go to Review.`);
                            },
                          )
                        }
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
                        </svg>
                      </button>
                    ) : null}
                    <button type="button" className={styles.icb} title="Remove" aria-label={`Remove ${label}`} onClick={() => setConfirming(source.id)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={ICONS.remove} />
                      </svg>
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The real handlers. A server component cannot pass functions. */
export function Sources({
  sources,
  pageId,
  pastedTextMax,
  startAdding,
}: {
  sources: KnowledgeSource[];
  pageId: string;
  pastedTextMax: number;
  startAdding?: boolean;
}) {
  const router = useRouter();
  return (
    <SourceList
      sources={sources}
      pageId={pageId}
      pastedTextMax={pastedTextMax}
      startAdding={startAdding}
      onAdd={ingestSource}
      onRemove={(id) => apiFetch<{ removedFacts: number }>(`/sources/${id}`, { method: 'DELETE' })}
      onRecheck={async (id) => {
        await apiFetch(`/sources/${id}/recheck`, { method: 'POST' });
      }}
      fetchStatus={fetchStatus}
      onChanged={() => router.refresh()}
    />
  );
}

// Stable, so a reading row's poll is not restarted by every render.
const fetchStatus = (id: string) => apiFetch<IngestionResult>(`/ingest/${id}`);
