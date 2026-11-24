'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ItemStats } from '@curios/db-read';
import { MAX_ITEMS } from '@curios/core/store';
import { Callout } from '@curios/ui';
import ui from '../_ui/editor.module.css';
import inbox from '../_ui/inbox.module.css';
import { Popover } from '../_ui/popover.js';
import { ownerPriceLine } from './pricing.js';
import { timeLabel } from './session-time.js';
import type { EditorItem } from './store-types.js';
import styles from './store.module.css';

export const NEW_ITEM_HREF = '/app/store/items/new';
export const itemHref = (id: string) => `/app/store/items/${id}`;

const DOTS = 'M5 12h.01M12 12h.01M19 12h.01';

type Filter = 'all' | 'on' | 'off' | 'dig';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'on', label: 'In your shop' },
  { id: 'off', label: 'Hidden' },
  { id: 'dig', label: 'Digital' },
];

/** What an empty filter says, when the owner has typed nothing in the search. */
const NOTHING: Record<Filter, string> = {
  all: '',
  on: 'Nothing is in your shop yet. Switch an item on.',
  off: 'Nothing is hidden. Every item is in your shop.',
  dig: 'No digital items yet.',
};

const DELIVERY_WORD = { FILES: 'Files', LINK: 'Link', CODES: 'Codes', SESSION: 'Session' } as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A session item's next time that has not finished: the store read's, or, without it, from the sessions the item itself holds. */
function nextTime(item: EditorItem, stats: ItemStats | undefined, now = new Date()): ItemStats['seats'] {
  if (stats?.seats) return stats.seats;
  if (item.delivery !== 'SESSION') return null;
  const next = item.sessions.find((t) => t.startsAt.getTime() + (item.sessionMinutes ?? 0) * 60_000 >= now.getTime());
  return next ? { startsAt: next.startsAt, taken: next.booked, total: next.seats } : null;
}

/** The board's one line of what an item has done lately, or null: nothing is said for a count of 0. */
export function statLine(stats: ItemStats | undefined, seats: ItemStats['seats'] = stats?.seats ?? null): string | null {
  if (seats) return `${seats.taken} of ${seats.total} seats taken`;
  if (!stats) return null;
  if (stats.sold > 0) return `${stats.sold} sold in 30 days`;
  if (stats.enquiries > 0) return `${plural(stats.enquiries, 'enquiry', 'enquiries')} in 30 days`;
  return null;
}

/** "RM95", "from RM180 · Ask", "RM25 · Digital, sent by email" or "RM60 · Sat 7 Nov, 8:00pm": under the name. */
function subLine(item: EditorItem, seats: ItemStats['seats']): string {
  const price = ownerPriceLine(item) || 'Needs a price';
  if (item.kind !== 'DIGITAL') return price;
  if (item.delivery !== 'SESSION') return `${price} · Digital, sent by email`;
  return `${price} · ${seats ? timeLabel(seats.startsAt) : 'No time to come'}`;
}

