'use client';

import { useRef, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Callout, Field } from '@curios/ui';
import { LABEL_MAX, MAX_LINKS, normalizeLinkUrl, type TileSize } from '@curios/core/bento';
import { useAutosave } from './use-autosave.js';
import { SaveState } from './profile-editor.js';
import styles from './curios.module.css';

export type LinkItem = { id: string; label: string; url: string; size: TileSize | null };

const SIZE_BUTTONS: { size: TileSize | null; short: string; name: string }[] = [
  { size: null, short: 'Auto', name: 'Automatic size' },
  { size: 'SMALL', short: 'S', name: 'Small tile' },
  { size: 'WIDE', short: 'W', name: 'Wide tile' },
  { size: 'TALL', short: 'T', name: 'Tall tile' },
  { size: 'BIG', short: 'B', name: 'Big tile' },
];

const message = (failure: unknown) => (failure instanceof Error ? failure.message : 'That did not save. Try again.');

/**
 * The owner's links, in the order visitors see them. Dragging reorders; so do
 * the up/down buttons, which is how the keyboard and a screen reader reach it
 * too. Every change is sent at once -- there is no Save button in My Curios.
 */
export function LinksEditor({
  links,
  onChange,
  addLink,
  updateLink,
  removeLink,
  reorder,
}: {
  links: LinkItem[];
  onChange: (links: LinkItem[]) => void;
  addLink: (input: { label: string; url: string }) => Promise<LinkItem>;
  updateLink: (id: string, patch: Partial<Omit<LinkItem, 'id'>>) => Promise<LinkItem>;
  removeLink: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Always the latest `links`, for use inside a `persist` call that resolves
  // after later renders have already moved on -- a stale closure over `links`
  // here is exactly how a removed row's save could get reconciled back in.
  const linksRef = useRef(links);
  linksRef.current = links;

  async function move(next: LinkItem[]) {
    const before = links;
    onChange(next);
    setError('');
    try {
      await reorder(next.map((link) => link.id));
    } catch (failure) {
      onChange(before);
      setError(message(failure));
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = links.findIndex((l) => l.id === event.active.id);
    const to = links.findIndex((l) => l.id === event.over?.id);
    void move(arrayMove(links, from, to));
  }

  async function add() {
    setError('');
    if (label.trim() === '' || [...label.trim()].length > LABEL_MAX) {
      setError(`Give the link a name, up to ${LABEL_MAX} characters.`);
      return;
    }
    if (!normalizeLinkUrl(url)) {
      setError('That link does not look right. Use a web address, an email (mailto:) or a phone number (tel:).');
      return;
    }
    try {
      const link = await addLink({ label, url });
      onChange([...links, link]);
      setLabel('');
      setUrl('');
      setAdding(false);
    } catch (failure) {
      setError(message(failure));
    }
  }

  // The preview must update from local state on every keystroke, before any
  // save returns -- the same split ProfileEditor uses: `onChange` here is
  // immediate and synchronous, `persist` below is the debounced (or, for a
  // size button, immediate-but-async) write that follows separately.
  function applyLocal(id: string, change: Partial<Omit<LinkItem, 'id'>>) {
    onChange(linksRef.current.map((link) => (link.id === id ? { ...link, ...change } : link)));
  }

  async function persist(id: string, change: Partial<Omit<LinkItem, 'id'>>) {
    setError('');
    try {
      const saved = await updateLink(id, change);
      // The row may have been removed while this was in flight. Reconciling
      // it back into the list would resurrect a link the owner just deleted.
      if (!linksRef.current.some((link) => link.id === id)) return;
      onChange(linksRef.current.map((link) => (link.id === id ? saved : link)));
    } catch (failure) {
      // Same guard on failure: a stray "did not save" for a link that is
      // already gone is not news to anyone.
      if (!linksRef.current.some((link) => link.id === id)) return;
      setError(message(failure));
    }
  }

  async function remove(id: string) {
    setError('');
    // Optimistic, like `move`: the row disappears immediately, which is what
    // actually cancels that row's pending debounced save (LinkRow unmounts,
    // and useAutosave's own cleanup clears its timer). Waiting for
    // `removeLink` to resolve first would leave a window where a save
    // scheduled moments earlier could still land after the removal.
    const before = links;
    onChange(links.filter((link) => link.id !== id));
    try {
      await removeLink(id);
    } catch (failure) {
      onChange(before);
      setError(message(failure));
    }
  }

  return (
    <section className={styles.section} aria-labelledby="links-title">
      <h2 id="links-title" className={styles.sectionTitle}>Links</h2>
      {links.length === 0 ? <p className={styles.empty}>Add your first link: your shop, WhatsApp, portfolio, anything.</p> : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={links.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ul className={styles.links}>
            {links.map((link, index) => (
              <LinkRow
                key={link.id}
                link={link}
                first={index === 0}
                last={index === links.length - 1}
                onMove={(delta) => void move(arrayMove(links, index, index + delta))}
                onLiveChange={(change) => applyLocal(link.id, change)}
                onPersist={(change) => void persist(link.id, change)}
                onRemove={() => void remove(link.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {error ? <Callout tone="error">{error}</Callout> : null}

      {links.length >= MAX_LINKS ? (
        <p className={styles.empty}>{MAX_LINKS} links is the most a page holds. Remove one to add another.</p>
      ) : adding ? (
        <div className={styles.addForm}>
          <Field id="new-label" label="Name" value={label} onChange={setLabel} />
          <Field id="new-url" label="Address" value={url} onChange={setUrl} autoComplete="off" hint="A web address, mailto:you@… or tel:+60…" />
          <Button type="button" onClick={() => void add()}>Add</Button>
          <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>+ Add a link</button>
      )}
    </section>
  );
}

function LinkRow({
  link,
  first,
  last,
  onMove,
  onLiveChange,
  onPersist,
  onRemove,
}: {
  link: LinkItem;
  first: boolean;
  last: boolean;
  onMove: (delta: 1 | -1) => void;
  /** Applied to `links` (and so the live preview) immediately, synchronously. */
  onLiveChange: (change: Partial<Omit<LinkItem, 'id'>>) => void;
  /** The actual write. Debounced for text, immediate for a size click. */
  onPersist: (change: Partial<Omit<LinkItem, 'id'>>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: link.id });
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const labelSave = useAutosave((value: string) => Promise.resolve(onPersist({ label: value })));
  const urlSave = useAutosave((value: string) => Promise.resolve(onPersist({ url: value })));

  // Re-read from the (possibly since-normalised) authoritative prop every
  // time the editor opens, rather than only once on mount. Not on every
  // render: that would clobber a keystroke mid-edit with a prop that has not
  // caught up yet.
  function openEditor() {
    setLabel(link.label);
    setUrl(link.url);
    setEditing(true);
  }

  function chooseSize(size: TileSize | null) {
    onLiveChange({ size });
    onPersist({ size });
  }

  return (
    <li
      ref={setNodeRef}
      aria-label={link.label}
      className={styles.link}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className={styles.grip} {...attributes} {...listeners} aria-label={`Drag ${link.label}`}>⋮⋮</span>
      {editing ? (
        <span className={styles.linkText}>
          <Field
            id={`label-${link.id}`}
            label="Name"
            value={label}
            onChange={(value) => { setLabel(value); onLiveChange({ label: value }); labelSave.schedule(value); }}
          />
          <SaveState status={labelSave.status} retry={labelSave.retry} />
          <Field
            id={`url-${link.id}`}
            label="Address"
            value={url}
            autoComplete="off"
            onChange={(value) => { setUrl(value); onLiveChange({ url: value }); urlSave.schedule(value); }}
          />
          <SaveState status={urlSave.status} retry={urlSave.retry} />
          <button type="button" onClick={() => setEditing(false)}>Done</button>
        </span>
      ) : (
        <button type="button" className={styles.linkText} aria-label={`Edit ${link.label}`} onClick={openEditor}>
          {link.label}
          <small>{link.url}</small>
        </button>
      )}
      <span className={styles.sizes} role="group" aria-label="Tile size">
        {SIZE_BUTTONS.map((button) => (
          <button
            key={button.name}
            type="button"
            aria-label={button.name}
            aria-pressed={link.size === button.size}
            onClick={() => chooseSize(button.size)}
          >
            {button.short}
          </button>
        ))}
      </span>
      <button type="button" className={styles.iconButton} aria-label={`Move ${link.label} up`} disabled={first} onClick={() => onMove(-1)}>↑</button>
      <button type="button" className={styles.iconButton} aria-label={`Move ${link.label} down`} disabled={last} onClick={() => onMove(1)}>↓</button>
      {confirming ? (
        <span className={styles.confirm}>
          <button type="button" onClick={onRemove}>Yes, remove</button>
          <button type="button" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <button type="button" className={styles.iconButton} aria-label={`Remove ${link.label}`} onClick={() => setConfirming(true)}>×</button>
      )}
    </li>
  );
}
