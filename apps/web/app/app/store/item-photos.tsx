'use client';

import { fullFrame } from '@curios/core/item-photos';
import { useEffect, useRef, useState } from 'react';
import { prepareOriginal } from '../curios/resize-image.js';
import ui from '../_ui/editor.module.css';
import { PhotoCropper } from './photo-cropper.js';
import styles from './store.module.css';
import type { EditorItem, Frame, ItemsApi, OwnerPhoto, PhotosResult } from './store-types.js';

const MAX_PHOTOS = 8;
/** How far a press travels before it is a drag and not a tap. */
const DRAG_PX = 6;

/** What the crop window is open on: a photo to add, a saved one to adjust, or a new file for a saved one. */
type Session =
  | { kind: 'add'; url: string; blob: Blob; width: number; height: number }
  | { kind: 'edit'; photo: OwnerPhoto }
  | { kind: 'replace'; photo: OwnerPhoto; url: string; blob: Blob; width: number; height: number };

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

/**
 * An item's photos in its editor: the cover large, the rest as small squares beneath, a dashed
 * "+" while there is room. Each photo is a tap from its crop window; they reorder by dragging
 * one onto another, or with Alt and the left or right arrow on a focused photo.
 */
export function ItemPhotos({
  item,
  tint,
  initial = '?',
  uploadsEnabled,
  api,
  onChange,
  onError,
}: {
  item: EditorItem | null;
  tint: number;
  /** The letter the empty cover shows. */
  initial?: string;
  uploadsEnabled: boolean;
  api: ItemsApi;
  onChange: (result: PhotosResult) => void;
  onError: (message: string) => void;
}) {
  const [session, setSession] = useState<(Session & { n: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [coverFailed, setCoverFailed] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const opened = useRef(0);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const refocus = useRef<string | null>(null);
  // Window listeners and awaited calls read this, not the render they were made in.
  const live = useRef({ item, busy, api, onChange, onError });
  live.current = { item, busy, api, onChange, onError };

  const photos = item?.photos ?? [];
  const legacy = photos.length === 0 && Boolean(item?.photoUrl) && !coverFailed;
  const disabled = !uploadsEnabled || !item;
  const title = !uploadsEnabled ? 'Pictures are switched off here' : item ? undefined : 'Give it a name and a price first';

  // The object URL of a photo not sent yet lives only as long as its crop window.
  const objectUrl = session && session.kind !== 'edit' ? session.url : null;
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  // After a move the photo may sit in a different square: put the focus back on it.
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    root.current?.querySelector<HTMLElement>(`[data-photo-id="${id}"]`)?.focus();
  }, [item?.photos]);

  async function run(job: () => Promise<PhotosResult>) {
    setBusy(true);
    onError('');
    try {
      const result = await job();
      setCoverFailed(false);
      setSession(null);
      onChange(result);
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function prepare(picked: File): Promise<{ url: string; blob: Blob; width: number; height: number } | null> {
    onError('');
    try {
      const { blob, width, height } = await prepareOriginal(picked);
      return { url: URL.createObjectURL(blob), blob, width, height };
    } catch (failure) {
      onError(message(failure));
      return null;
    }
  }

  async function picked(chosen: File) {
    const ready = await prepare(chosen);
    if (ready) setSession({ kind: 'add', ...ready, n: ++opened.current });
  }

  async function replaceWith(chosen: File) {
    const current = session;
    if (!current || current.kind === 'add') return;
    const ready = await prepare(chosen);
    if (ready) setSession({ kind: 'replace', photo: current.photo, ...ready, n: ++opened.current });
  }

  function save(frame: Frame) {
    if (!item || !session) return;
    const id = item.id;
    // On an item with only a legacy picture the API makes the new photo take its place.
    if (session.kind === 'add') void run(() => api.addPhoto(id, session.blob, frame));
    else if (session.kind === 'replace') void run(() => api.replacePhoto(id, session.photo.id, session.blob, frame));
    else void run(() => api.recropPhoto(id, session.photo.id, frame));
  }

  async function move(photoId: string, to: number) {
    const { item: current, busy: working, api: calls, onChange: changed, onError: failed } = live.current;
    if (!current || working) return;
    const ids = current.photos.map((photo) => photo.id);
    const from = ids.indexOf(photoId);
    if (from < 0 || to < 0 || to >= ids.length || to === from) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setBusy(true);
    failed('');
    try {
      const result = await calls.reorderPhotos(current.id, ids);
      refocus.current = photoId;
      changed(result);
      setAnnounce(`Photo moved to position ${to + 1}`);
    } catch (failure) {
      failed(message(failure));
    } finally {
      setBusy(false);
    }
  }

  // A drag starts once the pointer has travelled a few pixels, and ends wherever it is let go.
  useEffect(() => {
    function track(event: PointerEvent) {
      const start = drag.current;
      if (start && !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_PX) start.moved = true;
    }
    function release(event: PointerEvent) {
      const start = drag.current;
      drag.current = null;
      if (!start?.moved) return;
      // The click that follows this release ends the drag; it is not a tap on a photo.
      dragged.current = true;
      setTimeout(() => {
        dragged.current = false;
      }, 0);
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-photo-id]');
      const target = over?.dataset.photoId;
      if (!target || target === start.id) return;
      void move(start.id, live.current.item?.photos.findIndex((photo) => photo.id === target) ?? -1);
    }
    function cancel() {
      drag.current = null;
    }
    window.addEventListener('pointermove', track);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  function handlers(photo: OwnerPhoto, index: number) {
    return {
      'data-photo-id': photo.id,
      onPointerDown: (event: React.PointerEvent) => {
        if (event.button !== 0 || !event.isPrimary) return;
        drag.current = { id: photo.id, x: event.clientX, y: event.clientY, moved: false };
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        void move(photo.id, index + (event.key === 'ArrowLeft' ? -1 : 1));
      },
      onClick: () => {
        if (dragged.current) return;
        setSession({ kind: 'edit', photo, n: ++opened.current });
      },
    };
  }

  const cover = photos[0];
  const hasCover = Boolean(cover || legacy);
  const coverLabel = cover ? 'Crop cover photo' : legacy ? 'Change picture' : 'Add a picture';
  const cropper = session
    ? session.kind === 'edit'
      ? { src: api.originalUrl(item?.id ?? '', session.photo.id), width: session.photo.width, height: session.photo.height, frame: session.photo.frame }
      : { src: session.url, width: session.width, height: session.height, frame: fullFrame(session.width, session.height) }
    : null;

  return (
    <div className={styles.photoCell} ref={root}>
      <button
        type="button"
        className={styles.photo}
        data-tint={tint % 4}
        aria-label={coverLabel}
        title={title}
        disabled={disabled}
        {...(cover ? handlers(cover, 0) : { onClick: () => file.current?.click() })}
      >
        {hasCover ? <img src={item?.photoUrl ?? ''} alt="" draggable={false} onError={() => setCoverFailed(true)} /> : initial}
        {cover ? (
          <>
            <span className={styles.coverBadge} aria-hidden="true">Cover</span>
            <span className={styles.cropBadge} aria-hidden="true">Crop</span>
          </>
        ) : (
          <span className={styles.photoHint} aria-hidden="true">{coverLabel}</span>
        )}
      </button>

      {cover ? (
        <div className={styles.photoRow}>
          {photos.slice(1).map((photo, offset) => (
            <button
              key={photo.id}
              type="button"
              className={styles.smallPhoto}
              aria-label={`Crop photo ${offset + 2}`}
              title={title}
              disabled={disabled}
              {...handlers(photo, offset + 1)}
            >
              <img src={api.photoUrl(photo.squareKey)} alt="" draggable={false} />
            </button>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <button type="button" className={styles.addPhoto} aria-label="Add a photo" title={title} disabled={disabled} onClick={() => file.current?.click()}>
              +
            </button>
          ) : null}
        </div>
      ) : null}
      {cover ? (
        <span className={styles.photoCount}>
          {photos.length} of {MAX_PHOTOS}
        </span>
      ) : null}

      <span className={ui.srOnly} role="status" aria-live="polite">
        {announce}
      </span>

      {uploadsEnabled ? (
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-label="Picture file"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) void picked(chosen);
          }}
        />
      ) : null}

      {session && cropper ? (
        <PhotoCropper
          key={session.n}
          {...cropper}
          busy={busy}
          onSave={save}
          onCancel={() => setSession(null)}
          onRemove={session.kind === 'add' || !item ? undefined : () => void run(() => api.removePhoto(item.id, session.photo.id))}
          onReplace={session.kind === 'add' ? undefined : (chosen) => void replaceWith(chosen)}
        />
      ) : null}
    </div>
  );
}
