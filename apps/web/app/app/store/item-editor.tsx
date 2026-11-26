'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Callout } from '@curios/ui';
import { ITEM_CATEGORY_MAX, ITEM_DESCRIPTION_MAX, ITEM_SKU_MAX, ITEM_TAG_MAX, ITEM_TAG_PRESETS, MAX_OPTIONS } from '@curios/core/store';
import { InlineConfirm } from '../_ui/inline-confirm.js';
import { PageHead } from '../_ui/page-head.js';
import { SaveState } from '../_ui/save-state.js';
import { SectionHead } from '../_ui/section-head.js';
import { useAutosave } from '../_ui/use-autosave.js';
import ui from '../_ui/editor.module.css';
import panel from '../panel.module.css';
import { blankOption, checkFields, choicesToOptions, draftOf, ownerPricingLine, previewChoicesOf, pricedFields, startChoices, type CheckedItem, type PricingDraft } from './pricing.js';
import { ItemChoicesEditor } from './item-choices-editor.js';
import { DigitalPanels, GET_NOTE, KIND_NOTE, KindSwitch } from './digital-fields.js';
import { ItemPhotos } from './item-photos.js';
import { checkDigital, digitalDraftOf, type DigitalDraft } from './digital-draft.js';
import { PHYSICAL_ITEM, type Delivery, type DigitalFields, type EditorItem, type ItemRow, type ItemsApi, type PhotosResult } from './store-types.js';
import styles from './store.module.css';

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

const BIN = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';

/** The category select's last choice, which swaps it for a box to type a new one in. No category can be this. */
const NEW_CATEGORY = '\u0000new';

/**
 * An API row as the screen holds it. The cover's URL is made from the row's own photoKey, never
 * carried over from before the save: a photo change that landed while the save was in flight
 * has already moved photoKey, and an old URL would show a cover that is gone.
 */
export function fromRow(row: ItemRow, photoUrl: (key: string) => string): EditorItem {
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
    askForPrice: row.askForPrice,
    options: row.options,
    ...(row.choices ? { choices: row.choices } : {}),
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
    photos: row.photos,
    photoUrl: row.photoKey ? photoUrl(row.photoKey) : null,
  };
}

/** What an autosave carries: the checked fields, and the digital ones whenever they are, or were, in play. */
type Draft = CheckedItem & { digital?: DigitalFields };

