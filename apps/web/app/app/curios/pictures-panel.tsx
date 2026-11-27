'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Callout } from '@curios/ui';
import { LABEL_MAX } from '@curios/core/bento';
import { ALT_TEXT_MAX, WIDGET_PICTURE_MAX_BYTES, picturesAllowed, type PictureMode, type PictureProvider } from '@curios/core/widgets';
import ui from '../_ui/editor.module.css';
import { effectiveMode } from './link-icons.js';
import type { LinkItem } from './links-editor.js';
import styles from './pictures-panel.module.css';

/** What the panel needs of the API: each call answers with the whole widget row, as the server does. */
export interface PicturesApi {
  create: (input: { provider: PictureProvider; mode: PictureMode; label: string | null; altText: string | null }) => Promise<LinkItem>;
  /** One picture as the raw body; `onProgress` gets 0 to 1. */
  add: (id: string, file: File, onProgress: (done: number) => void) => Promise<LinkItem>;
  remove: (id: string, pictureId: string) => Promise<LinkItem>;
  reorder: (id: string, ids: string[]) => Promise<LinkItem>;
  /** A stored key as an address to show, or null when storage is not set up. */
  url: (key: string) => string | null;
}

const STILL_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MB = WIDGET_PICTURE_MAX_BYTES / 1024 / 1024;

const message = (failure: unknown) =>
  (failure as { status?: number } | null)?.status === 429
    ? 'Too many uploads at once. Wait a minute and try again.'
    : failure instanceof Error
      ? failure.message
      : 'That did not work. Try again.';

type Sending = { id: number; name: string; done: number };

/**
 * The Pictures and GIF panel (board "wup"): the pictures with their order, the way to show them,
 * a caption and a description for screen readers. The widget row is made when the first file is
 * chosen, so cancelling an empty panel leaves nothing behind; pictures are sent, removed and
 * reordered at once, and Save sends the rest (mode, caption, description).
 */
