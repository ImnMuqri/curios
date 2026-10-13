'use client';

import type { OwnerStore } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { joinAvatarUrl } from '../../../lib/avatar-url.js';
import { resizeImage } from '../curios/resize-image.js';
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
}: {
  initial: OwnerStore['settings'];
  handle: string;
  uploadsEnabled: boolean;
  publicBase: string;
  qrUrl: string | null;
}) {
  const api: StoreSettingsApi = {
    save: async (patch) =>
      (await apiFetch<{ settings: OwnerStore['settings'] }>('/store/settings', { method: 'PATCH', body: JSON.stringify(patch) })).settings,
    uploadQr: async (file) => {
      const image = await resizeImage(file);
      const { paymentQrKey } = await apiFetch<{ paymentQrKey: string }>('/store/payment-qr', { method: 'POST', body: JSON.stringify(image) });
      return joinAvatarUrl(publicBase, paymentQrKey);
    },
    removeQr: async () => {
      await apiFetch('/store/payment-qr', { method: 'DELETE' });
    },
  };

  return (
    <div>
      {initial.enabled ? (
        <p className={styles.links}>
          <a href={`/${handle}/shop`}>See your shop</a>
        </p>
      ) : null}
      <StoreSettingsForm initial={initial} uploadsEnabled={uploadsEnabled} qrUrl={qrUrl} publicBase={publicBase} api={api} />
    </div>
  );
}
