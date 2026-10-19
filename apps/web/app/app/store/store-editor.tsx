'use client';

import { useMemo, useRef, useState } from 'react';
import { SHOP_DESCRIPTION_MAX, formatRinggit, storeGapMessage, storeGaps } from '@curios/core/store';
import { BentoPage } from '../../_bento/BentoPage.js';
import { ShopView } from '../../[handle]/shop/shop-view.js';
import { PageHead } from '../_ui/page-head.js';
import { PreviewFrame } from '../_ui/preview-frame.js';
import { SaveState } from '../_ui/save-state.js';
import { SaveStatus, useSaveStatus, type SaveTrack } from '../_ui/save-status.js';
import { SectionHead } from '../_ui/section-head.js';
import { UnderlineTabs } from '../_ui/underline-tabs.js';
import ui from '../_ui/editor.module.css';
import panel from '../panel.module.css';
import { DeliveryTab } from './delivery-tab.js';
import { ItemEditor } from './item-editor.js';
import { ItemsList } from './items-list.js';
import { PayPreview } from './pay-preview.js';
import { PaymentTab } from './payment-tab.js';
import { orNull, useSettingText } from './setting-field.js';
import type { EditorItem, ItemsApi, SettingsApi, SettingsPatch, ShopLook, StoreSettings } from './store-types.js';
import styles from './store.module.css';

const TABS = [
  { id: 'items', label: 'Items' },
  { id: 'payment', label: 'Payment' },
  { id: 'delivery', label: 'Pickup & delivery' },
] as const;
type Tab = (typeof TABS)[number]['id'];
type PreviewTab = 'shop' | 'item' | 'pay';

/** What the phone shows for an editing tab, as the board turns it: the shop for Items, the order page for the rest. */
const previewFor = (tab: Tab): PreviewTab => (tab === 'items' ? 'shop' : 'pay');

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

function trackedItems(api: ItemsApi, track: SaveTrack): ItemsApi {
  return {
    add: (input) => track(api.add(input)),
    update: (id, patch) => track(api.update(id, patch)),
    remove: (id) => track(api.remove(id)),
    reorder: (ids) => track(api.reorder(ids)),
    uploadPhoto: (id, file) => track(api.uploadPhoto(id, file)),
    removePhoto: (id) => track(api.removePhoto(id)),
  };
}

function trackedSettings(api: SettingsApi, track: SaveTrack): SettingsApi {
  return {
    save: (patch) => track(api.save(patch)),
    uploadQr: (file) => track(api.uploadQr(file)),
    removeQr: () => track(api.removeQr()),
  };
}

