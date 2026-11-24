'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { FactCategory } from '@curios/core';
import type { KnowledgeFact } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { sourcePlace } from '../_ui/source-place.js';
import { useToast } from '../_ui/toast.js';
import { RowMenu } from './row-menu.js';
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

/** Sent on the window by the header's "+ Add a fact": the open Facts tab shows its add line. */
export const ADD_FACT_EVENT = 'curios:add-fact';

/** A file's name, as a source label shows one (pasted text is labelled by its first line). */
const FILE_NAME = /\.(pdf|docx?|txt|rtf|csv|xlsx?|pptx?|png|jpe?g|webp|heic)$/i;
/** A whole path segment that says the page lists what the owner sells ("/menu", "/harga"), not a word inside one ("/border"). */
const MENU_SEGMENT = /^(menu|menus|harga|price|prices|pricing|katalog|catalog|catalogue)$/i;

/**
 * Where a fact came from, in the board's words. The app records the source's address, file name or the
 * first line of pasted text, not what kind of page it was, so the kind is read from the address:
 * an Instagram or TikTok profile, a page whose address says menu or prices, else the page's own address
 * (host and path). A source that has since been removed leaves "Source removed"; a fact from before
 * sources were tracked has no recorded source and says so.
 */
export function factSource(fact: KnowledgeFact): { label: string; href?: string; hint?: string } {
  if (fact.origin === 'OWNER') return { label: 'You wrote this' };
  if (fact.origin === 'UNTRACKED') return { label: 'Source not recorded', hint: 'Added before Curios kept track of where facts came from' };
  const raw = fact.sourceLabel;
  if (!raw) return { label: 'Source removed', hint: 'The source this came from has been removed' };
  if (!/^https?:\/\//i.test(raw)) return { label: FILE_NAME.test(raw) ? raw : 'Pasted text', hint: raw };
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  const place = sourcePlace(raw);
  const segments = url ? url.pathname.split('/').filter(Boolean) : [];
  let label = place;
  if (place.startsWith('instagram.com')) label = segments.length <= 1 ? 'Instagram bio' : 'Instagram post';
  else if (place.startsWith('tiktok.com')) label = segments.length <= 1 ? 'TikTok profile' : 'TikTok video';
  else if (segments.some((segment) => MENU_SEGMENT.test(segment))) label = 'Menu page';
  // A label is cut at SOURCE_LABEL_MAX with an ellipsis: that address is not the page's, so it is not linked.
  return url && !raw.endsWith('…') ? { label, href: url.href, hint: place } : { label, hint: place };
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
  const from = factSource(fact);
  const row = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Back in view after a Keep or Cancel, focus returns to the row's menu button. */
  const refocus = useRef(false);

  useEffect(() => {
    if (mode === 'view' && refocus.current) {
      refocus.current = false;
      row.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    }
  }, [mode]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      refocus.current = true;
      setMode('view');
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function toView() {
    refocus.current = true;
    setError('');
    setMode('view');
  }

  const menuLabel = 'More actions for this fact';

  return (
    <div ref={row} className={styles.frow} role="row" data-fact={fact.id} data-mode={mode} data-menu={menuOpen || undefined}>
      {mode === 'edit' ? (
        <div className={styles.fspan} role="cell">
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
                toView();
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
              toView();
            }}
          >
            Cancel
          </button>
        </div>
      ) : mode === 'confirm' ? (
        <div className={styles.fspan} role="cell">
          <p className={`${styles.claim} ${styles.warn}`}>Remove it? The chat stops using it, and a re-read won’t bring it back.</p>
          <span className={styles.confirm} role="group" aria-label="Confirm removal">
            <button type="button" disabled={busy} autoFocus onClick={() => void run(() => onRemove(fact.id))}>
              Remove
            </button>
            <button type="button" onClick={toView}>
              Keep
            </button>
          </span>
        </div>
      ) : (
        <>
          <span className={styles.kindTag} role="cell">
            {KIND_LABELS[fact.category]}
          </span>
          <p className={styles.claim} role="cell">
            {fact.claim}
          </p>
          <span className={styles.origin} role="cell" title={from.hint}>
            {from.href ? (
              <a href={from.href} target="_blank" rel="noreferrer">
                {from.label}
              </a>
            ) : (
              from.label
            )}
          </span>
          <span className={styles.menuCell} role="cell">
            <RowMenu
              label={menuLabel}
              onOpenChange={setMenuOpen}
              items={[
                { label: 'Edit', onSelect: () => setMode('edit') },
                { label: 'Remove', danger: true, onSelect: () => setMode('confirm') },
              ]}
            />
          </span>
        </>
      )}

      {error ? (
        <div className={styles.fspan} role="cell">
          <p className={styles.error} role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every accepted fact as one table (Topic, Fact, From) with a filter by kind and a search;
 * each one can be edited in place or removed from its "···" menu. The header's "+ Add a fact"
 * (ADD_FACT_EVENT) opens a line to write one, trusted straight away. Presentational: handlers are injected,
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
  const table = useRef<HTMLDivElement>(null);
  /** After a removal: the rows to give focus to, next first, then previous. */
  const after = useRef<string[] | null>(null);

  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  function openAdd() {
    setKind(filter === 'all' ? (categories[0] ?? 'MISC') : filter);
    setError('');
    setAdding(true);
  }

  // The header's "+ Add a fact" (page.tsx) sits outside this tab: it asks for the add line by event.
  const showAdd = useRef(openAdd);
  showAdd.current = openAdd;
  useEffect(() => {
    const show = () => {
      showAdd.current();
      field.current?.focus();
    };
    window.addEventListener(ADD_FACT_EVENT, show);
    return () => window.removeEventListener(ADD_FACT_EVENT, show);
  }, []);

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
  // The order of the kinds, then the order the facts came in.
  const ordered = categories.flatMap((c) => shown.filter((f) => f.category === c));
  const counts = categories.map((c) => ({ category: c, n: facts.filter((f) => f.category === c).length })).filter((c) => c.n > 0);

  // The removed row is gone once the server's read arrives: focus the next row's menu button, else the previous, else the search.
  useEffect(() => {
    const ids = after.current;
    if (!ids) return;
    after.current = null;
    for (const id of ids) {
      const button = table.current?.querySelector<HTMLElement>(`[data-fact="${CSS.escape(id)}"] [aria-haspopup]`);
      if (button) return button.focus();
    }
    document.querySelector<HTMLElement>('input[aria-label="Search facts"]')?.focus();
  }, [facts]);

  // Each row's own handlers wrap onChanged, so a success re-reads the server.
  const edit = async (id: string, text: string) => {
    await onEdit(id, text);
    say('Saved.');
    onChanged();
  };
  const remove = async (id: string) => {
    await onRemove(id);
    const at = ordered.findIndex((f) => f.id === id);
    after.current = [ordered[at + 1]?.id, ordered[at - 1]?.id].filter((x): x is string => Boolean(x));
    say('Removed. The chat no longer uses it.');
    onChanged();
  };

  return (
    <div className={styles.wrap}>
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

      {facts.length > 0 ? (
        <div className={styles.ftb}>
          <div className={styles.chips} role="group" aria-label="Show">
            {[{ category: 'all' as const, n: facts.length }, ...counts].map((c) => (
              <button key={c.category} type="button" className={styles.chip} aria-pressed={filter === c.category} onClick={() => setFilter(c.category)}>
                {c.category === 'all' ? 'All' : KIND_LABELS[c.category]} <i>{c.n}</i>
              </button>
            ))}
          </div>
          <label className={styles.search}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" />
            </svg>
            <input type="search" aria-label="Search facts" placeholder="Search your facts" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
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
      ) : ordered.length === 0 ? (
        <p className={styles.noMatch}>
          No facts match. Try another word.
        </p>
      ) : (
        <div ref={table} className={styles.tbl} role="table" aria-label="Your facts">
          <div className={styles.thead} role="row">
            <span role="columnheader">Topic</span>
            <span role="columnheader">Fact</span>
            <span role="columnheader">From</span>
            <span role="columnheader">
              <span className={styles.sr}>Actions</span>
            </span>
          </div>
          {ordered.map((fact) => (
            <FactRow key={fact.id} fact={fact} ownerFactMax={ownerFactMax} onEdit={edit} onRemove={remove} />
          ))}
        </div>
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
  // "?add=1" opened the add line once; a refresh should not open it again.
  useEffect(() => {
    if (startAdding) router.replace('/app/knowledge?tab=facts', { scroll: false });
    // Once, on arrival.
  }, []);
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
