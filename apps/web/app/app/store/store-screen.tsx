'use client';

import { useState } from 'react';
import type { OwnerStore } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { joinAvatarUrl } from '../../../lib/avatar-url.js';
import { resizeContained, resizeImage } from '../curios/resize-image.js';
import { ItemsEditor, type EditorItem, type ItemRow, type ItemsApi } from './items-editor.js';
import { StoreSettingsForm, type StoreSettingsApi } from './store-settings.js';
import styles from './store.module.css';

/**
 * Supplies the real API calls, and is the client half the items editor
 * joins under the settings. Thin on purpose: a Server Component cannot hand
 * functions to a Client Component, so page.tsx passes plain values and the
 * closures over apiFetch are built here. `publicBase` is STORAGE_PUBLIC_URL,
 * read server-side.
 */
export function StoreScreen({
  initial,
  handle,
  uploadsEnabled,
  publicBase,
  qrUrl,
  items,
}: {
  initial: OwnerStore['settings'];
  handle: string;
  uploadsEnabled: boolean;
  publicBase: string;
  qrUrl: string | null;
  items: EditorItem[];
}) {
  const [open, setOpen] = useState(initial.enabled);
  const api: StoreSettingsApi = {
    save: async (patch) =>
      (await apiFetch<{ settings: OwnerStore['settings'] }>('/store/settings', { method: 'PATCH', body: JSON.stringify(patch) })).settings,
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

  return (
    <div>
      {open ? (
        <p className={styles.links}>
          <a href={`/${handle}/shop`}>See your shop</a>
        </p>
      ) : null}
      <StoreSettingsForm initial={initial} uploadsEnabled={uploadsEnabled} qrUrl={qrUrl} api={api} onSaved={(saved) => setOpen(saved.enabled)} />
      <ItemsEditor items={items} uploadsEnabled={uploadsEnabled} api={itemsApi} />
    </div>
  );
}
