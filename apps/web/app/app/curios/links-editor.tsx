'use client';

import { useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Callout, Field } from '@curios/ui';
import { LABEL_MAX, MAX_LINKS, normalizeLinkUrl, type TileSize } from '@curios/core/bento';
import { useAutosave } from './use-autosave.js';
import { SaveState } from './profile-editor.js';
import styles from './curios.module.css';
import { EmptyState } from '../_ui/empty-state.js';

export type LinkItem = { id: string; label: string; url: string; size: TileSize | null };

/** Each size drawn as the tile's own shape, so nobody has to decode S, W, T and B. */
const SIZE_BUTTONS: { size: TileSize | null; shape: { x: number; y: number; w: number; h: number } | null; name: string }[] = [
  { size: null, shape: null, name: 'Automatic size' },
  { size: 'SMALL', shape: { x: 4, y: 4, w: 8, h: 8 }, name: 'Small tile' },
  { size: 'WIDE', shape: { x: 1, y: 4, w: 14, h: 8 }, name: 'Wide tile' },
  { size: 'TALL', shape: { x: 4, y: 1, w: 8, h: 14 }, name: 'Tall tile' },
  { size: 'BIG', shape: { x: 1, y: 1, w: 14, h: 14 }, name: 'Big tile' },
];

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

const message = (failure: unknown) => (failure instanceof Error ? failure.message : 'That did not save. Try again.');

/** Only the keys actually sent, read off the server's copy of the row -- a
 * concurrent save for a different field on the same row must not be
 * clobbered by this one's stale copy of it. */
