'use client';

import { apiFetch } from '../../../lib/api.js';
import { joinAvatarUrl } from '../../../lib/avatar-url.js';
import { resizeContained, resizeImage } from '../curios/resize-image.js';
import { StoreEditor } from './store-editor.js';
import type { ChipApi, ChipState, EditorItem, ItemRow, ItemsApi, SettingsApi, ShopLook, StoreSettings } from './store-types.js';

/**
 * Supplies the real API calls. Thin on purpose: a Server Component cannot hand
 * functions to a Client Component, so page.tsx passes plain values and the
 * closures over apiFetch are built here. `publicBase` is STORAGE_PUBLIC_URL,
 * read server-side.
 */
export function StoreScreen({
  initial,
  items,
  look,
  qrUrl,
  uploadsEnabled,
  publicBase,
  today,
  now,
  chip,
  orders,
  initialTab,
}: {
  initial: StoreSettings;
  items: EditorItem[];
  look: ShopLook;
  qrUrl: string | null;
  uploadsEnabled: boolean;
  publicBase: string;
  today: string;
  now: Date;
  chip: ChipState;
  orders: { paused: string | null; nextNumber: number };
  /** The tab to open on (`?tab=payment`); Items when there is none. */
  initialTab?: 'items' | 'payment' | 'delivery';
}) {
  const settingsApi: SettingsApi = {
    save: async (patch) => (await apiFetch<{ settings: StoreSettings }>('/store/settings', { method: 'PATCH', body: JSON.stringify(patch) })).settings,
    uploadQr: async (file) => {
      const image = await resizeContained(file);
      const { paymentQrKey } = await apiFetch<{ paymentQrKey: string }>('/store/payment-qr', { method: 'POST', body: JSON.stringify(image) });
      return joinAvatarUrl(publicBase, paymentQrKey);
    },
    removeQr: async () => {
      await apiFetch('/store/payment-qr', { method: 'DELETE' });
    },
  };

  const itemsApi: ItemsApi = {
    add: async (input) => (await apiFetch<{ item: ItemRow }>('/store/items', { method: 'POST', body: JSON.stringify(input) })).item,
    update: async (id, patch) => (await apiFetch<{ item: ItemRow }>(`/store/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).item,
    remove: async (id) => {
      await apiFetch(`/store/items/${id}`, { method: 'DELETE' });
    },
    reorder: async (ids) => {
      await apiFetch('/store/items/order', { method: 'PUT', body: JSON.stringify({ ids }) });
    },
    uploadPhoto: async (id, file) => {
      const image = await resizeImage(file);
      const { photoKey } = await apiFetch<{ photoKey: string }>(`/store/items/${id}/photo`, { method: 'POST', body: JSON.stringify(image) });
      return joinAvatarUrl(publicBase, photoKey);
    },
    removePhoto: async (id) => {
      await apiFetch(`/store/items/${id}/photo`, { method: 'DELETE' });
    },
  };

  // The secret key goes out once, in POST /store/chip, and nothing ever reads it back.
  const chipApi: ChipApi = {
    connect: async (brandId, secretKey) => {
      const next = await apiFetch<Omit<ChipState, 'checkedAt'> & { checkedAt: string }>('/store/chip', { method: 'POST', body: JSON.stringify({ brandId, secretKey }) });
      return { connected: next.connected, brandName: next.brandName, methods: next.methods, checkedAt: new Date(next.checkedAt), isTest: next.isTest };
    },
    disconnect: async () => {
      await apiFetch('/store/chip', { method: 'DELETE' });
    },
    test: async () => (await apiFetch<{ url: string }>('/store/chip/test', { method: 'POST' })).url,
  };

  return (
    <StoreEditor
      initial={initial}
      items={items}
      look={look}
      qrUrl={qrUrl}
      uploadsEnabled={uploadsEnabled}
      today={today}
      now={now}
      chip={chip}
      orders={orders}
      initialTab={initialTab}
      settingsApi={settingsApi}
      itemsApi={itemsApi}
      chipApi={chipApi}
    />
  );
}