/** What the preview draws of an item with choice groups: the combinations on sale as its options, and the groups with the item's photos. */
function previewChoicePart(pricing: Extract<CheckedItem['pricing'], { kind: 'choices' }>, saved: EditorItem | null): Pick<EditorItem, 'options' | 'choices'> {
  const choices = previewChoicesOf(pricing, saved?.photos ?? []);
  return { choices, options: choices.combos.filter((combo) => combo.available).map(({ id, label, priceCents }) => ({ id, label, priceCents })) };
}

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
 * One item, on its own screen (the board's item editor): a back link, the header, and a row for
 * each part (Photos, Name and description, What it is, How they order or How they get it, Price,
 * In your shop). Saves as the owner types, once the fields read as an item: a name, and a price
 * or a full set of options. Until then nothing is sent, and the line under the price says what
 * is missing. A new item is created by its first such save. "All items" sends anything still
 * waiting before it goes back, and stays if that save failed.
 */
/** CHIP lists no online banking for a total under RM1, so a basket of just this price is paid another way. */
const ONLINE_MIN_CENTS = 100;
const underOnlineMin = (pricing: CheckedItem['pricing']) => {
  // An Ask item is never paid at checkout: its starting price is only a guide.
  if (pricing.kind === 'ask') return false;
  const { priceCents, options } = pricedFields(pricing);
  return [priceCents, ...options.map((option) => option.priceCents)].some((cents) => cents !== null && cents < ONLINE_MIN_CENTS);
};

/** Asking for a price is for physical items only: a digital one is always priced for the basket. */
const pricingFor = (draft: PricingDraft, digital: DigitalDraft): PricingDraft => (digital.kind === 'DIGITAL' && draft.ask ? { ...draft, ask: false } : draft);

/** "How they order" (deleted Store board, 8 Nov): the basket, or an enquiry. */
const HOWS = [
  [false, 'Add to basket', 'They pick, pay and it lands in Orders'],
  [true, 'Ask for a price', 'They send an enquiry. You reply with a price'],
] as const;

export function ItemEditor({
  item,
  tint,
  uploadsEnabled,
  paysOnline = false,
  categories,
  api,
  onSaved,
  onPreview,
  onRemoved,
  onClose,
  shop,
}: {
  /** Null for a new item. */
  item: EditorItem | null;
  /** Which of the four soft tints the no-photo square wears. */
  tint: number;
  uploadsEnabled: boolean;
  /** The shop takes online payment through CHIP, whose online banking starts at RM1. */
  paysOnline?: boolean;
  /** The categories the owner's other items already use, offered in the select. */
  categories: string[];
  api: ItemsApi;
  /** Called with the item as the API saved it (created, updated, or its picture changed). */
  onSaved: (item: EditorItem) => void;
  /** The item as it would look now, for the preview, or null while it cannot be shown. */
  onPreview: (item: EditorItem | null) => void;
  onRemoved: (id: string) => void;
  /** Back to All items. Called once anything waiting has been sent. */
  onClose: () => void;
  /** The owner's shop, for "See it in your shop": its handle, and whether it is open to visitors. */
  shop: { handle: string; open: boolean };
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
  // The groups just turned into a plain list, with the list they became (compared by identity: any edit to the list makes a new one).
  const [shelved, setShelved] = useState<{ choices: NonNullable<PricingDraft['choices']>; options: PricingDraft['options'] } | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Held so a second save made while the first creation is still in flight
  // updates that item rather than creating another.
  const creating = useRef<Promise<EditorItem> | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const asking = digital.kind !== 'DIGITAL' && draft.ask === true;
  const photoIds = (saved?.photos ?? []).map((photo) => photo.id);
  const checked = checkFields(name, description, pricingFor(draft, digital), { category, tag, sku, photoIds });
  const checkedDigital = checkDigital(digital);
  const problem = 'error' in checked ? checked.error : 'error' in checkedDigital ? checkedDigital.error : null;

  // What is typed in the last moments is sent when the screen is left any way at all (browser Back, the sidebar, closing).
  // Declared before useAutosave so it runs before that hook's own cleanup drops the waiting save.
  const flushRef = useRef<(() => Promise<unknown>) | null>(null);
  useEffect(() => {
    const leave = () => void flushRef.current?.();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);
  const autosave = useAutosave(async (fields: Draft) => {
    const current = savedRef.current ?? (creating.current ? await creating.current : null);
    const { digital: kinds, ...rest } = fields;
    if (current) {
      const row = await api.update(current.id, { ...rest, ...kinds });
      const next = fromRow(row, api.photoUrl);
      setSaved(next);
      onSaved(next);
      return;
    }
    creating.current = api.add(kinds ? { ...rest, digital: kinds } : rest).then((row) => fromRow(row, api.photoUrl));
    try {
      const next = await creating.current;
      setSaved(next);
      onSaved(next);
    } finally {
      creating.current = null;
    }
  });

  flushRef.current = autosave.flushPending;

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
      askForPrice: pricedFields(checked.pricing).askForPrice,
      // Unsaved options have no ids yet; the preview only needs them to tell the options apart.
      ...(checked.pricing.kind === 'choices'
        ? previewChoicePart(checked.pricing, saved)
        : { options: pricedFields(checked.pricing).options.map((option, i) => ({ id: `draft-${i}`, ...option })) }),
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
    const fields = checkFields(nextName, nextDescription, pricingFor(nextDraft, nextDigital), { category: nextCategory, tag: nextTag, sku: nextSku, photoIds: (savedRef.current?.photos ?? []).map((photo) => photo.id) });
    const kinds = checkDigital(nextDigital);
    // A digital item that is not yet complete (no link, no length) is not sent: it would be saved as the wrong thing.
    if ('error' in fields || 'error' in kinds) {
      // What is on screen is not an item: a save waiting from before would send a half-edited one.
      autosave.cancel();
      return;
    }
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
    edit({ draft: { ...draft, kind, price, options } });
  }

  const setAsk = (ask: boolean) => ask !== asking && edit({ draft: { ...draft, ask } });

  const setOption = (key: number, change: Partial<{ label: string; price: string }>) =>
    edit({ draft: { ...draft, options: draft.options.map((o) => (o.key === key ? { ...o, ...change } : o)) } });

  async function setAvailable(available: boolean) {
    if (!saved) return;
    setError('');
    try {
      const next = fromRow(await api.update(saved.id, { available }), api.photoUrl);
      setSaved(next);
      onSaved(next);
    } catch (failure) {
      setError(message(failure));
    }
  }

  /** The photos changed on the API: the item the screen holds follows, so its thumbnail and the preview do. */
  function photosChanged(result: PhotosResult) {
    // Read now, not from the render this was made in: the result may land after an await.
    const current = savedRef.current;
    if (!current) return;
    const next = { ...current, photos: result.photos, photoKey: result.photoKey, photoUrl: result.photoKey ? api.photoUrl(result.photoKey) : null };
    setSaved(next);
    onSaved(next);
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

  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const shownCategory = category.replace(/\s+/g, ' ').trim();
  // This item's own category stays a choice, even when it is the only item with it.
  const categoryChoices = shownCategory && !categories.includes(shownCategory) ? [...categories, shownCategory] : categories;
  const isDigital = digital.kind === 'DIGITAL';
  const viewHref = saved && saved.available && shop.open ? `/${shop.handle}/shop/${saved.slug}` : null;
  const row = `${ui.section} ${ui.sectionRow}`;

  async function goBack(event: MouseEvent<HTMLAnchorElement>) {
    // A new tab or window is the browser's to open; anything else waits for what is typed to be sent.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const sent = await autosave.flushPending();
    // Stay when the save failed, now or earlier and not yet retried: leaving would drop what is typed.
    if (sent === false || (sent === null && autosave.status === 'error')) return;
    onClose();
  }

  const priceLine = (
    <p className={styles.priceLine} data-bad={problem ? '' : undefined} aria-live="polite">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path d={problem ? 'M12 8v5M12 16.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' : 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'} />
      </svg>
      {problem ?? `Customers see ${'error' in checked ? '' : ownerPricingLine(checked.pricing)}`}
    </p>
  );

  return (
    <div className={styles.itemScreen} role="group" aria-label={item ? `Edit ${item.name}` : 'New item'}>
      <div className={styles.backRow}>
        <Link className={styles.back} href="/app/store" prefetch={false} onClick={(event) => void goBack(event)}>
          <span aria-hidden="true">‹</span>
          All items
        </Link>
      </div>
      <PageHead kicker={isDigital ? 'Store · Digital item' : 'Store · Item'} title={name.trim() || saved?.name || 'New item'}>
        {viewHref ? (
          <a className={`${panel.secondaryLink} ${ui.headLink}`} href={viewHref} target="_blank" rel="noreferrer">
            See it in your shop
          </a>
        ) : null}
      </PageHead>

      <div className={ui.editBody}>
        <section className={row} aria-labelledby="photos-title">
          <SectionHead id="photos-title" title="Photos" note="Up to 6. Square works best." />
          <ItemPhotos item={saved} tint={tint} initial={initial} uploadsEnabled={uploadsEnabled} api={api} onChange={photosChanged} onError={setError} />
          <p className={ui.note}>Drag to reorder. The first one is the cover, and you can crop it.</p>
        </section>

        <section className={row} aria-labelledby="name-title">
          <SectionHead id="name-title" title="Name and description" note="What customers read on the item page." />
          <div className={styles.fields}>
            <label className={ui.float}>
              <em>Name</em>
              <input ref={nameRef} value={name} autoComplete="off" onChange={(event) => edit({ name: event.target.value })} />
            </label>
            <div className={ui.float}>
              <label>
                <em>About</em>
                <textarea value={description} style={{ height: 84 }} onChange={(event) => edit({ description: event.target.value })} />
              </label>
              <small aria-hidden="true" data-over={[...description].length > ITEM_DESCRIPTION_MAX || undefined}>
                {[...description].length}/{ITEM_DESCRIPTION_MAX}
              </small>
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
          </div>
        </section>

        <section className={row} aria-labelledby="kind-title">
          <SectionHead id="kind-title" title="What it is" note={KIND_NOTE[isDigital ? 'DIGITAL' : 'PHYSICAL']} />
          <KindSwitch draft={digital} onDraft={editDigital} headless />
        </section>

        {isDigital ? (
          <section className={row} aria-labelledby="get-title">
            <SectionHead id="get-title" title="How they get it" note={GET_NOTE} />
            <DigitalPanels draft={digital} onDraft={editDigital} item={saved} api={api} ready={ready} patchItem={patchItem} headless />
          </section>
        ) : (
          <section className={row} aria-labelledby="how-title">
            <SectionHead id="how-title" title="How they order" note="Made-to-order things, like custom cakes, work best as Ask." />
            <div className={styles.askTiles} role="group" aria-labelledby="how-title">
              {HOWS.map(([ask, label, note]) => (
                <button key={label} type="button" className={`${ui.tile} ${styles.deliveryTile} ${styles.digitalTile}`} aria-pressed={asking === ask} onClick={() => setAsk(ask)}>
                  <span className={ui.tick} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="12" height="12">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  <span>
                    <b>{label}</b>
                    <span>{note}</span>
                  </span>
                </button>
              ))}
            </div>
            {asking ? (
              <>
                <label className={`${styles.money} ${styles.price}`}>
                  <span>From RM</span>
                  <input value={draft.price} inputMode="decimal" aria-label="Starting price in ringgit" placeholder="Leave empty" onChange={(event) => edit({ draft: { ...draft, price: event.target.value } })} />
                </label>
                <p className={ui.note}>
                  Optional. Helps your page answer “how much?” Customers fill in one message box, plus their name and WhatsApp. Your page picks out the date, how many people and the budget for you, and puts it in Leads.
                </p>
                {priceLine}
              </>
            ) : null}
          </section>
        )}

        {asking ? null : (
          <section className={row} aria-labelledby="price-title">
            <SectionHead id="price-title" title="Price" note="Options suit sizes, like 1kg and 2kg." />
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
            ) : draft.choices ? (
              <>
                <ItemChoicesEditor
                  draft={draft.choices}
                  photos={saved?.photos ?? []}
                  photoUrl={api.photoUrl}
                  onChange={(choices) => edit({ draft: { ...draft, choices } })}
                />
                <InlineConfirm
                  trigger="Use a plain list of options instead"
                  question="Turn this into a plain list? Your groups, photos and switched-off combinations are removed."
                  yes="Yes, make it a list"
                  no="Keep my groups"
                  tone="quiet"
                  onYes={() => {
                    const options = choicesToOptions(draft.choices!);
                    // Kept for this session: "+ Add a choice group" straight after puts the groups back as they were.
                    setShelved({ choices: draft.choices!, options });
                    edit({ draft: { ...draft, options, choices: null } });
                  }}
                />
              </>
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
                <button type="button" className={ui.addRow} onClick={() => edit({ draft: { ...draft, choices: shelved && shelved.options === draft.options ? shelved.choices : startChoices(draft.options) } })}>
                  + Add a choice group
                </button>
              </>
            )}

            {priceLine}
            {paysOnline && !('error' in checked) && underOnlineMin(checked.pricing) ? (
              <p className={ui.note}>Under RM1, a customer buying only this can’t pay by online banking: CHIP takes RM1 or more.</p>
            ) : null}
          </section>
        )}

        <section className={row} aria-labelledby="shop-title">
          <SectionHead id="shop-title" title="In your shop" note="Switch it off to hide it for a while." />
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
          {saved ? (
            confirming ? (
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
              <button type="button" className={styles.ghost} onClick={() => setConfirming(true)}>
                Remove item
              </button>
            )
          ) : null}
        </section>

        <SaveState status={autosave.status} error={autosave.error} retry={autosave.retry} />
        {error ? <Callout tone="error">{error}</Callout> : null}
      </div>
    </div>
  );
}