export function PicturesPanel({
  provider,
  link: initial,
  api,
  updateLink,
  onLink,
  onDiscard,
  onClose,
}: {
  provider: PictureProvider;
  /** The widget being edited; null for a new one (made when the first file arrives). */
  link: LinkItem | null;
  api: PicturesApi;
  updateLink: (id: string, patch: Partial<{ label: string; pictureMode: PictureMode; altText: string | null }>) => Promise<LinkItem>;
  /** Every answer that changes the row, so the list and the preview follow. */
  onLink: (link: LinkItem) => void;
  /** Closed with the widget made but no picture in it: it is not shown on the page, so it is removed. */
  onDiscard: (id: string) => void;
  onClose: () => void;
}) {
  const isGif = provider === 'GIF';
  const max = picturesAllowed(provider);
  const [link, setLinkState] = useState<LinkItem | null>(initial);
  // The latest row, for a queue of uploads that outlives the render it started in.
  const linkRef = useRef<LinkItem | null>(initial);
  const creating = useRef<Promise<LinkItem> | null>(null);
  const [caption, setCaption] = useState(initial?.label ?? '');
  const [alt, setAlt] = useState(initial?.altText ?? '');
  const [mode, setMode] = useState<PictureMode>(initial?.pictureMode ?? (isGif ? 'FULL' : 'CAROUSEL'));
  const [sending, setSending] = useState<Sending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const nextId = useRef(0);
  // Files accepted and not yet answered, current between renders (two quick picks share the room).
  const inFlight = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const head = useRef<HTMLDivElement>(null);

  useEffect(() => head.current?.focus(), []);

  function setLink(next: LinkItem) {
    linkRef.current = next;
    setLinkState(next);
    onLink(next);
  }

  const pictures = link?.pictures ?? [];
  const count = pictures.length;
  const shownMode = effectiveMode(provider, count, mode);
  const busy = sending.length > 0;

  /** The widget row, made on the first call (once, however many files are queued behind it). */
  async function ensure(): Promise<LinkItem> {
    if (linkRef.current) return linkRef.current;
    creating.current ??= api.create({ provider, mode, label: caption.trim() === '' ? null : caption.trim(), altText: alt.trim() === '' ? null : alt.trim() });
    try {
      const made = await creating.current;
      if (!linkRef.current) setLink(made);
      return linkRef.current!;
    } catch (failure) {
      creating.current = null;
      throw failure;
    }
  }

  async function addFiles(files: File[]) {
    const problems: string[] = [];
    const room = max - (linkRef.current?.pictures.length ?? 0) - inFlight.current;
    const accepted: File[] = [];
    for (const file of files) {
      if (isGif ? file.type !== 'image/gif' : !STILL_TYPES.includes(file.type)) {
        problems.push(isGif ? `${file.name} is not a GIF. Choose a GIF, up to ${MB} MB.` : `${file.name} is not a JPEG, PNG or WebP picture. For a GIF, add a GIF widget.`);
      } else if (file.size > WIDGET_PICTURE_MAX_BYTES) {
        problems.push(`${file.name} is over ${MB} MB. Choose a smaller one.`);
      } else if (accepted.length >= room) {
        problems.push(isGif ? 'A GIF widget holds one GIF. Remove it to add another.' : `A gallery holds up to ${max} pictures. ${file.name} was left out.`);
      } else {
        accepted.push(file);
      }
    }
    setErrors(problems);
    if (accepted.length === 0) return;

    inFlight.current += accepted.length;
    const queued = accepted.map((file) => ({ file, id: nextId.current++ }));
    setSending((current) => [...current, ...queued.map(({ file, id }) => ({ id, name: file.name, done: 0 }))]);
    const failed: string[] = [];
    for (const { file, id } of queued) {
      try {
        const row = await ensure();
        const saved = await api.add(row.id, file, (done) => setSending((current) => current.map((entry) => (entry.id === id ? { ...entry, done } : entry))));
        setLink(saved);
      } catch (failure) {
        failed.push(`${file.name}: ${message(failure)}`);
      } finally {
        inFlight.current -= 1;
        setSending((current) => current.filter((entry) => entry.id !== id));
      }
    }
    if (failed.length > 0) setErrors((current) => [...current, ...failed]);
  }

  async function reorderTo(from: number, to: number) {
    const row = linkRef.current;
    if (!row || from === to || to < 0 || to >= row.pictures.length) return;
    const before = row;
    const next = [...row.pictures];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setLink({ ...row, pictures: next.map((picture, position) => ({ ...picture, position })) });
    setAnnounce(`Picture moved to place ${to + 1} of ${next.length}.`);
    try {
      setLink(await api.reorder(row.id, next.map((picture) => picture.id)));
    } catch (failure) {
      setLink(before);
      setErrors([message(failure)]);
    }
  }

  async function removeAt(index: number) {
    const row = linkRef.current;
    const picture = row?.pictures[index];
    if (!row || !picture) return;
    setErrors([]);
    try {
      setLink(await api.remove(row.id, picture.id));
      setAnnounce(`Picture ${index + 1} removed.`);
    } catch (failure) {
      setErrors([message(failure)]);
    }
  }

  async function save() {
    if (saving || busy) return;
    const row = linkRef.current;
    if (!row || row.pictures.length === 0) {
      setErrors([isGif ? 'Add a GIF first.' : 'Add a picture first.']);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const saved = await updateLink(row.id, { label: caption.trim(), pictureMode: effectiveMode(provider, row.pictures.length, mode), altText: alt.trim() === '' ? null : alt.trim() });
      setLink(saved);
      onClose();
    } catch (failure) {
      setErrors([message(failure)]);
    } finally {
      setSaving(false);
    }
  }

  const options: { id: PictureMode; name: string; hint: string; icon: string }[] =
    isGif || count <= 1
      ? [
          { id: 'FULL', name: 'Full width', hint: 'Keeps its own shape', icon: styles.icoFull! },
          { id: 'SQUARE', name: 'Square', hint: 'Cropped to a square', icon: styles.icoSquare! },
        ]
      : [
          { id: 'CAROUSEL', name: 'Carousel', hint: 'Swipe one by one', icon: styles.icoCarousel! },
          { id: 'GRID', name: 'Grid', hint: 'See them all at once', icon: styles.icoGrid! },
        ];

  function onSegKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const other = options.find((option) => option.id !== shownMode)!;
    setMode(other.id);
    document.getElementById(`mode-${other.id}`)?.focus();
  }

  /** Closing a widget that never got a picture removes it (best effort), so it cannot sit empty and count toward the limit. */
  function close() {
    const row = linkRef.current;
    if (row && row.pictures.length === 0) onDiscard(row.id);
    onClose();
  }

  const title = isGif ? 'GIF' : 'Pictures';
  const sub = isGif ? `Up to ${MB} MB, stays animated` : `${count} of ${max}${count > 1 ? ' · drag to reorder' : ''}`;

  return (
    <section
      className={styles.panel}
      aria-label={isGif ? 'GIF widget' : 'Pictures widget'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <div className={styles.head}>
        <div ref={head} tabIndex={-1}>
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={close}>
          ✕
        </button>
      </div>

      <ul className={styles.pics} aria-label={isGif ? 'The GIF' : 'Pictures, in order'}>
        {pictures.map((picture, index) => {
          const src = api.url(picture.key);
          return (
            <li
              key={picture.id}
              className={styles.pic}
              data-drop={over === index && dragFrom !== null && dragFrom !== index ? '' : undefined}
              onDragOver={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFrom !== null) void reorderTo(dragFrom, index);
                setDragFrom(null);
                setOver(null);
              }}
            >
              <span
                className={styles.frame}
                data-testid="picture"
                draggable={count > 1}
                onDragStart={(event) => {
                  setDragFrom(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', picture.id);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setOver(null);
                }}
              >
                {src ? <img src={src} width={picture.width} height={picture.height} alt="" draggable={false} /> : null}
                <em aria-hidden="true">{index + 1}</em>
              </span>
              <span className={styles.tools}>
                {count > 1 ? (
                  <>
                    <button type="button" className={styles.tool} aria-label={`Move picture ${index + 1} earlier`} disabled={index === 0} onClick={() => void reorderTo(index, index - 1)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M15 6l-6 6 6 6" />
                      </svg>
                    </button>
                    <button type="button" className={styles.tool} aria-label={`Move picture ${index + 1} later`} disabled={index === count - 1} onClick={() => void reorderTo(index, index + 1)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </button>
                  </>
                ) : null}
                <button type="button" className={styles.tool} aria-label={`Remove picture ${index + 1}`} onClick={() => void removeAt(index)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </span>
            </li>
          );
        })}
        {sending.map((entry) => (
          <li key={`s${entry.id}`} className={styles.pic}>
            <span className={styles.frame}>
              <span className={styles.sending} role="status">
                Sending {entry.name} {Math.round(entry.done * 100)}%
              </span>
            </span>
          </li>
        ))}
        {count + sending.length < max ? (
          <li className={styles.pic}>
            <button type="button" className={styles.add} onClick={() => input.current?.click()}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15V4M7 9l5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
              </svg>
              Add
            </button>
          </li>
        ) : null}
      </ul>
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        aria-label={isGif ? 'Choose a GIF' : 'Choose pictures'}
        accept={isGif ? 'image/gif' : STILL_TYPES.join(',')}
        multiple={!isGif}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          void addFiles(files);
        }}
      />
      <span className={ui.srOnly} role="status" aria-live="polite">
        {announce}
      </span>

      {errors.length > 0 ? (
        <div className={styles.errors}>
          {errors.map((error, index) => (
            <Callout key={index} tone="error">
              {error}
            </Callout>
          ))}
        </div>
      ) : null}

      <p className={styles.label} id="pic-show-as">
        Show as
      </p>
      <div className={styles.seg} role="radiogroup" aria-labelledby="pic-show-as">
        {options.map((option) => (
          <button
            key={option.id}
            id={`mode-${option.id}`}
            type="button"
            role="radio"
            aria-checked={shownMode === option.id}
            tabIndex={shownMode === option.id ? 0 : -1}
            onClick={() => setMode(option.id)}
            onKeyDown={onSegKey}
          >
            <span className={`${styles.ico} ${option.icon}`} aria-hidden="true">
              <i />
              <i />
              {option.id === 'GRID' ? <i /> : null}
            </span>
            {option.name}
            <small>{option.hint}</small>
          </button>
        ))}
      </div>

      <label className={styles.label} htmlFor="pic-caption" style={{ display: 'block' }}>
        Caption
      </label>
      <input id="pic-caption" className={ui.input} maxLength={LABEL_MAX} placeholder={title} value={caption} onChange={(event) => setCaption(event.target.value)} />
      <label className={styles.label} htmlFor="pic-alt" style={{ display: 'block' }}>
        Describe them for screen readers
      </label>
      <input
        id="pic-alt"
        className={ui.input}
        maxLength={ALT_TEXT_MAX}
        placeholder={isGif ? 'A cat knocking a glass off a table' : 'Chocolate cake, kek batik slices, a boxed cake'}
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
      />

      <div className={styles.foot}>
        <small>{isGif ? 'A GIF shows Full width or Square.' : 'One picture shows as Full width or Square instead.'}</small>
        <button type="button" className={ui.primaryButton} disabled={saving || busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </section>
  );
}