/** "Pickup and delivery RM10", "Rider delivery", ...: what "Getting it to them" says once it is set. */
function handOverWords(s: StoreSettings): string {
  const parts = [
    ...(s.pickupEnabled ? ['pickup'] : []),
    ...(s.deliveryMode === 'FLAT' && s.deliveryFeeCents ? [`delivery ${formatRinggit(s.deliveryFeeCents)}`] : s.deliveryMode === 'RIDER' ? ['rider delivery'] : []),
  ].join(' and ');
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

/**
 * Store: the shop on the owner's page, arranged. The header says whether
 * everything has saved and whether the shop is open; a strip under it says
 * what the shop still needs; three tabs hold the items, how customers pay,
 * and how they get their order. Every change saves as it is made. The phone
 * beside it is the real shop, as a customer would see it.
 */
export function StoreEditor({
  initial,
  items: initialItems,
  look,
  qrUrl,
  uploadsEnabled,
  today,
  orders,
  settingsApi: rawSettings,
  itemsApi: rawItems,
}: {
  initial: StoreSettings;
  items: EditorItem[];
  look: ShopLook;
  qrUrl: string | null;
  uploadsEnabled: boolean;
  /** Today's date as YYYY-MM-DD, from the server, for the notice strip. */
  today: string;
  /**
   * From the server's orderState: why an open shop takes no orders now (null
   * while it may), and the number the next order will get, for the preview.
   */
  orders: { paused: string | null; nextNumber: number };
  settingsApi: SettingsApi;
  itemsApi: ItemsApi;
}) {
  const { state, track } = useSaveStatus();
  const settingsApi = useMemo(() => trackedSettings(rawSettings, track), [rawSettings, track]);
  const itemsApi = useMemo(() => trackedItems(rawItems, track), [rawItems, track]);

  const [settings, setSettings] = useState(initial);
  const [qr, setQr] = useState({ has: Boolean(initial.paymentQrKey), url: qrUrl });
  const [items, setItems] = useState(initialItems);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const setList = (next: EditorItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const [tab, setTab] = useState<Tab>('items');
  /** The item open on its own: an id, 'new', or null for the list. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draftItem, setDraftItem] = useState<EditorItem | null>(null);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('shop');
  const [listError, setListError] = useState('');
  const [openError, setOpenError] = useState('');

  /** Saves a patch and keeps what the API says the settings now are. */
  const save = async (patch: SettingsPatch) => {
    const next = await settingsApi.save(patch);
    setSettings(next);
    return next;
  };
  const description = useSettingText(settings.shopDescription ?? '', (text) => ({ shopDescription: orNull(text) }), save);

  const readiness = { ...settings, paymentQrKey: qr.has ? 'qr' : null };
  const gaps = storeGaps(readiness);
  const live = items.filter((item) => item.available);
  const payOk = !gaps.includes('payment');
  const handOk = !gaps.includes('fulfilment');
  const blocked = !settings.enabled && gaps.length > 0;
  // Open but paused (Alerts board): the shop still shows, its basket goes on WhatsApp, and this says why.
  const paused = settings.enabled ? orders.paused : null;
  const openState = paused || blocked ? 'blocked' : settings.enabled ? 'open' : 'closed';
  const openWords = settings.enabled
    ? (paused ?? 'Open for orders')
    : !payOk
      ? 'Add a way to pay to open'
      : !handOk
        ? 'Turn on pickup or delivery'
        : 'Closed';

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

  function openItem(id: string | null) {
    setEditing(id);
    setDraftItem(null);
    setPreviewTab(id ? 'item' : 'shop');
  }

  function showTab(next: Tab) {
    setTab(next);
    openItem(null);
    setPreviewTab(previewFor(next));
  }

  function saved(item: EditorItem) {
    const list = itemsRef.current;
    setList(list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item]);
    // A new item has its id now; keep the editor on it.
    setEditing(item.id);
  }

  const editingItem = editing && editing !== 'new' ? (items.find((item) => item.id === editing) ?? null) : null;
  const editingIndex = editingItem ? items.indexOf(editingItem) : items.length;

  // The shop as a customer would see it, with the item being edited as it reads now.
  const shown = items.map((item) => (draftItem && item.id === draftItem.id ? draftItem : item));
  if (draftItem && !shown.some((item) => item.id === draftItem.id)) shown.push(draftItem);
  const previewFocus = draftItem ?? editingItem ?? live[0] ?? null;
  const previewItems = shown.filter((item) => item.available || (previewTab === 'item' && item.id === previewFocus?.id));

  const [year, month, day] = today.split('-').map(Number);
  const todayDate = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1);

  return (
    <>
      <PageHead title="Store" beside={<SaveStatus state={state} />}>
        <span className={ui.url}>curios.my/{look.handle}/shop</span>
        <span className={styles.open} data-state={openState}>
          <span className={styles.pulse} aria-hidden="true" />
          <span>{openWords}</span>
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
        </span>
        {settings.enabled ? (
          <a className={panel.primaryLink} href={`/${look.handle}/shop`} target="_blank" rel="noreferrer">
            See your shop
          </a>
        ) : null}
      </PageHead>
      {openError ? (
        <p className={styles.openError} role="alert">
          {openError}
        </p>
      ) : null}

      <div className={ui.body}>
        <div className={ui.edit}>
          <ul className={styles.ready} aria-label="Ready to take orders">
            {[
              { ok: live.length > 0, title: 'Items', note: live.length > 0 ? `${live.length} in your shop` : items.length > 0 ? 'Switch an item on' : 'Add your first item', go: 'items' as const },
              { ok: payOk, title: 'A way to pay', note: !payOk ? 'Add a QR or bank account' : qr.has && settings.bankName && settings.bankAccountName && settings.bankAccountNumber ? 'QR and bank account' : qr.has ? 'DuitNow QR' : 'Bank account', go: 'payment' as const },
              { ok: handOk, title: 'Getting it to them', note: handOk ? handOverWords(settings) : 'Turn on pickup or delivery', go: 'delivery' as const },
            ].map((step) => (
              <li key={step.title}>
                <button
                  type="button"
                  className={styles.step}
                  data-ok={step.ok}
                  onClick={() => showTab(step.go)}
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

          <UnderlineTabs
            label="Store"
            tabs={TABS}
            selected={tab}
            width={150}
            onSelect={showTab}
          />

          <div role="tabpanel" id="panel-items" aria-labelledby="tab-items" hidden={tab !== 'items'} className={ui.panel}>
            {editing ? (
              <ItemEditor
                key={editing === 'new' ? 'new' : editingItem?.id}
                item={editingItem}
                tint={editingIndex}
                uploadsEnabled={uploadsEnabled}
                api={itemsApi}
                onSaved={saved}
                onPreview={setDraftItem}
                onRemoved={(id) => {
                  setList(itemsRef.current.filter((item) => item.id !== id));
                  openItem(null);
                }}
                onClose={() => openItem(null)}
              />
            ) : (
              <>
                <section className={ui.section} aria-labelledby="about-title">
                  <SectionHead id="about-title" icon="message" tone="biru" title="About your shop" note="Shown above your items, before the notice" />
                  <div className={ui.float}>
                    <label>
                      <em>Shop description</em>
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
                </section>
                <ItemsList
                  items={items}
                  error={listError}
                  onMove={(from, to) => void move(from, to)}
                  onAvailable={(id, available) => void setAvailable(id, available)}
                  onEdit={openItem}
                  onAdd={() => openItem('new')}
                />
              </>
            )}
          </div>

          <div role="tabpanel" id="panel-payment" aria-labelledby="tab-payment" hidden={tab !== 'payment'} className={ui.panel}>
            <PaymentTab
              settings={settings}
              save={save}
              qr={qr}
              uploadsEnabled={uploadsEnabled}
              uploadQr={settingsApi.uploadQr}
              removeQr={settingsApi.removeQr}
              onQr={setQr}
            />
          </div>

          <div role="tabpanel" id="panel-delivery" aria-labelledby="tab-delivery" hidden={tab !== 'delivery'} className={ui.panel}>
            <DeliveryTab settings={settings} save={save} today={todayDate} />
          </div>
        </div>

        <PreviewFrame
          label="Live preview of your shop"
          tabsLabel="Preview screen"
          tabs={[
            { id: 'shop', label: 'Shop' },
            { id: 'item', label: 'Item' },
            { id: 'pay', label: 'Pay' },
          ]}
          selected={previewTab}
          onSelect={setPreviewTab}
        >
          {previewTab === 'pay' ? (
            <PayPreview
              look={look}
              settings={settings}
              items={live}
              qrUrl={qr.url}
              hasQr={qr.has}
              today={today}
              nextNumber={orders.nextNumber}
            />
          ) : (
            <BentoPage
              displayName={look.displayName}
              handle={look.handle}
              bio={look.bio}
              avatarUrl={look.avatarUrl}
              coverUrl={look.coverUrl}
              links={[]}
              style={look.style}
              accentColor={look.accentColor}
              headingFont={look.headingFont}
              background={look.background}
              backgroundColor={look.backgroundColor}
              language={look.language}
              socials={look.socials}
              shop={{ position: 0, size: null, label: '', caption: '', photoUrl: null }}
              mode="shop"
              interactive={false}
              nameAs="p"
            >
              <div className={styles.previewShop}>
                <ShopView
                  // A new key per screen and focused item, so Item opens that item's sheet.
                  key={`${previewTab}:${previewTab === 'item' ? (previewFocus?.id ?? '') : ''}`}
                  handle={look.handle}
                  displayName={look.displayName}
                  language={look.language}
                  items={previewItems}
                  whatsapp={look.whatsapp}
                  description={orNull(description.text)}
                  pickupEnabled={settings.pickupEnabled}
                  pickupNote={settings.pickupNote}
                  deliveryMode={settings.deliveryMode}
                  deliveryFeeCents={settings.deliveryFeeCents}
                  minNoticeDays={settings.minNoticeDays}
                  initialItemId={previewTab === 'item' ? (previewFocus?.id ?? null) : null}
                  showBack={false}
                  variant="embedded"
                  sheet="inline"
                  storageKey="curios-store-preview"
                  // The board's bar: always there, and its Checkout turns the phone to the Pay screen.
                  onCheckout={() => setPreviewTab('pay')}
                />
              </div>
            </BentoPage>
          )}
        </PreviewFrame>
      </div>
    </>
  );
}

