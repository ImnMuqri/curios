'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ITEMS, SHOP_DESCRIPTION_MAX, formatRinggit, storeGapMessage, storeGaps } from '@curios/core/store';
import type { ItemStats } from '@curios/db-read';
import type { OwnerVoucher } from '@curios/core/vouchers';
import { PageTheme } from '../../_bento/BentoPage.js';
import { nextOrderDay } from '../../[handle]/shop/pill.js';
import { ProductView } from '../../[handle]/shop/[slug]/product-view.js';
import { BasketBar } from '../../[handle]/shop/basket-bar.js';
import { ShopPageView } from '../../[handle]/shop/shop-page.js';
import { PageHead } from '../_ui/page-head.js';
import { PreviewFrame } from '../_ui/preview-frame.js';
import { SaveState } from '../_ui/save-state.js';
import { usePublishSaveStatus, useSaveStatus, type SaveTrack } from '../_ui/save-status.js';
import { SectionHead } from '../_ui/section-head.js';
import { PillTabs } from '../_ui/pill-tabs.js';
import ui from '../_ui/editor.module.css';
import panel from '../panel.module.css';
import { DeliveryTab } from './delivery-tab.js';
import { ItemEditor } from './item-editor.js';
import { ItemsList, NEW_ITEM_HREF, itemHref } from './items-list.js';
import { PayPreview } from './pay-preview.js';
import { PaymentTab } from './payment-tab.js';
import { orNull, useSettingText } from './setting-field.js';
import { previewItem, type ChipApi, type ChipState, type EditorItem, type ItemsApi, type PickupApi, type PickupPlaceView, type SettingsApi, type SettingsPatch, type ShopLook, type StoreSettings, type VouchersApi } from './store-types.js';
import styles from './store.module.css';
import { VouchersTab } from './vouchers-tab.js';

/** The ids stay what links and the CHIP alert say (`?tab=vouchers`); the board's label for the last is Discounts. */
type Tab = 'items' | 'payment' | 'delivery' | 'vouchers';
type PreviewTab = 'shop' | 'item' | 'pay';

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

function trackedItems(api: ItemsApi, track: SaveTrack): ItemsApi {
  return {
    add: (input) => track(api.add(input)),
    update: (id, patch) => track(api.update(id, patch)),
    remove: (id) => track(api.remove(id)),
    reorder: (ids) => track(api.reorder(ids)),
    addPhoto: (id, blob, frame) => track(api.addPhoto(id, blob, frame)),
    recropPhoto: (id, photoId, frame) => track(api.recropPhoto(id, photoId, frame)),
    replacePhoto: (id, photoId, blob, frame) => track(api.replacePhoto(id, photoId, blob, frame)),
    removePhoto: (id, photoId) => track(api.removePhoto(id, photoId)),
    reorderPhotos: (id, ids) => track(api.reorderPhotos(id, ids)),
    photoUrl: (key) => api.photoUrl(key),
    originalUrl: (id, photoId) => api.originalUrl(id, photoId),
    uploadFile: (id, file, onProgress) => track(api.uploadFile(id, file, onProgress)),
    removeFile: (id, fileId) => track(api.removeFile(id, fileId)),
    addCodes: (id, text) => track(api.addCodes(id, text)),
    addSession: (id, input) => track(api.addSession(id, input)),
    updateSession: (id, sessionId, patch) => track(api.updateSession(id, sessionId, patch)),
    removeSession: (id, sessionId) => track(api.removeSession(id, sessionId)),
  };
}

function trackedVouchers(api: VouchersApi, track: SaveTrack): VouchersApi {
  return {
    add: (input) => track(api.add(input)),
    update: (id, patch) => track(api.update(id, patch)),
    remove: (id) => track(api.remove(id)),
  };
}

function trackedPickup(api: PickupApi, track: SaveTrack): PickupApi {
  return {
    list: () => track(api.list()),
    add: (place) => track(api.add(place)),
    save: (id, place) => track(api.save(id, place)),
    remove: (id) => track(api.remove(id)),
    reorder: (ids) => track(api.reorder(ids)),
  };
}

function trackedSettings(api: SettingsApi, track: SaveTrack): SettingsApi {
  return {
    save: (patch) => track(api.save(patch)),
    uploadQr: (file) => track(api.uploadQr(file)),
    removeQr: () => track(api.removeQr()),
  };
}

