'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Callout, Field } from '@curios/ui';
import {
  ITEM_DESCRIPTION_MAX,
  ITEM_NAME_MAX,
  MAX_ITEMS,
  MAX_OPTIONS,
  parseRinggit,
  priceLine,
  pricingProblem,
  type Pricing,
} from '@curios/core/store';
import type { OwnerStore } from '@curios/db-read';
import panel from '../panel.module.css';
import { EmptyState } from '../_ui/empty-state.js';
import styles from './store.module.css';

export type EditorItem = OwnerStore['items'][number] & { photoUrl: string | null };

/** What the API returns for an item. Declared here: the web app never imports from apps/api. */
export type ItemRow = {
  id: string;
  name: string;
  description: string | null;
  photoKey: string | null;
  available: boolean;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
};

export type ItemPatch = { name?: string; description?: string | null; available?: boolean; pricing?: Pricing };

export type ItemsApi = {
  add: (input: { name: string; description: string | null; pricing: Pricing }) => Promise<ItemRow>;
  update: (id: string, patch: ItemPatch) => Promise<ItemRow>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  /** Resolves to the public URL of the stored picture. */
  uploadPhoto: (id: string, file: File) => Promise<string>;
  removePhoto: (id: string) => Promise<void>;
};

const PRICE_PARSE_SENTENCE = 'That price does not look right. Use ringgit and sen, like 95 or 95.50.';
const NAME_SENTENCE = `Give the item a name, up to ${ITEM_NAME_MAX} characters.`;
const DESCRIPTION_SENTENCE = `A description is up to ${ITEM_DESCRIPTION_MAX} characters.`;

const message = (failure: unknown) => (failure instanceof Error ? failure.message : 'That did not save. Try again.');

/** 9500 -> "95", 9550 -> "95.50": a price as the owner would type it. */
function centsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

type OptionDraft = { key: number; label: string; price: string };
type PricingDraft = { kind: 'single' | 'options'; price: string; options: OptionDraft[] };

let nextKey = 1;
const blankOption = (): OptionDraft => ({ key: nextKey++, label: '', price: '' });

function draftOf(item: { priceCents: number | null; options: { label: string; priceCents: number }[] } | null): PricingDraft {
  if (item && item.options.length > 0) {
    return {
      kind: 'options',
      price: '',
      options: item.options.map((o) => ({ key: nextKey++, label: o.label, price: centsText(o.priceCents) })),
    };
  }
  return { kind: 'single', price: item?.priceCents != null ? centsText(item.priceCents) : '', options: [] };
}

/** The pricing to send, or the sentence the owner should read instead. */
function pricingOf(draft: PricingDraft): { pricing: Pricing } | { error: string } {
  let pricing: Pricing;
  if (draft.kind === 'single') {
    const cents = parseRinggit(draft.price);
    if (cents === null) return { error: PRICE_PARSE_SENTENCE };
    pricing = { kind: 'single', priceCents: cents };
  } else {
    const options: { label: string; priceCents: number }[] = [];
    for (const option of draft.options) {
      const cents = parseRinggit(option.price);
      if (cents === null) return { error: PRICE_PARSE_SENTENCE };
      options.push({ label: option.label.trim(), priceCents: cents });
    }
    pricing = { kind: 'options', options };
  }
  const problem = pricingProblem(pricing);
  return problem ? { error: problem } : { pricing };
}

/** Name, description and pricing, checked in the order the owner reads them. */
function checkFields(name: string, description: string, draft: PricingDraft): { name: string; description: string | null; pricing: Pricing } | { error: string } {
  const trimmed = name.trim();
  if (trimmed === '' || [...trimmed].length > ITEM_NAME_MAX) return { error: NAME_SENTENCE };
  if ([...description].length > ITEM_DESCRIPTION_MAX) return { error: DESCRIPTION_SENTENCE };
  const priced = pricingOf(draft);
  if ('error' in priced) return priced;
  return { name: trimmed, description: description.trim() || null, pricing: priced.pricing };
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={styles.toolIcon}>
      <path d={d} />
    </svg>
  );
}

const UP = 'M6 15l6-6 6 6';
const DOWN = 'M6 9l6 6 6-6';
const BIN = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';

