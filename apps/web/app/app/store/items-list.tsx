'use client';

import { useState } from 'react';
import { MAX_ITEMS, priceLine } from '@curios/core/store';
import { Callout } from '@curios/ui';
import ui from '../_ui/editor.module.css';
import { SectionHead } from '../_ui/section-head.js';
import type { EditorItem } from './store-types.js';
import styles from './store.module.css';

const UP = 'M6 15l6-6 6 6';
const DOWN = 'M6 9l6 6 6-6';
const PENCIL = 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4';

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
      <path d={d} />
    </svg>
  );
}

/** An item's picture, or its first letter on one of four soft tints. */
export function Thumb({ item, tint }: { item: EditorItem; tint: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.thumb} data-tint={tint % 4} aria-hidden="true">
      {item.photoUrl && !failed ? <img src={item.photoUrl} alt="" onError={() => setFailed(true)} /> : (item.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * The shelf, in the order customers see it: each item with its price, a
 * switch for whether it is in the shop, and (on hover) move and edit. Moves
 * and switches save at once; editing opens the item on its own.
 */
export function ItemsList({
  items,
  onMove,
  onAvailable,
  onEdit,
  onAdd,
  error,
}: {
  items: EditorItem[];
  onMove: (from: number, to: number) => void;
  onAvailable: (id: string, available: boolean) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  error: string;
}) {
  const live = items.filter((item) => item.available).length;

  return (
    <section className={ui.section} aria-labelledby="items-title">
      <SectionHead id="items-title" title="Items" note={`${items.length} ${items.length === 1 ? 'item' : 'items'} · ${live} in your shop`} />

      {items.length === 0 ? (
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
          <p>Add what you sell, with a photo and a price or sizes. It shows in your Shop tab, and the chat can quote it exactly.</p>
          <button type="button" className={ui.primaryButton} onClick={onAdd}>
            + Add your first item
          </button>
        </div>
      ) : (
        <ul className={styles.itemList}>
          {items.map((item, index) => (
            <li key={item.id} className={styles.item} aria-label={item.name} data-hidden={item.available ? undefined : ''}>
              <Thumb item={item} tint={index} />
              <button type="button" className={styles.itemText} onClick={() => onEdit(item.id)}>
                <b>{item.name}</b>
                <span>{priceLine(item) || 'Needs a price'}</span>
              </button>
              <span className={styles.available}>
                <button
                  type="button"
                  className={ui.switch}
                  role="switch"
                  aria-checked={item.available}
                  aria-label={`In your shop: ${item.name}`}
                  onClick={() => onAvailable(item.id, !item.available)}
                >
                  <i />
                </button>
                {item.available ? 'In your shop' : 'Hidden'}
              </span>
              <span className={styles.tools}>
                <button type="button" className={ui.iconButton} aria-label={`Move ${item.name} up`} title="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
                  <Icon d={UP} />
                </button>
                <button
                  type="button"
                  className={ui.iconButton}
                  aria-label={`Move ${item.name} down`}
                  title="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => onMove(index, index + 1)}
                >
                  <Icon d={DOWN} />
                </button>
                <button type="button" className={ui.iconButton} aria-label={`Edit ${item.name}`} title="Edit" onClick={() => onEdit(item.id)}>
                  <Icon d={PENCIL} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error ? <Callout tone="error">{error}</Callout> : null}

      {items.length === 0 ? null : items.length >= MAX_ITEMS ? (
        <p className={ui.note}>{MAX_ITEMS} items is the most a shop holds. Remove one to add another.</p>
      ) : (
        <button type="button" className={ui.addRow} onClick={onAdd}>
          + Add item
        </button>
      )}
    </section>
  );
}
