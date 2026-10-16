'use client';

import { useEffect, useRef, useState } from 'react';
import { Callout } from '@curios/ui';
import { LABEL_MAX, MAX_LINKS, normalizeLinkUrl, withShopTile, type ShopTilePlacement, type TileSize } from '@curios/core/bento';
import { useAutosave } from '../_ui/use-autosave.js';
import { SaveState } from '../_ui/save-state.js';
import { SectionHead } from '../_ui/section-head.js';
import ui from '../_ui/editor.module.css';
import styles from './curios.module.css';

export type LinkItem = { id: string; label: string; url: string; size: TileSize | null };

type Kind = 'whatsapp' | 'instagram' | 'email' | 'web';

/** What a link is, read off its address, for the row's icon. */
export function linkKind(url: string): Kind {
  // The host must end where the address's path does: instagram.com.evil.example is not Instagram.
  if (/^(https?:\/\/)?(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)([/?#]|$)|^tel:/i.test(url)) return 'whatsapp';
  if (/^(https?:\/\/)?(www\.)?instagram\.com([/?#]|$)/i.test(url)) return 'instagram';
  if (/^mailto:/i.test(url)) return 'email';
  return 'web';
}

const KIND_ICON: Record<Kind, string> = {
  whatsapp: 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17.5 6.5h.01',
  email: 'M3 5h18v14H3zM3 7l9 6 9-6',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
};

/** An address as the row shows it: without the scheme nobody reads. */
const shown = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/^mailto:/i, '').replace(/\/$/, '');

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
      <path d={d} />
    </svg>
  );
}

const UP = 'M6 15l6-6 6 6';
const DOWN = 'M6 9l6 6 6-6';
const BIN = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';
const CLOSE = 'M6 6l12 12M18 6L6 18';

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
 * The owner's links, top to bottom as visitors see them. The up and down
 * buttons reorder; a row's name opens it to edit in place. Every change is
 * sent at once -- there is no Save button in My Curios.
 *
 * The shop tile still has a stored place among the links (the API wants it
 * in every new order while the shop is open), but it is a tab now, not a
 * row, so it travels along unseen.
 */
export function LinksEditor({
  links,
  onChange,
  addLink,
  updateLink,
  removeLink,
  reorder,
  shop = null,
}: {
  links: LinkItem[];
  onChange: (links: LinkItem[]) => void;
  addLink: (input: { label: string; url: string }) => Promise<LinkItem>;
  updateLink: (id: string, patch: Partial<{ label: string; url: string }>) => Promise<LinkItem>;
  removeLink: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  /** Where the shop tile is stored among the links, or null when the shop is closed. */
  shop?: ShopTilePlacement | null;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // Always the latest `links`, for use inside a `persist` call that resolves
  // after later renders have already moved on -- a stale closure over `links`
  // here is exactly how a removed row's save could get reconciled back in.
  const linksRef = useRef(links);
  linksRef.current = links;

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  // Put back as it was if the server refuses the new order.
  async function move(from: number, to: number) {
    const before = links;
    const next = [...links];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
    setError('');
    try {
      await reorder(withShopTile(next, shop).map((entry) => entry.id));
    } catch (failure) {
      onChange(before);
      setError(message(failure));
    }
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
      onChange([...linksRef.current, link]);
      setLabel('');
      setUrl('');
      setAdding(false);
    } catch (failure) {
      setError(message(failure));
    }
  }

  // The preview must update from local state on every keystroke, before any
  // save returns: `onChange` here is immediate and synchronous, `persist`
  // below is the debounced write that follows separately.
  function applyLocal(id: string, change: Partial<{ label: string; url: string }>) {
    onChange(linksRef.current.map((link) => (link.id === id ? { ...link, ...change } : link)));
  }

  // No section-level error here on purpose: a label or URL save's failure is
  // shown by that field's own SaveState (LinkRow below), which is also where
  // its Retry lives. This only ever throws or reconciles.
  async function persist(id: string, change: Partial<{ label: string; url: string }>) {
    try {
      const saved = await updateLink(id, change);
      // The row may have been removed while this was in flight. Reconciling
      // it back into the list would resurrect a link the owner just deleted.
      // And only the keys this call actually sent: a URL save that lands
      // while a label save is still pending must not overwrite that label
      // with the stale copy this response carries for it.
      if (!linksRef.current.some((link) => link.id === id)) return;
      onChange(linksRef.current.map((link) => (link.id === id ? { ...link, ...pick(saved, Object.keys(change) as (keyof LinkItem)[]) } : link)));
    } catch (failure) {
      // Same guard on failure: a link that is already gone has no row left
      // to show a save state.
      if (!linksRef.current.some((link) => link.id === id)) return;
      throw failure;
    }
  }

  async function remove(id: string) {
    setError('');
    // Optimistic: the row disappears immediately, which is what actually
    // cancels that row's pending debounced save (LinkRow unmounts, and
    // useAutosave's own cleanup clears its timer).
    const before = links;
    onChange(links.filter((link) => link.id !== id));
    try {
      await removeLink(id);
    } catch (failure) {
      onChange(before);
      setError(message(failure));
    }
  }

  const full = links.length >= MAX_LINKS;

  return (
    <section className={ui.section} aria-labelledby="links-title">
      <SectionHead id="links-title" icon="link" tone="amber" title="Links" note="Top to bottom, as they appear" />

      {links.length === 0 && !adding ? (
        <div className={ui.empty}>
          <div className={ui.emptyArt} aria-hidden="true">
            <span className={ui.ghostRows}>
              <span data-tone="biru"><i /><b /><em /></span>
              <span data-tone="rose"><i /><b /><em /></span>
              <span data-tone="hijau"><i /><b /><em /></span>
            </span>
            <span className={ui.emptyBadge}>
              <svg viewBox="0 0 24 24" width="21" height="21">
                <path d={'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'} />
              </svg>
            </span>
          </div>
          <h3>Add your first link</h3>
          <p>Your shop, your WhatsApp, a portfolio. They sit under your name, and the chat can point people to them too.</p>
          <button type="button" className={ui.primaryButton} onClick={() => setAdding(true)}>
            + Add a link
          </button>
        </div>
      ) : null}

      {links.length > 0 ? (
        <ul className={styles.linkList}>
          {links.map((link, index) => (
            <LinkRow
              key={link.id}
              link={link}
              first={index === 0}
              last={index === links.length - 1}
              onMove={(delta) => void move(index, index + delta)}
              onLiveChange={(change) => applyLocal(link.id, change)}
              onPersist={(change) => persist(link.id, change)}
              onRemove={() => void remove(link.id)}
            />
          ))}
        </ul>
      ) : null}

      {error ? <Callout tone="error">{error}</Callout> : null}

      {adding ? (
        <form
          className={styles.addForm}
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input ref={nameRef} className={ui.input} aria-label="Name" placeholder="Name" value={label} onChange={(event) => setLabel(event.target.value)} />
          <input className={ui.input} aria-label="Address" placeholder="https://" autoComplete="off" value={url} onChange={(event) => setUrl(event.target.value)} />
          <span className={styles.addActions}>
            <button type="submit" className={ui.primaryButton}>
              Add
            </button>
            <button type="button" className={ui.iconButton} aria-label="Cancel" onClick={() => setAdding(false)}>
              <Icon d={CLOSE} />
            </button>
          </span>
        </form>
      ) : full ? (
        <p className={ui.note}>
          {MAX_LINKS} links is the most a page holds. Remove one to add another.
        </p>
      ) : links.length > 0 ? (
        <button type="button" className={ui.addRow} onClick={() => setAdding(true)}>
          + Add link
        </button>
      ) : null}
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
  onLiveChange: (change: Partial<{ label: string; url: string }>) => void;
  /** The debounced write, as a promise the field's SaveState can see fail. */
  onPersist: (change: Partial<{ label: string; url: string }>) => Promise<void>;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const labelSave = useAutosave((value: string) => onPersist({ label: value }));
  const urlSave = useAutosave((value: string) => onPersist({ url: value }));
  const kind = linkKind(link.url);

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const wasConfirming = useRef(false);

  // Focus follows the UI it opens and closes: into the editor's first field
  // (or the confirm's "Keep") when it appears, and back to the button that
  // opened it once it is gone -- never dropped to the body.
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

  // Re-read from the (possibly since-normalised) prop every time the editor
  // opens, not on every render: that would clobber a keystroke mid-edit.
  function openEditor() {
    setLabel(link.label);
    setUrl(link.url);
    setEditing(true);
  }

  if (editing) {
    return (
      <li aria-label={link.label} className={styles.linkRow} data-editing>
        <div className={styles.editForm}>
          <span>
            <input
              id={`label-${link.id}`}
              className={ui.input}
              aria-label="Name"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                onLiveChange({ label: event.target.value });
                labelSave.schedule(event.target.value);
              }}
            />
            <SaveState status={labelSave.status} error={labelSave.error} retry={labelSave.retry} />
          </span>
          <span>
            <input
              id={`url-${link.id}`}
              className={ui.input}
              aria-label="Address"
              autoComplete="off"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                onLiveChange({ url: event.target.value });
                urlSave.schedule(event.target.value);
              }}
            />
            <SaveState status={urlSave.status} error={urlSave.error} retry={urlSave.retry} />
          </span>
          <button type="button" className={ui.primaryButton} onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      </li>
    );
  }

  return (
    <li aria-label={link.label} className={styles.linkRow}>
      <span className={styles.kind} data-kind={kind} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d={KIND_ICON[kind]} />
        </svg>
      </span>
      <button type="button" ref={editButtonRef} className={styles.linkText} aria-label={`Edit ${link.label}`} onClick={openEditor}>
        <b>{link.label}</b>
        <span>{shown(link.url)}</span>
      </button>
      {confirming ? (
        <span className={ui.confirm}>
          Remove?
          <button type="button" className={ui.confirmRemove} onClick={onRemove}>
            Yes, remove
          </button>
          <button type="button" ref={keepButtonRef} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <span className={styles.tools}>
          <button type="button" className={ui.iconButton} aria-label={`Move ${link.label} up`} title="Move up" disabled={first} onClick={() => onMove(-1)}>
            <Icon d={UP} />
          </button>
          <button type="button" className={ui.iconButton} aria-label={`Move ${link.label} down`} title="Move down" disabled={last} onClick={() => onMove(1)}>
            <Icon d={DOWN} />
          </button>
          <button type="button" ref={removeButtonRef} className={ui.iconButton} aria-label={`Remove ${link.label}`} title="Remove" onClick={() => setConfirming(true)}>
            <Icon d={BIN} />
          </button>
        </span>
      )}
    </li>
  );
}
