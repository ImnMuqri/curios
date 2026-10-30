'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Callout } from '@curios/ui';
import { ITEM_CATEGORY_MAX, ITEM_DESCRIPTION_MAX, ITEM_SKU_MAX, ITEM_TAG_MAX, ITEM_TAG_PRESETS, MAX_OPTIONS, priceLine } from '@curios/core/store';
import { SaveState } from '../_ui/save-state.js';
import { useAutosave } from '../_ui/use-autosave.js';
import ui from '../_ui/editor.module.css';
import { blankOption, checkFields, draftOf, pricedFields, type CheckedItem, type PricingDraft } from './pricing.js';
import { DigitalPanels, KindSwitch } from './digital-fields.js';
import { checkDigital, digitalDraftOf, type DigitalDraft } from './digital-draft.js';
import { PHYSICAL_ITEM, type Delivery, type DigitalFields, type EditorItem, type ItemRow, type ItemsApi } from './store-types.js';
import styles from './store.module.css';

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

const BIN = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';

/** The category select's last choice, which swaps it for a box to type a new one in. No category can be this. */
const NEW_CATEGORY = '\u0000new';

/** An API row as the screen holds it, keeping the picture URL the row does not carry. */
export function fromRow(row: ItemRow, photoUrl: string | null): EditorItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    tag: row.tag,
    sku: row.sku,
    photoKey: row.photoKey,
    available: row.available,
    priceCents: row.priceCents,
    options: row.options,
    kind: row.kind,
    delivery: row.delivery,
    accessUrl: row.accessUrl,
    accessNote: row.accessNote,
    sessionMinutes: row.sessionMinutes,
    sessionPlace: row.sessionPlace,
    sessionWhere: row.sessionWhere,
    files: row.files,
    codesLeft: row.codesLeft,
    sessions: row.sessions.map((t) => ({ ...t, startsAt: new Date(t.startsAt) })),
    photoUrl,
  };
}

/** What an autosave carries: the checked fields, and the digital ones whenever they are, or were, in play. */
type Draft = CheckedItem & { digital?: DigitalFields };

/** The digital state of the item as the preview draws it: what is typed, with the files, codes and times the API holds. */
function previewDigital(draft: DigitalDraft, saved: EditorItem | null): Pick<EditorItem, 'kind' | 'delivery' | 'accessUrl' | 'accessNote' | 'sessionMinutes' | 'sessionPlace' | 'sessionWhere' | 'files' | 'codesLeft' | 'sessions'> {
  if (draft.kind !== 'DIGITAL') return PHYSICAL_ITEM;
  const stored = saved?.kind === 'DIGITAL' && saved.delivery === draft.delivery ? saved : null;
  const fields = checkDigital(draft);
  const sent = 'fields' in fields && fields.fields.kind === 'DIGITAL' ? fields.fields : null;
  return {
    kind: 'DIGITAL',
    delivery: draft.delivery,
    accessUrl: sent?.accessUrl ?? null,
    accessNote: sent?.accessNote ?? null,
    sessionMinutes: sent?.sessionMinutes ?? null,
    sessionPlace: sent?.sessionPlace ?? null,
    sessionWhere: sent?.sessionWhere ?? null,
    files: stored?.files ?? [],
    codesLeft: stored?.codesLeft ?? 0,
    sessions: stored?.sessions ?? [],
  };
}

/**
 * One item, edited on its own (the board's "All items" view). Saves as the
 * owner types, once the fields read as an item: a name, and a price or a
 * full set of options. Until then nothing is sent, and the line under the
 * price says what is missing. A new item is created by its first such save.
 * Done sends anything still waiting and goes back to the list, but not while
 * the fields cannot be saved.
 */
