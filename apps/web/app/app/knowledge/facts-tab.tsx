'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { FactCategory } from '@curios/core';
import type { KnowledgeFact } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { sourcePlace } from '../_ui/source-place.js';
import { useToast } from '../_ui/toast.js';
import styles from './knowledge.module.css';

const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');

/** Each kind's name on this screen. */
export const KIND_LABELS: Record<FactCategory, string> = {
  PRICE: 'Price',
  HOURS: 'Hours',
  LOCATION: 'Location',
  POLICY: 'Policy',
  PRODUCT: 'Product',
  PERSON: 'About you',
  MISC: 'Other',
};

export const ICONS = {
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  tiktok: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.6 2.6 2.4 4 5 4',
  text: 'M6 3h9l4 4v14H6zM9 12h7M9 16h5',
  you: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  before: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  remove: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
} as const;

/** Which icon a source wears: the site it is on, or a page of text for pasted text and files. */
export function sourceKind(label: string): 'web' | 'instagram' | 'tiktok' | 'text' {
  if (!/^https?:\/\//i.test(label)) return 'text';
  const place = sourcePlace(label);
  if (place.startsWith('instagram.com')) return 'instagram';
  if (place.startsWith('tiktok.com')) return 'tiktok';
  return 'web';
}

function origin(fact: KnowledgeFact): { label: string; icon: string } {
  if (fact.origin === 'OWNER') return { label: 'Added by you', icon: ICONS.you };
  if (fact.origin === 'UNTRACKED') return { label: 'Before tracking', icon: ICONS.before };
  const label = fact.sourceLabel ?? 'A source';
  return { label: sourcePlace(label), icon: ICONS[sourceKind(label)] };
}

function FactRow({
  fact,
  ownerFactMax,
  onEdit,
  onRemove,
}: {
  fact: KnowledgeFact;
  ownerFactMax: number;
  onEdit: (id: string, claim: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [draft, setDraft] = useState(fact.claim);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const from = origin(fact);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setMode('view');
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.row}>
      {mode === 'edit' ? (
        <>
          <input
            className={styles.edit}
            aria-label="Edit fact"
            maxLength={ownerFactMax}
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim()) void run(() => onEdit(fact.id, draft.trim()));
              if (event.key === 'Escape') {
                setDraft(fact.claim);
                setError('');
                setMode('view');
              }
            }}
          />
          <button type="button" className={styles.prim} disabled={busy || !draft.trim()} onClick={() => void run(() => onEdit(fact.id, draft.trim()))}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={styles.btn2}
            onClick={() => {
              setDraft(fact.claim);
              setError('');
              setMode('view');
            }}
          >
            Cancel
          </button>
        </>
      ) : mode === 'confirm' ? (
        <>
          <p className={`${styles.claim} ${styles.warn}`}>Remove it? The chat stops using it, and a re-read won’t bring it back.</p>
          <span className={styles.confirm} role="group" aria-label="Confirm removal">
            <button type="button" disabled={busy} onClick={() => void run(() => onRemove(fact.id))}>
              Remove
            </button>
            <button
              type="button"
              onClick={() => {
                setError('');
                setMode('view');
              }}
            >
              Keep
            </button>
          </span>
        </>
      ) : (
        <>
          <p className={styles.claim}>{fact.claim}</p>
          <span className={styles.origin} title={from.label}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={from.icon} />
            </svg>
            <span>{from.label}</span>
          </span>
          <span className={styles.acts}>
            <button type="button" className={styles.icb} title="Edit" aria-label="Edit fact" onClick={() => setMode('edit')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={ICONS.edit} />
              </svg>
            </button>
            <button type="button" className={styles.icb} title="Remove" aria-label="Remove fact" onClick={() => setMode('confirm')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={ICONS.remove} />
              </svg>
            </button>
          </span>
        </>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Every accepted fact, grouped by kind, with a search and a filter by kind;
 * each one can be edited in place or removed. "+ Add a fact" opens a line to
 * write one, trusted straight away. Presentational: handlers are injected,
 * and `onChanged` is the one place a success asks the server to re-read.
 */
export function FactList({
  facts,
  categories,
  ownerFactMax,
  startAdding = false,
  onAdd,
  onEdit,
  onRemove,
  onChanged,
}: {
  facts: KnowledgeFact[];
  categories: FactCategory[];
  ownerFactMax: number;
  /** Open with the add line showing: Review's "Write a fact yourself". */
  startAdding?: boolean;
  onAdd: (category: FactCategory, claim: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(startAdding);
  const [kind, setKind] = useState<FactCategory>(categories[0] ?? 'MISC');
  const [claim, setClaim] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { say, toast } = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FactCategory | 'all'>('all');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  function openAdd() {
    setKind(filter === 'all' ? (categories[0] ?? 'MISC') : filter);
    setError('');
    setAdding(true);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!claim.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onAdd(kind, claim.trim());
      setClaim('');
      setAdding(false);
      setFilter('all');
      setQuery('');
      say('Added. The chat can use it now.');
      onChanged();
    } catch (failure) {
      setError(toMessage(failure));
      // The button is disabled while busy, which drops focus.
      field.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const shown = facts.filter((f) => (filter === 'all' || f.category === filter) && (!needle || f.claim.toLowerCase().includes(needle)));
  const groups = categories.map((c) => ({ category: c, facts: shown.filter((f) => f.category === c) })).filter((g) => g.facts.length > 0);
  const counts = categories.map((c) => ({ category: c, n: facts.filter((f) => f.category === c).length })).filter((c) => c.n > 0);

  // Each row's own handlers wrap onChanged, so a success re-reads the server.
  const edit = async (id: string, text: string) => {
    await onEdit(id, text);
    say('Saved.');
    onChanged();
  };
  const remove = async (id: string) => {
    await onRemove(id);
    say('Removed. The chat no longer uses it.');
    onChanged();
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.tool}>
        <label className={styles.search}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input type="search" aria-label="Search facts" placeholder="Search your facts" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className={styles.prim} aria-expanded={adding} onClick={() => (adding ? setAdding(false) : openAdd())}>
          + Add a fact
        </button>
      </div>

      {facts.length > 0 ? (
        <div className={styles.chips} role="group" aria-label="Show">
          {[{ category: 'all' as const, n: facts.length }, ...counts].map((c) => (
            <button key={c.category} type="button" className={styles.chip} aria-pressed={filter === c.category} onClick={() => setFilter(c.category)}>
              {c.category === 'all' ? 'All' : KIND_LABELS[c.category]} <i>{c.n}</i>
            </button>
          ))}
        </div>
      ) : null}

      {adding ? (
        <form className={styles.add} onSubmit={(event) => void add(event)}>
          <div className={styles.chips} role="radiogroup" aria-label="Kind of fact">
            {categories.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={kind === c} className={styles.chip} data-kind={c} onClick={() => setKind(c)}>
                {KIND_LABELS[c]}
              </button>
            ))}
          </div>
          <div className={styles.addRow}>
            <input
              ref={field}
              className={styles.inp}
              aria-label="New fact"
              placeholder="One line, like: Eggless available for kek coklat"
              maxLength={ownerFactMax}
              value={claim}
              onChange={(event) => setClaim(event.target.value)}
            />
            <button type="submit" className={styles.prim} disabled={busy || !claim.trim()}>
              {busy ? 'Adding…' : 'Add'}
            </button>
            <button type="button" className={styles.btn2} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <span>Facts you add are trusted straight away. No review needed.</span>
        </form>
      ) : null}

      {toast}

      {facts.length === 0 ? (
        adding ? null : (
          <div className={styles.es}>
            <div className={styles.esArt} aria-hidden="true">
              <div className={styles.esRows}>
                <span data-tone="amber">
                  <i />
                  <b />
                  <em />
                </span>
                <span data-tone="biru">
                  <i />
                  <b />
                  <em />
                </span>
                <span data-tone="hijau">
                  <i />
                  <b />
                  <em />
                </span>
              </div>
              <span className={styles.esBadge}>
                <svg viewBox="0 0 24 24">
                  <path d="M4 5h16v11H8l-4 4zM8 9h8M8 12h5" />
                </svg>
              </span>
            </div>
            <h3>Your page knows nothing yet</h3>
            <p>Facts are what the chat answers from: prices, hours, where you are. Add a source and Curios reads them for you, or write them yourself.</p>
            <div className={styles.esActs}>
              <a className={styles.prim} href="/app/knowledge?tab=sources&add=1">
                Add a source
              </a>
              <button type="button" className={styles.btn2} onClick={openAdd}>
                Write a fact
              </button>
            </div>
          </div>
        )
      ) : groups.length === 0 ? (
        <p className={styles.noMatch}>
          <b>No match</b>
          Nothing in your facts says that. Add it, and the chat can use it.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category} className={styles.group} data-kind={group.category}>
            <h2>{KIND_LABELS[group.category]}</h2>
            <ul className={styles.rows}>
              {group.facts.map((fact) => (
                <FactRow key={fact.id} fact={fact} ownerFactMax={ownerFactMax} onEdit={edit} onRemove={remove} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

export function Facts({
  facts,
  categories,
  ownerFactMax,
  startAdding,
}: {
  facts: KnowledgeFact[];
  categories: FactCategory[];
  ownerFactMax: number;
  startAdding?: boolean;
}) {
  const router = useRouter();
  return (
    <FactList
      facts={facts}
      categories={categories}
      ownerFactMax={ownerFactMax}
      startAdding={startAdding}
      onAdd={async (category, claim) => {
        await apiFetch('/facts', { method: 'POST', body: JSON.stringify({ category, claim }) });
      }}
      onEdit={async (id, claim) => {
        await apiFetch(`/facts/${id}`, { method: 'PATCH', body: JSON.stringify({ claim }) });
      }}
      onRemove={async (id) => {
        await apiFetch(`/facts/${id}/reject`, { method: 'POST' });
      }}
      onChanged={() => router.refresh()}
    />
  );
}