/** One price, or a list of options: the same fields for a new item and an existing one. */
function PricingFields({ prefix, draft, onChange }: { prefix: string; draft: PricingDraft; onChange: (draft: PricingDraft) => void }) {
  const setOption = (key: number, change: Partial<OptionDraft>) =>
    onChange({ ...draft, options: draft.options.map((o) => (o.key === key ? { ...o, ...change } : o)) });

  return (
    <div className={styles.pricing}>
      <div className={styles.choices} role="radiogroup" aria-label="How it is priced">
        {(
          [
            ['single', 'One price'],
            ['options', 'Options'],
          ] as const
        ).map(([kind, label]) => (
          <label key={kind} className={panel.check}>
            <input
              type="radio"
              name={`${prefix}-kind`}
              checked={draft.kind === kind}
              onChange={() => onChange({ ...draft, kind, options: kind === 'options' && draft.options.length === 0 ? [blankOption()] : draft.options })}
            />
            {label}
          </label>
        ))}
      </div>
      {draft.kind === 'single' ? (
        <Field id={`${prefix}-price`} label="Price (RM)" value={draft.price} onChange={(price) => onChange({ ...draft, price })} autoComplete="off" />
      ) : (
        <>
          {draft.options.map((option, index) => (
            <div key={option.key} className={styles.optionRow}>
              <Field id={`${prefix}-option-${option.key}-label`} label={`Option ${index + 1} name`} value={option.label} onChange={(label) => setOption(option.key, { label })} autoComplete="off" />
              <Field id={`${prefix}-option-${option.key}-price`} label={`Option ${index + 1} price (RM)`} value={option.price} onChange={(price) => setOption(option.key, { price })} autoComplete="off" />
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Remove option ${index + 1}`}
                title="Remove option"
                onClick={() => onChange({ ...draft, options: draft.options.filter((o) => o.key !== option.key) })}
              >
                <Icon d={BIN} />
              </button>
            </div>
          ))}
          {draft.options.length < MAX_OPTIONS ? (
            <button type="button" className={styles.addButton} onClick={() => onChange({ ...draft, options: [...draft.options, blankOption()] })}>
              + Add option
            </button>
          ) : (
            <p className={styles.note}>{MAX_OPTIONS} options is the most an item holds.</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The shop's items, in the order customers see them. Dragging reorders, and so
 * do the up/down buttons, which is how the keyboard reaches it. Text fields
 * are saved with an explicit Save (a half-typed option list must not be sent);
 * Available, order, removal and pictures take effect at once.
 */
export function ItemsEditor({ items: initial, uploadsEnabled, api }: { items: EditorItem[]; uploadsEnabled: boolean; api: ItemsApi }) {
  const [items, setItems] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Always the latest list, for async work that resolves after later renders
  // have moved on: a stale closure here could bring a removed row back.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const setList = (next: EditorItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  /** Merge a change into one row, unless that row is already gone. */
  function patchLocal(id: string, change: Partial<EditorItem>) {
    if (!itemsRef.current.some((item) => item.id === id)) return;
    setList(itemsRef.current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  /** An API row's own fields, kept apart from the picture URL it does not carry. */
  const fromRow = (row: ItemRow): Partial<EditorItem> => ({
    name: row.name,
    description: row.description,
    photoKey: row.photoKey,
    available: row.available,
    priceCents: row.priceCents,
    options: row.options,
  });

  async function move(next: EditorItem[]) {
    const before = itemsRef.current;
    setList(next);
    setError('');
    try {
      await api.reorder(next.map((item) => item.id));
    } catch (failure) {
      setList(before);
      setError(message(failure));
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const list = itemsRef.current;
    const from = list.findIndex((i) => i.id === event.active.id);
    const to = list.findIndex((i) => i.id === event.over?.id);
    void move(arrayMove(list, from, to));
  }

  async function remove(id: string) {
    setError('');
    const before = itemsRef.current;
    setList(before.filter((item) => item.id !== id));
    try {
      await api.remove(id);
    } catch (failure) {
      setList(before);
      setError(message(failure));
    }
  }

  async function setAvailable(id: string, available: boolean) {
    setError('');
    const was = itemsRef.current.find((item) => item.id === id)?.available ?? true;
    patchLocal(id, { available });
    try {
      const row = await api.update(id, { available });
      patchLocal(id, { available: row.available });
    } catch (failure) {
      patchLocal(id, { available: was });
      setError(message(failure));
    }
  }

  return (
    <section className={panel.panel} aria-labelledby="items-title">
      <h2 id="items-title" className={panel.panelTitle}>Items</h2>
      {items.length === 0 && !adding ? (
        <EmptyState icon="pinned" title="No items yet — add the first thing you sell." compact />
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className={styles.items}>
            {items.map((item, index) => (
              <ItemRowView
                key={item.id}
                item={item}
                first={index === 0}
                last={index === items.length - 1}
                uploadsEnabled={uploadsEnabled}
                api={api}
                onMove={(delta) => void move(arrayMove(itemsRef.current, index, index + delta))}
                onAvailable={(available) => void setAvailable(item.id, available)}
                onRemove={() => void remove(item.id)}
                onPatch={(change) => patchLocal(item.id, change)}
                fromRow={fromRow}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {error ? <Callout tone="error">{error}</Callout> : null}

      {items.length >= MAX_ITEMS ? (
        <p className={styles.note}>{MAX_ITEMS} items is the most a shop holds. Remove one to add another.</p>
      ) : adding ? (
        <AddItem
          onCancel={() => setAdding(false)}
          onAdd={async (input) => {
            const row = await api.add(input);
            setList([...itemsRef.current, { ...fromRowFull(row), photoUrl: null }]);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>+ Add an item</button>
      )}
    </section>
  );
}

function fromRowFull(row: ItemRow): OwnerStore['items'][number] {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    photoKey: row.photoKey,
    available: row.available,
    priceCents: row.priceCents,
    options: row.options,
  };
}

function AddItem({ onAdd, onCancel }: { onAdd: (input: { name: string; description: string | null; pricing: Pricing }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<PricingDraft>(() => draftOf(null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    const checked = checkFields(name, description, draft);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    try {
      await onAdd(checked);
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
  }

  return (
    <div className={styles.addForm}>
      <Field id="new-item-name" label="Name" value={name} onChange={setName} autoComplete="off" />
      <Field id="new-item-description" label="Description" value={description} onChange={setDescription} multiline hint={`${[...description].length}/${ITEM_DESCRIPTION_MAX}`} />
      <PricingFields prefix="new-item" draft={draft} onChange={setDraft} />
      {error ? <Callout tone="error">{error}</Callout> : null}
      <div className={panel.buttons}>
        <Button type="button" busy={busy} onClick={() => void submit()}>Add</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function ItemRowView({
  item,
  first,
  last,
  uploadsEnabled,
  api,
  onMove,
  onAvailable,
  onRemove,
  onPatch,
  fromRow,
}: {
  item: EditorItem;
  first: boolean;
  last: boolean;
  uploadsEnabled: boolean;
  api: ItemsApi;
  onMove: (delta: 1 | -1) => void;
  onAvailable: (available: boolean) => void;
  onRemove: () => void;
  onPatch: (change: Partial<EditorItem>) => void;
  fromRow: (row: ItemRow) => Partial<EditorItem>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [draft, setDraft] = useState<PricingDraft>(() => draftOf(item));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming && !wasConfirming.current) keepButtonRef.current?.focus();
    else if (!confirming && wasConfirming.current) removeButtonRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  // Re-read from the authoritative row each time the editor opens, not on
  // every render: that would clobber a keystroke with a prop that lags it.
  function openEditor() {
    setName(item.name);
    setDescription(item.description ?? '');
    setDraft(draftOf(item));
    setError('');
    setSaved(false);
    setEditing(true);
  }

  async function save() {
    setError('');
    setSaved(false);
    const checked = checkFields(name, description, draft);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    try {
      const row = await api.update(item.id, checked);
      onPatch(fromRow(row));
      setSaved(true);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      const url = await api.uploadPhoto(item.id, file);
      setPictureFailed(false);
      onPatch({ photoUrl: url });
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function removePicture() {
    setError('');
    try {
      await api.removePhoto(item.id);
      onPatch({ photoUrl: null, photoKey: null });
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <li ref={setNodeRef} aria-label={item.name} className={styles.item} data-editing={editing} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div className={styles.itemHead}>
        <span className={styles.grip} {...attributes} {...listeners} aria-label={`Drag ${item.name}`}>
          <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
            <circle cx="2.5" cy="3" r="1.5" /><circle cx="7.5" cy="3" r="1.5" /><circle cx="2.5" cy="8" r="1.5" /><circle cx="7.5" cy="8" r="1.5" /><circle cx="2.5" cy="13" r="1.5" /><circle cx="7.5" cy="13" r="1.5" />
          </svg>
        </span>
        {item.photoUrl && !pictureFailed ? (
          <img src={item.photoUrl} alt="" className={styles.thumb} onError={() => setPictureFailed(true)} />
        ) : null}
        <span className={styles.itemText}>
          <strong>{item.name}</strong>
          <small>{priceLine(item)}</small>
          {item.available ? null : <small>Hidden from your shop</small>}
        </span>
        <label className={panel.check}>
          <input type="checkbox" role="switch" checked={item.available} aria-label={`Available: ${item.name}`} onChange={(event) => onAvailable(event.target.checked)} />
          Available
        </label>
        <span className={styles.tools}>
          {confirming ? (
            <span className={styles.confirm} role="group" aria-label="Confirm removal">
              <span>Remove {item.name}? It leaves your shop and the chat.</span>
              <button type="button" className={styles.confirmRemove} onClick={onRemove}>Yes, remove</button>
              <button type="button" ref={keepButtonRef} onClick={() => setConfirming(false)}>Keep</button>
            </span>
          ) : (
            <>
              <button type="button" ref={editButtonRef} onClick={() => (editing ? setEditing(false) : openEditor())} aria-expanded={editing} aria-label={`${editing ? 'Close' : 'Edit'} ${item.name}`}>
                {editing ? 'Done' : 'Edit'}
              </button>
              <button type="button" className={styles.iconButton} aria-label={`Move ${item.name} up`} title="Move up" disabled={first} onClick={() => onMove(-1)}><Icon d={UP} /></button>
              <button type="button" className={styles.iconButton} aria-label={`Move ${item.name} down`} title="Move down" disabled={last} onClick={() => onMove(1)}><Icon d={DOWN} /></button>
              <button type="button" ref={removeButtonRef} className={`${styles.iconButton} ${styles.removeButton}`} aria-label={`Remove ${item.name}`} title="Remove" onClick={() => setConfirming(true)}><Icon d={BIN} /></button>
            </>
          )}
        </span>
      </div>

      {editing ? (
        <div className={styles.editForm}>
          <div className={styles.qrRow}>
            {item.photoUrl && !pictureFailed ? <img src={item.photoUrl} alt={`Picture of ${item.name}`} className={styles.qr} /> : null}
            <div className={styles.qrActions}>
              {uploadsEnabled ? null : <p className={styles.note}>Pictures are switched off here.</p>}
              <label className={styles.upload} data-disabled={!uploadsEnabled}>
                <span aria-hidden="true">{item.photoUrl ? 'Change picture' : 'Add a picture'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={`Upload a picture for ${item.name}`}
                  disabled={!uploadsEnabled}
                  className={styles.visuallyHidden}
                  onChange={(event) => void upload(event)}
                />
              </label>
              {item.photoUrl ? <Button variant="secondary" onClick={() => void removePicture()}>Remove picture</Button> : null}
            </div>
          </div>
          <Field id={`${item.id}-name`} label="Name" value={name} onChange={setName} autoComplete="off" />
          <Field id={`${item.id}-description`} label="Description" value={description} onChange={setDescription} multiline hint={`${[...description].length}/${ITEM_DESCRIPTION_MAX}`} />
          <PricingFields prefix={item.id} draft={draft} onChange={setDraft} />
          {error ? <Callout tone="error">{error}</Callout> : null}
          {saved && !error ? <Callout tone="info">Saved.</Callout> : null}
          <div className={panel.buttons}>
            <Button type="button" busy={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      ) : error ? (
        <Callout tone="error">{error}</Callout>
      ) : null}
    </li>
  );
}