export function ItemEditor({
  item,
  tint,
  uploadsEnabled,
  categories,
  api,
  onSaved,
  onPreview,
  onRemoved,
  onClose,
}: {
  /** Null for a new item. */
  item: EditorItem | null;
  /** Which of the four soft tints the no-photo square wears. */
  tint: number;
  uploadsEnabled: boolean;
  /** The categories the owner's other items already use, offered in the select. */
  categories: string[];
  api: ItemsApi;
  /** Called with the item as the API saved it (created, updated, or its picture changed). */
  onSaved: (item: EditorItem) => void;
  /** The item as it would look now, for the preview, or null while it cannot be shown. */
  onPreview: (item: EditorItem | null) => void;
  onRemoved: (id: string) => void;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<EditorItem | null>(item);
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [tag, setTag] = useState(item?.tag ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  // Typing a category no other item uses yet; leaving the box puts the select back, showing it.
  const [typingCategory, setTypingCategory] = useState(false);
  const [draft, setDraft] = useState<PricingDraft>(() => draftOf(item));
  const [digital, setDigital] = useState<DigitalDraft>(() => digitalDraftOf(item));
  const listId = useId();
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Held so a second save made while the first creation is still in flight
  // updates that item rather than creating another.
  const creating = useRef<Promise<EditorItem> | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const checked = checkFields(name, description, draft, { category, tag, sku });
  const checkedDigital = checkDigital(digital);
  const problem = 'error' in checked ? checked.error : 'error' in checkedDigital ? checkedDigital.error : null;

  const autosave = useAutosave(async (fields: Draft) => {
    const current = savedRef.current ?? (creating.current ? await creating.current : null);
    const { digital: kinds, ...rest } = fields;
    if (current) {
      const row = await api.update(current.id, { ...rest, ...kinds });
      const next = fromRow(row, current.photoUrl);
      setSaved(next);
      onSaved(next);
      return;
    }
    creating.current = api.add(kinds ? { ...rest, digital: kinds } : rest).then((row) => fromRow(row, null));
    try {
      const next = await creating.current;
      setSaved(next);
      onSaved(next);
    } finally {
      creating.current = null;
    }
  });

  useEffect(() => {
    if (!item) nameRef.current?.focus();
  }, [item]);

  // The preview follows every keystroke that still reads as an item.
  useEffect(() => {
    if ('error' in checked) {
      onPreview(saved);
      return;
    }
    onPreview({
      ...PHYSICAL_ITEM,
      ...previewDigital(digital, saved),
      id: saved?.id ?? 'new',
      name: checked.name,
      slug: saved?.slug ?? '',
      description: checked.description,
      category: checked.category,
      tag: checked.tag,
      sku: checked.sku,
      photoKey: saved?.photoKey ?? null,
      photoUrl: saved?.photoUrl ?? null,
      available: saved?.available ?? true,
      priceCents: pricedFields(checked.pricing).priceCents,
      // Unsaved options have no ids yet; the preview only needs them to tell the options apart.
      options: pricedFields(checked.pricing).options.map((option, i) => ({ id: `draft-${i}`, ...option })),
    });
    // `checked` is derived from the first three; listing it would re-run on every render.
  }, [name, description, category, tag, sku, draft, digital, saved]);

  function edit(next: { name?: string; description?: string; category?: string; tag?: string; sku?: string; draft?: PricingDraft; digital?: DigitalDraft }) {
    const nextName = next.name ?? name;
    const nextDescription = next.description ?? description;
    const nextCategory = next.category ?? category;
    const nextTag = next.tag ?? tag;
    const nextSku = next.sku ?? sku;
    const nextDraft = next.draft ?? draft;
    const nextDigital = next.digital ?? digital;
    if (next.name !== undefined) setName(next.name);
    if (next.description !== undefined) setDescription(next.description);
    if (next.category !== undefined) setCategory(next.category);
    if (next.tag !== undefined) setTag(next.tag);
    if (next.sku !== undefined) setSku(next.sku);
    if (next.draft) setDraft(next.draft);
    if (next.digital) setDigital(next.digital);
    setError('');
    const fields = checkFields(nextName, nextDescription, nextDraft, { category: nextCategory, tag: nextTag, sku: nextSku });
    const kinds = checkDigital(nextDigital);
    // A digital item that is not yet complete (no link, no length) is not sent: it would be saved as the wrong thing.
    if ('error' in fields || 'error' in kinds) return;
    const wasDigital = savedRef.current?.kind === 'DIGITAL';
    autosave.schedule(nextDigital.kind === 'DIGITAL' || wasDigital ? { ...fields, digital: kinds.fields } : fields);
  }

  const editDigital = (change: Partial<DigitalDraft>) => edit({ digital: { ...digital, ...change } });

  /** Applies a change to the saved item (a file, a code count, a time) and tells the screen. */
  function patchItem(change: (current: EditorItem) => EditorItem) {
    const current = savedRef.current;
    if (!current) return;
    const next = change(current);
    savedRef.current = next;
    setSaved(next);
    onSaved(next);
  }

  /** Sends anything waiting, so a file, code or time goes to an item the API already knows as this kind of digital item. */
  async function ready(delivery: Delivery): Promise<EditorItem | null> {
    await autosave.flushPending();
    const current = savedRef.current;
    return current && current.kind === 'DIGITAL' && current.delivery === delivery ? current : null;
  }

  function setKind(kind: PricingDraft['kind']) {
    if (kind === draft.kind) return;
    const blank = draft.options.every((o) => o.label.trim() === '' && o.price.trim() === '');
    // Switching a priced item to options keeps its price as the first option.
    const options = kind === 'options' && blank && draft.price.trim() !== '' ? [{ ...blankOption(), label: 'Regular', price: draft.price }] : draft.options;
    const price = kind === 'single' && draft.price.trim() === '' ? (draft.options[0]?.price ?? '') : draft.price;
    edit({ draft: { kind, price, options } });
  }

  const setOption = (key: number, change: Partial<{ label: string; price: string }>) =>
    edit({ draft: { ...draft, options: draft.options.map((o) => (o.key === key ? { ...o, ...change } : o)) } });

  async function setAvailable(available: boolean) {
    if (!saved) return;
    setError('');
    try {
      const next = fromRow(await api.update(saved.id, { available }), saved.photoUrl);
      setSaved(next);
      onSaved(next);
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function upload(picked: File) {
    if (!saved) return;
    setError('');
    try {
      const url = await api.uploadPhoto(saved.id, picked);
      setPictureFailed(false);
      const next = { ...saved, photoUrl: url };
      setSaved(next);
      onSaved(next);
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function removePicture() {
    if (!saved) return;
    setError('');
    try {
      await api.removePhoto(saved.id);
      const next = { ...saved, photoUrl: null, photoKey: null };
      setSaved(next);
      onSaved(next);
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function remove() {
    if (!saved) return;
    setError('');
    try {
      await api.remove(saved.id);
      onRemoved(saved.id);
    } catch (failure) {
      setConfirming(false);
      setError(message(failure));
    }
  }

  async function done() {
    if (problem) {
      setError(saved ? `${problem} Or go back to All items to leave it as it was.` : `${problem} Or go back to All items to leave it out.`);
      return;
    }
    const sent = await autosave.flushPending();
    // Nothing waiting: go unless the last save failed and is still unsaved.
    if (sent === true || (sent === null && autosave.status !== 'error')) onClose();
  }

  const hasPicture = Boolean(saved?.photoUrl && !pictureFailed);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const shownCategory = category.replace(/\s+/g, ' ').trim();
  // This item's own category stays a choice, even when it is the only item with it.
  const categoryChoices = shownCategory && !categories.includes(shownCategory) ? [...categories, shownCategory] : categories;

  return (
    <div className={styles.editor} role="group" aria-label={item ? `Edit ${item.name}` : 'New item'}>
      <button type="button" className={styles.back} onClick={onClose}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        All items
      </button>

      <div className={styles.editorTop}>
        <div className={styles.photoCell}>
          <button
            type="button"
            className={styles.photo}
            data-tint={tint % 4}
            aria-label={hasPicture ? 'Change picture' : 'Add a picture'}
            title={!uploadsEnabled ? 'Pictures are switched off here' : saved ? undefined : 'Give it a name and a price first'}
            disabled={!uploadsEnabled || !saved}
            onClick={() => file.current?.click()}
          >
            {hasPicture ? <img src={saved?.photoUrl ?? ''} alt="" onError={() => setPictureFailed(true)} /> : null}
            {hasPicture ? null : initial}
            <span aria-hidden="true">{hasPicture ? 'Change picture' : 'Add a picture'}</span>
          </button>
          {hasPicture && uploadsEnabled ? (
            <button type="button" className={styles.ghost} aria-label="Remove picture" onClick={() => void removePicture()}>
              Remove
            </button>
          ) : null}
          {uploadsEnabled ? (
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              aria-label="Picture file"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                event.target.value = '';
                if (picked) void upload(picked);
              }}
            />
          ) : null}
        </div>
        <div className={styles.fields}>
          <label className={ui.float}>
            <em>Name</em>
            <input ref={nameRef} value={name} autoComplete="off" onChange={(event) => edit({ name: event.target.value })} />
          </label>
          <div className={ui.float}>
            <label>
              <em>Description</em>
              <textarea value={description} style={{ height: 84 }} onChange={(event) => edit({ description: event.target.value })} />
            </label>
            <small aria-hidden="true" data-over={[...description].length > ITEM_DESCRIPTION_MAX || undefined}>
              {[...description].length}/{ITEM_DESCRIPTION_MAX}
            </small>
          </div>
        </div>
      </div>

      <div className={styles.labels}>
        {typingCategory ? (
          <label className={ui.float}>
            <em>New category</em>
            <input
              value={category}
              maxLength={ITEM_CATEGORY_MAX * 2}
              autoComplete="off"
              autoFocus
              onChange={(event) => edit({ category: event.target.value })}
              onBlur={() => setTypingCategory(false)}
            />
          </label>
        ) : (
          <label className={ui.float}>
            <em>Category</em>
            <select
              value={shownCategory}
              onChange={(event) => {
                if (event.target.value !== NEW_CATEGORY) {
                  edit({ category: event.target.value });
                  return;
                }
                edit({ category: '' });
                setTypingCategory(true);
              }}
            >
              <option value="">No category</option>
              {categoryChoices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={NEW_CATEGORY}>New category…</option>
            </select>
          </label>
        )}
        <label className={ui.float}>
          <em>Tag</em>
          <input value={tag} list={`${listId}-tags`} maxLength={ITEM_TAG_MAX * 2} autoComplete="off" onChange={(event) => edit({ tag: event.target.value })} />
          <datalist id={`${listId}-tags`}>
            {ITEM_TAG_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
        </label>
        <label className={ui.float}>
          <em>Item code (optional)</em>
          <input value={sku} maxLength={ITEM_SKU_MAX * 2} autoComplete="off" spellCheck={false} onChange={(event) => edit({ sku: event.target.value })} />
        </label>
      </div>

      <KindSwitch draft={digital} onDraft={editDigital} />
      {digital.kind === 'DIGITAL' ? <DigitalPanels draft={digital} onDraft={editDigital} item={saved} api={api} ready={ready} patchItem={patchItem} /> : null}

      <div className={styles.sub}>
        <b id="price-title">Price</b>
        <span>Options suit sizes, like 1kg and 2kg</span>
      </div>
      <div className={styles.pricedBy} role="radiogroup" aria-labelledby="price-title" style={{ '--at': draft.kind === 'single' ? 0 : 1 } as CSSProperties}>
        {(
          [
            ['single', 'One price'],
            ['options', 'Options'],
          ] as const
        ).map(([kind, label]) => (
          <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} onClick={() => setKind(kind)}>
            {label}
          </button>
        ))}
      </div>

      {draft.kind === 'single' ? (
        <label className={`${styles.money} ${styles.price}`}>
          <span>RM</span>
          <input value={draft.price} inputMode="decimal" aria-label="Price in ringgit" placeholder="0.00" onChange={(event) => edit({ draft: { ...draft, price: event.target.value } })} />
        </label>
      ) : (
        <>
          <div className={styles.options}>
            {draft.options.map((option, index) => (
              <div key={option.key} className={styles.option}>
                <input
                  className={styles.optionName}
                  value={option.label}
                  placeholder={`Option ${index + 1}, like 1kg`}
                  aria-label={`Option ${index + 1} name`}
                  onChange={(event) => setOption(option.key, { label: event.target.value })}
                />
                <label className={styles.money}>
                  <span>RM</span>
                  <input
                    value={option.price}
                    inputMode="decimal"
                    aria-label={`Option ${index + 1} price in ringgit`}
                    placeholder="0.00"
                    onChange={(event) => setOption(option.key, { price: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className={ui.iconButton}
                  aria-label={`Remove option ${index + 1}`}
                  disabled={draft.options.length === 1}
                  onClick={() => edit({ draft: { ...draft, options: draft.options.filter((o) => o.key !== option.key) } })}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
                    <path d={BIN} />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {draft.options.length < MAX_OPTIONS ? (
            <button type="button" className={ui.addRow} onClick={() => edit({ draft: { ...draft, options: [...draft.options, blankOption()] } })}>
              + Add option
            </button>
          ) : (
            <p className={ui.note}>{MAX_OPTIONS} options is the most an item holds.</p>
          )}
        </>
      )}

      <p className={styles.priceLine} data-bad={problem ? '' : undefined} aria-live="polite">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d={problem ? 'M12 8v5M12 16.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' : 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'} />
        </svg>
        {problem ?? `Customers see ${'error' in checked ? '' : priceLine(pricedFields(checked.pricing))}`}
      </p>

      <SaveState status={autosave.status} error={autosave.error} retry={autosave.retry} />
      {error ? <Callout tone="error">{error}</Callout> : null}

      <div className={styles.editorFoot}>
        <span className={styles.available}>
          <button
            type="button"
            className={ui.switch}
            role="switch"
            aria-checked={saved?.available ?? true}
            aria-label="In your shop"
            disabled={!saved}
            onClick={() => void setAvailable(!(saved?.available ?? true))}
          >
            <i />
          </button>
          {(saved?.available ?? true) ? 'In your shop and known to the chat' : 'Hidden from your shop and the chat'}
        </span>
        <span className={styles.footEnd}>
          {confirming ? (
            <span className={ui.confirm} role="group" aria-label="Confirm removal">
              Remove it from your shop and the chat?
              <button type="button" className={ui.confirmRemove} onClick={() => void remove()}>
                Yes, remove
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <>
              {saved ? (
                <button type="button" className={styles.ghost} onClick={() => setConfirming(true)}>
                  Remove item
                </button>
              ) : null}
              <button type="button" className={ui.primaryButton} onClick={() => void done()}>
                Done
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