/** An item's picture, or its first letter on one of four soft tints (a digital one says what it is instead). */
function Photo({ item, tint }: { item: EditorItem; tint: number }) {
  const [failed, setFailed] = useState(false);
  const digital = item.kind === 'DIGITAL' && item.delivery ? DELIVERY_WORD[item.delivery] : null;
  const picture = item.photoUrl && !failed;
  return (
    <span className={styles.cardPhoto} data-tint={tint % 4} aria-hidden="true">
      {picture ? <img src={item.photoUrl ?? ''} alt="" width={400} height={150} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : digital ? <span className={styles.cardKind}>{digital}</span> : (item.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * The shelf, as the board's card grid, in the order customers see it: a photo, the name and price,
 * what the item has done lately, and a switch for whether it is in the shop. A card opens the
 * item on its own screen. The shop's order is kept from the card's "..." menu (Move earlier /
 * Move later), which moves it past the neighbour it has under the filter and search in force.
 * Switches and moves save at once.
 */
export function ItemsList({
  items,
  stats,
  onMove,
  onAvailable,
  showFilter,
  error,
}: {
  items: EditorItem[];
  stats: Record<string, ItemStats>;
  onMove: (from: number, to: number) => void;
  onAvailable: (id: string, available: boolean) => void;
  /** Set from outside (the ready box's first step) to show only the hidden items. */
  showFilter?: { filter: Filter; n: number } | null;
  error: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!showFilter) return;
    setFilter(showFilter.filter);
    setQuery('');
  }, [showFilter]);

  // After a move the card is somewhere else in the grid: its menu button keeps the focus.
  const grid = useRef<HTMLUListElement>(null);
  const moved = useRef<string | null>(null);
  const order = items.map((item) => item.id).join(',');
  useLayoutEffect(() => {
    const id = moved.current;
    if (!id) return;
    moved.current = null;
    grid.current?.querySelector<HTMLButtonElement>(`button[data-more="${id}"]`)?.focus();
  }, [order]);

  const counts: Record<Filter, number> = {
    all: items.length,
    on: items.filter((item) => item.available).length,
    off: items.filter((item) => !item.available).length,
    dig: items.filter((item) => item.kind === 'DIGITAL').length,
  };
  const words = query.trim().toLowerCase();
  const shown = items.filter(
    (item) =>
      (filter === 'all' || (filter === 'on' ? item.available : filter === 'off' ? !item.available : item.kind === 'DIGITAL')) &&
      (!words || [item.name, item.category, item.tag, item.sku].some((field) => field?.toLowerCase().includes(words))),
  );

  if (items.length === 0) {
    return (
      <section className={styles.shelf} aria-label="Items">
        <div className={ui.empty}>
          <div className={ui.emptyArt} aria-hidden="true">
            <span className={ui.ghostRows}>
              <span data-tone="rose"><i /><b /><em /></span>
              <span data-tone="amber"><i /><b /><em /></span>
              <span data-tone="hijau"><i /><b /><em /></span>
            </span>
            <span className={ui.emptyBadge} data-tone="rose">
              <svg viewBox="0 0 24 24" width="21" height="21">
                <path d="M4 7h16v13H4zM4 7l2-3h12l2 3M9 11h6" />
              </svg>
            </span>
          </div>
          <h3>Your shelf is empty</h3>
          <p>Add what you sell, with a photo and a price or sizes. It shows in your shop, and the chat can quote it exactly.</p>
          <Link className={ui.primaryButton} href={NEW_ITEM_HREF} prefetch={false}>
            + Add your first item
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shelf} aria-label="Items">
      <div className={inbox.fbar}>
        <div className={inbox.chips} role="group" aria-label="Show items">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={inbox.chip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              <u>{counts[f.id]}</u>
            </button>
          ))}
        </div>
        <label className={inbox.search}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" value={query} placeholder="Search your items" aria-label="Search your items" onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      <ul ref={grid} className={styles.grid} aria-label="Your items">
        {shown.map((item, at) => {
          const index = items.indexOf(item);
          const before = shown[at - 1];
          const after = shown[at + 1];
          const seats = nextTime(item, stats[item.id]);
          const line = item.available ? statLine(stats[item.id], seats) : null;
          return (
            <li key={item.id} className={styles.card} data-hidden={item.available ? undefined : ''}>
              <Link className={styles.cardLink} href={itemHref(item.id)} prefetch={false} aria-label={`Edit ${item.name}`}>
                <Photo item={item} tint={index} />
                <span className={styles.cardText}>
                  <b>{item.name}</b>
                  <small>{subLine(item, seats)}</small>
                </span>
              </Link>
              <div className={styles.cardFoot}>
                {item.available ? <span className={styles.sold}>{line}</span> : <span className={styles.hid}>Hidden from your shop</span>}
                <button
                  type="button"
                  className={ui.switch}
                  role="switch"
                  aria-checked={item.available}
                  aria-label={`Show ${item.name} in your shop`}
                  onClick={() => onAvailable(item.id, !item.available)}
                >
                  <i />
                </button>
              </div>
              <div className={styles.cardMenu}>
                <Popover label={`More for ${item.name}`} buttonClassName={styles.cardDots} buttonData={{ 'data-more': item.id }} panelClassName={styles.cardMenuPanel} button={<svg viewBox="0 0 24 24" aria-hidden="true"><path d={DOTS} /></svg>}>
                  <button type="button" data-closes="" disabled={!before} onClick={() => {
                      if (!before) return;
                      moved.current = item.id;
                      onMove(index, items.indexOf(before));
                    }}>
                    Move earlier
                  </button>
                  <button type="button" data-closes="" disabled={!after} onClick={() => {
                      if (!after) return;
                      moved.current = item.id;
                      onMove(index, items.indexOf(after));
                    }}>
                    Move later
                  </button>
                </Popover>
              </div>
            </li>
          );
        })}
        {items.length >= MAX_ITEMS ? null : (
          <li className={styles.cardAdd}>
            <Link href={NEW_ITEM_HREF} prefetch={false}>
              + Add an item
            </Link>
          </li>
        )}
      </ul>
      {shown.length === 0 ? (
        <p className={styles.noMatch} role="status">
          {words ? (
            <>
              No items match. Try another word, or <Link href={NEW_ITEM_HREF} prefetch={false}>add an item</Link>.
            </>
          ) : (
            NOTHING[filter]
          )}
        </p>
      ) : null}
      {items.length >= MAX_ITEMS ? <p className={ui.note}>{MAX_ITEMS} items is the most a shop holds. Remove one to add another.</p> : null}

      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}