function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}

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

  // No section-level error here on purpose: a label, URL or size save's
  // failure is shown by that field's own SaveState (LinkRow below), which is
  // also where its Retry lives. This only ever throws or reconciles.
  async function persist(id: string, change: Partial<Omit<LinkItem, 'id'>>) {
    try {
      const saved = await updateLink(id, change);
      // The row may have been removed while this was in flight. Reconciling
      // it back into the list would resurrect a link the owner just deleted.
      // And only the keys this call actually sent: a size save that lands
      // while a label save is still pending must not overwrite that label
      // with the stale copy this response carries for it.
      if (!linksRef.current.some((link) => link.id === id)) return;
      onChange(linksRef.current.map((link) => (link.id === id ? { ...link, ...pick(saved, Object.keys(change) as (keyof LinkItem)[]) } : link)));
    } catch (failure) {
      // Same guard on failure: a link that is already gone has no row left
      // to show a save state, and rethrowing into its stale closure would
      // only update a component that already unmounted.
      if (!linksRef.current.some((link) => link.id === id)) return;
      throw failure;
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
      {links.length === 0 && !adding ? (
        <EmptyState icon="links" title="No links yet" compact>
          Add your first link: your shop, WhatsApp, portfolio, anything.
        </EmptyState>
      ) : null}

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
                onPersist={(change) => persist(link.id, change)}
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
  /** The actual write -- debounced for text, immediate for a size click -- and
   * now a promise the caller can reject, so useAutosave (and the size
   * group's own save state below) can see the failure and offer Retry. */
  onPersist: (change: Partial<Omit<LinkItem, 'id'>>) => Promise<void>;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: link.id });
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const labelSave = useAutosave((value: string) => onPersist({ label: value }));
  const urlSave = useAutosave((value: string) => onPersist({ url: value }));

  // A tile size saves at once, no debounce -- but it still needs its own
  // save state and Retry, the same as the label and address fields, so a
  // failed size click is not silently reverted nor left unreported.
  const [sizeStatus, setSizeStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sizeError, setSizeError] = useState<unknown>(null);

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const wasConfirming = useRef(false);

  // Focus follows the UI it opens and closes: into the editor's first field
  // (or the confirm's "Keep") when it appears, and back to the button that
  // triggered it once it is gone -- never left on a control that just
  // disappeared, and never dropped to the body.
  useEffect(() => {
    if (editing && !wasEditing.current) document.getElementById(`label-${link.id}`)?.focus();
    else if (!editing && wasEditing.current) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing, link.id]);

  useEffect(() => {
    if (confirming && !wasConfirming.current) keepButtonRef.current?.focus();
    else if (!confirming && wasConfirming.current) removeButtonRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  // Re-read from the (possibly since-normalised) authoritative prop every
  // time the editor opens, rather than only once on mount. Not on every
  // render: that would clobber a keystroke mid-edit with a prop that has not
  // caught up yet.
  function openEditor() {
    setLabel(link.label);
    setUrl(link.url);
    setEditing(true);
  }

  function persistSize(size: TileSize | null) {
    setSizeStatus('saving');
    onPersist({ size })
      .then(() => { setSizeStatus('saved'); setSizeError(null); })
      .catch((failure: unknown) => { setSizeStatus('error'); setSizeError(failure); });
  }

  function chooseSize(size: TileSize | null) {
    onLiveChange({ size });
    persistSize(size);
  }

  return (
    <li
      ref={setNodeRef}
      aria-label={link.label}
      className={styles.link}
      data-editing={editing}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className={styles.grip} {...attributes} {...listeners} aria-label={`Drag ${link.label}`}>
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
          <circle cx="2.5" cy="3" r="1.5" /><circle cx="7.5" cy="3" r="1.5" /><circle cx="2.5" cy="8" r="1.5" /><circle cx="7.5" cy="8" r="1.5" /><circle cx="2.5" cy="13" r="1.5" /><circle cx="7.5" cy="13" r="1.5" />
        </svg>
      </span>
      {editing ? (
        <span className={styles.editForm}>
          <Field
            id={`label-${link.id}`}
            label="Name"
            value={label}
            onChange={(value) => { setLabel(value); onLiveChange({ label: value }); labelSave.schedule(value); }}
          />
          <SaveState status={labelSave.status} error={labelSave.error} retry={labelSave.retry} />
          <Field
            id={`url-${link.id}`}
            label="Address"
            value={url}
            autoComplete="off"
            onChange={(value) => { setUrl(value); onLiveChange({ url: value }); urlSave.schedule(value); }}
          />
          <SaveState status={urlSave.status} error={urlSave.error} retry={urlSave.retry} />
        </span>
      ) : (
        <button type="button" ref={editButtonRef} className={styles.linkText} aria-label={`Edit ${link.label}`} onClick={openEditor}>
          {link.label}
          <small>{link.url}</small>
        </button>
      )}
      <span className={styles.sizeGroup}>
        <span className={styles.sizes} role="group" aria-label="Tile size">
          {SIZE_BUTTONS.map((button) => (
            <button
              key={button.name}
              type="button"
              aria-label={button.name}
              title={button.name}
              aria-pressed={link.size === button.size}
              onClick={() => chooseSize(button.size)}
            >
              {button.shape ? (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <rect x={button.shape.x} y={button.shape.y} width={button.shape.w} height={button.shape.h} rx="2" />
                </svg>
              ) : (
                'Auto'
              )}
            </button>
          ))}
        </span>
        <SaveState status={sizeStatus} error={sizeError} retry={() => persistSize(link.size)} />
      </span>
      <span className={styles.tools}>
        {confirming ? (
          <span className={styles.confirm}>
            <button type="button" className={styles.confirmRemove} onClick={onRemove}>Yes, remove</button>
            <button type="button" ref={keepButtonRef} onClick={() => setConfirming(false)}>Keep</button>
          </span>
        ) : (
          <>
            <button type="button" className={styles.iconButton} aria-label={`Move ${link.label} up`} title="Move up" disabled={first} onClick={() => onMove(-1)}><Icon d={UP} /></button>
            <button type="button" className={styles.iconButton} aria-label={`Move ${link.label} down`} title="Move down" disabled={last} onClick={() => onMove(1)}><Icon d={DOWN} /></button>
            <button type="button" ref={removeButtonRef} className={`${styles.iconButton} ${styles.removeButton}`} aria-label={`Remove ${link.label}`} title="Remove" onClick={() => setConfirming(true)}><Icon d={BIN} /></button>
          </>
        )}
      </span>
      {editing ? <button type="button" className={styles.doneButton} onClick={() => setEditing(false)}>Done</button> : null}
    </li>
  );
}