/**
 * What "A way to pay" says once there is one: the board's "QR and bank account", "DuitNow
 * QR" or "Bank account", with CHIP named first when it is connected. Short enough for one
 * line in every mix: a second line made the whole strip taller (owner, 12 Nov 2026).
 */
function payWords(chip: boolean, qr: boolean, bank: boolean): string {
  if (!chip) return qr && bank ? 'QR and bank account' : qr ? 'DuitNow QR' : 'Bank account';
  if (qr && bank) return 'CHIP, QR and bank account';
  if (qr) return 'CHIP and DuitNow QR';
  if (bank) return 'CHIP and bank account';
  return 'Online through CHIP';
}

/**
 * "Pickup and delivery RM10", "Rider delivery", "Sent by email", ...: what "Getting it to them"
 * says once it is set. A shop of digital items only has nothing to hand over: they go by email.
 */
function handOverWords(s: StoreSettings, physicalItems: boolean): string {
  const parts = [
    ...(s.pickupEnabled ? ['pickup'] : []),
    ...(s.deliveryMode === 'FLAT' ? [s.deliveryFeeCents ? `delivery ${formatRinggit(s.deliveryFeeCents)}` : 'free delivery'] : s.deliveryMode === 'RIDER' ? ['rider delivery'] : []),
  ].join(' and ');
  if (!parts) return physicalItems ? '' : 'Sent by email';
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

/** When an item last changed on this device, so a screen restored from the browser's history knows it is out of date. */
const CHANGED_KEY = 'curios-store-changed';
/** `at` is the server's clock, estimated: the browser's own can be minutes off it. */
function markChanged(at: number) {
  try {
    window.sessionStorage.setItem(CHANGED_KEY, String(at));
  } catch {
    // Storage can be blocked; the next visit then reads the server's list as it is.
  }
}
function changedSince(rendered: Date): boolean {
  try {
    return Number(window.sessionStorage.getItem(CHANGED_KEY) ?? 0) > rendered.getTime();
  } catch {
    return false;
  }
}

/**
 * Store: the shop on the owner's page, arranged, as the Dash board draws it. The header ("Your
 * shop", Store, and See your shop and + Add item) carries the tabs under it, each with its count.
 * On Items, the ready box says whether the shop is open and what it still needs, the cards are the
 * items, and the shop's description follows. Payment, Pickup & delivery and Discounts are the
 * other tabs. An item opens on its own screen (a route of its own, so back and forward work), with
 * the phone to preview it. Every change saves as it is made.
 */
export function StoreEditor({
  initial,
  items: initialItems,
  stats = {},
  look,
  qrUrl,
  uploadsEnabled,
  today,
  now,
  chip: initialChip,
  orders,
  vouchers: initialVouchers = [],
  pickupPlaces = [],
  initialTab = 'items',
  editingId = null,
  settingsApi: rawSettings,
  itemsApi: rawItems,
  chipApi,
  vouchersApi: rawVouchers,
  pickupApi: rawPickup,
}: {
  initial: StoreSettings;
  items: EditorItem[];
  /** What each item has done lately, by item id, from the store read. Items missing here show no numbers. */
  stats?: Record<string, ItemStats>;
  look: ShopLook;
  qrUrl: string | null;
  uploadsEnabled: boolean;
  /** Today's date as YYYY-MM-DD, from the server, for the notice strip. */
  today: string;
  /** The server's now, for "checked 12 min ago", and for telling a screen the browser kept from a fresh one. */
  now: Date;
  /** The owner's own CHIP account, as the read gives it. Never the key. */
  chip: ChipState;
  /**
   * From the server's orderState: why an open shop takes no orders now (null
   * while it may), and the number the next order will get, for the preview.
   */
  orders: { paused: string | null; nextNumber: number };
  /** The owner's vouchers, as the read gives them. */
  vouchers?: OwnerVoucher[];
  /** The owner's pickup places, as the read gives them. */
  pickupPlaces?: PickupPlaceView[];
  /** The tab to open on; Items when there is none. */
  initialTab?: Tab;
  /** The item open on its own screen: its id, 'new', or null for the Store itself. */
  editingId?: string | null;
  settingsApi: SettingsApi;
  itemsApi: ItemsApi;
  chipApi: ChipApi;
  vouchersApi: VouchersApi;
  pickupApi: PickupApi;
}) {
  const router = useRouter();
  // What the server's clock reads now, from when this screen was read: compared with when an item last changed.
  const mountedAt = useRef(Date.now());
  const serverNow = () => now.getTime() + (Date.now() - mountedAt.current);
  const { state, track } = useSaveStatus();
  const settingsApi = useMemo(() => trackedSettings(rawSettings, track), [rawSettings, track]);
  const itemsApi = useMemo(() => trackedItems(rawItems, track), [rawItems, track]);

  const vouchersApi = useMemo(() => trackedVouchers(rawVouchers, track), [rawVouchers, track]);
  const pickupApi = useMemo(() => trackedPickup(rawPickup, track), [rawPickup, track]);

  const [settings, setSettings] = useState(initial);
  const [qr, setQr] = useState({ has: Boolean(initial.paymentQrKey), url: qrUrl });
  const [chip, setChip] = useState(initialChip);
  const [items, setItems] = useState(initialItems);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const setList = (next: EditorItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const [vouchers, setVouchers] = useState(initialVouchers);
  const [tab, setTab] = useState<Tab>(initialTab);
  /** The item open on its own: an id, or 'new' until its first save gives it one; null on the Store itself. */
  const [editing, setEditing] = useState<string | null>(editingId);
  // "Saved" shows in the frame's top bar only while an item is open on its screen: the Store's main screen and
  // its other tabs say nothing there. Each item opens on a fresh screen, so a failure left by another is gone.
  usePublishSaveStatus(editing ? state : null);
  const [draftItem, setDraftItem] = useState<EditorItem | null>(null);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('item');
  /** A row tapped in the preview's shop: the Item screen shows it, until the owner opens another item. */
  const [picked, setPicked] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [openError, setOpenError] = useState('');
  const [halalError, setHalalError] = useState('');
  /** Asks the item cards for a filter (the first ready step shows what is hidden); `n` makes a repeat ask count. */
  const [showFilter, setShowFilter] = useState<{ filter: 'off'; n: number } | null>(null);

  // A screen the browser kept (Back, Forward) may be older than a change made since: ask for the current one.
  useEffect(() => {
    if (changedSince(now)) router.refresh();
    // On arrival only.
  }, []);

  /** Saves a patch and keeps what the API says the settings now are. */
  const save = async (patch: SettingsPatch) => {
    const next = await settingsApi.save(patch);
    setSettings(next);
    return next;
  };
  const description = useSettingText(settings.shopDescription ?? '', (text) => ({ shopDescription: orNull(text) }), save);

  /** What the owner's other items are filed under, for the category field to suggest. */
  const categories = [...new Set(items.filter((other) => other.id !== editing).map((other) => other.category).filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b),
  );
  const toggleHalal = async () => {
    setHalalError('');
    try {
      await save({ shopHalal: !settings.shopHalal });
    } catch (failure) {
      setHalalError(message(failure));
    }
  };

  const readiness = { ...settings, paymentQrKey: qr.has ? 'qr' : null, chipConnected: chip.connected, physicalItems: items.some((item) => item.kind !== 'DIGITAL') };
  const bankOk = Boolean(settings.bankName && settings.bankAccountName && settings.bankAccountNumber);
  const gaps = storeGaps(readiness);
  const live = items.filter((item) => item.available);
  const payOk = !gaps.includes('payment');
  const handOk = !gaps.includes('fulfilment');
  const blocked = !settings.enabled && gaps.length > 0;
  // Open but paused (deleted Alerts board): the shop still shows, its basket goes on WhatsApp, and this says why.
  const paused = settings.enabled ? orders.paused : null;
  const openState = paused || blocked ? 'blocked' : settings.enabled ? 'open' : 'closed';
  const openWords = settings.enabled
    ? (paused ?? 'Customers can order from your shop now.')
    : !payOk
      ? 'Add a way to pay to open'
      : !handOk
        ? 'Turn on pickup or delivery'
        : 'Closed. Switch on to take orders.';

  async function setOpen(next: boolean) {
    setOpenError('');
    try {
      await save({ enabled: next });
    } catch (failure) {
      setOpenError(message(failure));
    }
  }

  async function move(from: number, to: number) {
    const before = itemsRef.current;
    const next = [...before];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setList(next);
    setListError('');
    try {
      await itemsApi.reorder(next.map((item) => item.id));
    } catch (failure) {
      setList(before);
      setListError(message(failure));
    }
  }

  async function setAvailable(id: string, available: boolean) {
    setListError('');
    const swap = (value: boolean) => setList(itemsRef.current.map((item) => (item.id === id ? { ...item, available: value } : item)));
    swap(available);
    try {
      await itemsApi.update(id, { available });
    } catch (failure) {
      swap(!available);
      setListError(message(failure));
    }
  }

  function saved(item: EditorItem) {
    const list = itemsRef.current;
    setList(list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item]);
    markChanged(serverNow());
    // A new item has its id now: the address follows, so a reload or a shared link opens this item.
    if (window.location.pathname !== itemHref(item.id)) window.history.replaceState(null, '', itemHref(item.id));
    setEditing(item.id);
  }

  /** Back to the Store, which reads the items afresh. */
  const closeItem = () => router.push('/app/store');

  const editingItem = editing && editing !== 'new' ? (items.find((item) => item.id === editing) ?? null) : null;
  const editingIndex = editingItem ? items.indexOf(editingItem) : items.length;

  // The shop as a customer would see it, with the item being edited as it reads now.
  const shown = items.map((item) => (draftItem && item.id === draftItem.id ? draftItem : item));
  if (draftItem && !shown.some((item) => item.id === draftItem.id)) shown.push(draftItem);
  const previewFocus = shown.find((item) => item.id === picked) ?? draftItem ?? editingItem ?? live[0] ?? null;
  // What the phone shows: the chosen screen, or the shop when that one has nothing to show (no item
  // to open, nothing to pay for) -- also when the choice was made before the last item went.
  const shownTab: PreviewTab = (previewTab === 'pay' && live.length === 0) || (previewTab === 'item' && !previewFocus) ? 'shop' : previewTab;
  // Customers see the automatic vouchers that are on; the preview follows what the owner adds and switches.
  const liveVouchers = vouchers.filter((v) => v.mode === 'AUTO' && v.state === 'on');
  const previewItems = shown.filter((item) => item.available || (shownTab === 'item' && item.id === previewFocus?.id));

  // The preview's pill tells the truth about the switch: a shop that is off, or paused by its plan,
  // reads "Orders paused" and promises no day, rather than "Open for orders".
  const previewTakesOrders = settings.enabled && paused === null;
  const previewNextDay = nextOrderDay({ ...settings, canTakeOrders: previewTakesOrders }, new Date());
  // A paused shop honours no voucher, so the phone shows none either.
  const previewVouchers = previewTakesOrders ? liveVouchers : [];
  const [year, month, day] = today.split('-').map(Number);
  const todayDate = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1);

  if (editing) {
    return (
      <div className={ui.body}>
        <div className={ui.edit}>
          <ItemEditor
            key={editing === 'new' ? 'new' : editingItem?.id}
            item={editingItem}
            tint={editingIndex}
            uploadsEnabled={uploadsEnabled}
            paysOnline={chip.connected}
            categories={categories}
            api={itemsApi}
            shop={{ handle: look.handle, open: settings.enabled }}
            onSaved={saved}
            onPreview={setDraftItem}
            onRemoved={(id) => {
              setList(itemsRef.current.filter((item) => item.id !== id));
              markChanged(serverNow());
              closeItem();
            }}
            onClose={closeItem}
          />
        </div>

        <PreviewFrame
          label="Live preview of your shop"
          tabsLabel="Preview screen"
          tabs={[
            { id: 'shop', label: 'Shop' },
            // Nothing to open with no items: say so, rather than show the shop again under "Item".
            { id: 'item', label: 'Item', ...(previewFocus ? {} : { hint: 'Add an item to see its page here' }) },
            // An order of nothing (RM0) is not what a customer would ever see: Pay waits for an item too.
            { id: 'pay', label: 'Pay', ...(live.length > 0 ? {} : { hint: 'Add an item to see how paying looks' }) },
          ]}
          selected={shownTab}
          onSelect={setPreviewTab}
          note="How it looks in your shop."
        >
          {shownTab === 'pay' ? (
            <PayPreview
              look={look}
              settings={settings}
              items={live}
              qrUrl={qr.url}
              hasQr={qr.has}
              today={today}
              nextNumber={orders.nextNumber}
              paysOnline={chip.connected && chip.methods.length > 0}
            />
          ) : (
            // The shop and the item are the customer pages themselves, on the owner's own colours.
            <PageTheme theme={look} className={styles.previewStage}>
              <div className={styles.previewShop}>
                {shownTab === 'item' && previewFocus ? (
                  <ProductView
                    // A new key per item, so choosing another starts from its first size.
                    key={previewFocus.id}
                    handle={look.handle}
                    displayName={look.displayName}
                    language={look.language}
                    item={{ ...previewItem(previewFocus), photoUrls: previewFocus.photos.map((photo) => itemsApi.photoUrl(photo.squareKey)) }}
                    items={previewItems.map((i) => previewItem(i))}
                    halal={settings.shopHalal}
                    noticeDays={settings.minNoticeDays}
                    nextDay={previewNextDay}
                    vouchers={previewVouchers}
                    pickup={settings.pickupEnabled}
                    storageKey="curios-store-preview"
                    inline
                    onDone={() => setPreviewTab('shop')}
                  />
                ) : (
                  <>
                    <ShopPageView
                      key={shownTab}
                      handle={look.handle}
                      displayName={look.displayName}
                      language={look.language}
                      items={previewItems.map((i) => ({ ...previewItem(i), photoUrl: i.photoUrl }))}
                      pickupEnabled={settings.pickupEnabled}
                      pickupPlaces={pickupPlaces}
                      deliveryMode={settings.deliveryMode}
                      canTakeOrders={previewTakesOrders}
                      nextDay={previewNextDay}
                      vouchers={previewVouchers}
                      description={orNull(description.text)}
                      halal={settings.shopHalal}
                      avatarUrl={look.avatarUrl}
                      coverUrl={look.coverUrl}
                      preview={{
                        storageKey: 'curios-store-preview',
                        onOpenItem: (id) => {
                          setPicked(id);
                          setPreviewTab('item');
                        },
                      }}
                    />
                    <BasketBar
                      handle={look.handle}
                      displayName={look.displayName}
                      language={look.language}
                      items={previewItems.map((i) => previewItem(i))}
                      canTakeOrders
                      whatsapp={null}
                      note={false}
                      vouchers={previewVouchers}
                      // The board's bar: always there, and its Checkout turns the phone to the Pay screen.
                      preview={{ storageKey: 'curios-store-preview', onCheckout: () => setPreviewTab('pay') }}
                    />
                  </>
                )}
              </div>
            </PageTheme>
          )}
        </PreviewFrame>
      </div>
    );
  }

  const atMost = items.length >= MAX_ITEMS;
  const steps = [
    {
      ok: live.length > 0,
      title: 'Switch an item on',
      note: live.length > 0 ? `${live.length} ${live.length === 1 ? 'item' : 'items'} in your shop` : items.length > 0 ? 'No item is in your shop yet' : 'Add your first item',
      go: 'items' as const,
    },
    { ok: payOk, title: 'A way to pay', note: !payOk ? 'Connect CHIP or add your QR' : payWords(chip.connected, qr.has, bankOk), go: 'payment' as const },
    { ok: handOk, title: 'Getting it to them', note: handOk ? handOverWords(settings, readiness.physicalItems) : 'Turn on pickup or delivery', go: 'delivery' as const },
  ];

  return (
    <div className={styles.screen}>
      <div className={ui.edit}>
        <PageHead
          kicker="Your shop"
          title="Store"
          summary="What you sell, how people pay, and how it reaches them."
          below={
            <div className={styles.tabsRow}>
              <PillTabs
                label="Store"
                tabs={[
                  { id: 'items', label: 'Items', count: items.length || undefined },
                  { id: 'payment', label: 'Payment' },
                  { id: 'delivery', label: 'Pickup & delivery' },
                  // The board calls the vouchers tab Discounts; its panel and the links to it still say vouchers.
                  { id: 'vouchers', label: 'Discounts', count: vouchers.length || undefined },
                ]}
                selected={tab}
                onSelect={setTab}
              />
            </div>
          }
        >
          {settings.enabled ? (
            <a className={`${panel.secondaryLink} ${ui.headLink}`} href={`/${look.handle}/shop`} target="_blank" rel="noreferrer">
              See your shop
            </a>
          ) : null}
          {atMost ? (
            <button type="button" className={`${panel.primaryLink} ${ui.headLink}`} disabled title={`${MAX_ITEMS} items is the most a shop holds. Remove one to add another.`}>
              + Add item
            </button>
          ) : (
            <Link className={`${panel.primaryLink} ${ui.headLink}`} href={NEW_ITEM_HREF} prefetch={false}>
              + Add item
            </Link>
          )}
        </PageHead>

        <div className={ui.editBody}>
          <div role="tabpanel" id="panel-items" aria-labelledby="tab-items" hidden={tab !== 'items'} className={`${ui.panel} ${styles.panel} ${styles.panelWide}`}>
            <div className={styles.ready} data-state={openState}>
              <div className={styles.readyHead}>
                <div>
                  <b>Shop open</b>
                  <small>{openWords}</small>
                </div>
                <button
                  type="button"
                  className={ui.switch}
                  role="switch"
                  aria-checked={settings.enabled}
                  aria-label="Shop open"
                  title={blocked ? storeGapMessage(gaps) : undefined}
                  disabled={blocked}
                  onClick={() => void setOpen(!settings.enabled)}
                >
                  <i />
                </button>
              </div>
              {openError ? (
                <p className={styles.openError} role="alert">
                  {openError}
                </p>
              ) : null}
              <ul className={styles.steps} aria-label="Ready to take orders">
                {steps.map((step) => (
                  <li key={step.title}>
                    <button
                      type="button"
                      className={styles.step}
                      data-ok={step.ok}
                      onClick={() => {
                        setTab(step.go);
                        if (step.go === 'items' && items.some((item) => !item.available)) setShowFilter((was) => ({ filter: 'off', n: (was?.n ?? 0) + 1 }));
                      }}
                    >
                      <span className={styles.stepDot} aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                          <path d={step.ok ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 7v6M12 17h.01'} />
                        </svg>
                      </span>
                      <span className={styles.stepText}>
                        <b>{step.title}</b>
                        <span>{step.note}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <section className={ui.section} aria-labelledby="about-title">
              <SectionHead id="about-title" title="About your shop" note="Shown above your items. Tell people what to know before they order." />
              <div className={ui.float}>
                <label>
                  <em>About</em>
                  <textarea
                    value={description.text}
                    style={{ height: 76 }}
                    placeholder="What you sell, and anything customers should know first"
                    onChange={(event) => description.change(event.target.value)}
                  />
                </label>
                <small aria-hidden="true" data-over={[...description.text].length > SHOP_DESCRIPTION_MAX || undefined}>
                  {[...description.text].length}/{SHOP_DESCRIPTION_MAX}
                </small>
              </div>
              <SaveState status={description.autosave.status} error={description.autosave.error} retry={description.autosave.retry} />
              <div className={`${styles.row} ${styles.halalRow}`}>
                <span className={styles.rowText}>
                  <b>Halal shop</b>
                  <span>{settings.shopHalal ? 'Your shop and its items say halal' : 'Switch on if everything you sell is halal'}</span>
                </span>
                <button type="button" className={ui.switch} role="switch" aria-checked={settings.shopHalal} aria-label="Halal shop" onClick={() => void toggleHalal()}>
                  <i />
                </button>
              </div>
              {halalError ? (
                <p className={styles.openError} role="alert">
                  {halalError}
                </p>
              ) : null}
            </section>

            <ItemsList items={items} stats={stats} showFilter={showFilter} error={listError} onMove={(from, to) => void move(from, to)} onAvailable={(id, available) => void setAvailable(id, available)} />
          </div>

          <div role="tabpanel" id="panel-payment" aria-labelledby="tab-payment" hidden={tab !== 'payment'} className={`${ui.panel} ${styles.panel}`}>
            <PaymentTab
              displayName={look.displayName}
              settings={settings}
              save={save}
              qr={qr}
              uploadsEnabled={uploadsEnabled}
              uploadQr={settingsApi.uploadQr}
              removeQr={settingsApi.removeQr}
              onQr={setQr}
              chip={chip}
              chipApi={chipApi}
              onChip={setChip}
              now={now}
            />
          </div>

          <div role="tabpanel" id="panel-delivery" aria-labelledby="tab-delivery" hidden={tab !== 'delivery'} className={`${ui.panel} ${styles.panel}`}>
            <DeliveryTab settings={settings} save={save} today={todayDate} places={pickupPlaces} pickupApi={pickupApi} />
          </div>

          <div role="tabpanel" id="panel-vouchers" aria-labelledby="tab-vouchers" hidden={tab !== 'vouchers'} className={`${ui.panel} ${styles.panel}`}>
            <VouchersTab vouchers={vouchers} items={items} api={vouchersApi} onChange={setVouchers} />
          </div>
        </div>
      </div>
    </div>
  );
}
