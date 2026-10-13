'use client';

import type { MyCurios as MyCuriosData } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { coverUrlFrom, joinAvatarUrl } from '../../../lib/avatar-url.js';
import { resizeCover, resizeImage } from './resize-image.js';
import { MyCuriosEditor, type CuriosApi } from './my-curios.js';
import type { LinkItem } from './links-editor.js';

/**
 * Supplies the real API calls. Thin on purpose: a Server Component cannot hand
 * functions to a Client Component, so page.tsx passes plain values and the
 * closures over apiFetch are built here.
 *
 * `publicBase` is `STORAGE_PUBLIC_URL`, read server-side in page.tsx -- a
 * Client Component cannot read a non-NEXT_PUBLIC_ env var itself, so it
 * arrives as a plain prop instead.
 */
export function MyCurios({
  initial,
  uploadsEnabled,
  publicBase,
}: {
  initial: MyCuriosData & { avatarUrl: string | null; coverUrl: string | null; shopPhotoUrl: string | null };
  uploadsEnabled: boolean;
  publicBase: string;
}) {
  const avatarUrlFromKey = (key: string) => joinAvatarUrl(publicBase, key);

  const api: CuriosApi = {
    addLink: async (input) => (await apiFetch<{ link: LinkItem }>('/links', { method: 'POST', body: JSON.stringify(input) })).link,
    updateLink: async (id, patch) => (await apiFetch<{ link: LinkItem }>(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).link,
    removeLink: async (id) => { await apiFetch(`/links/${id}`, { method: 'DELETE' }); },
    reorder: async (ids) => { await apiFetch('/links/order', { method: 'PUT', body: JSON.stringify({ ids }) }); },
    saveAppearance: (patch) => apiFetch('/pages/appearance', { method: 'PATCH', body: JSON.stringify(patch) }),
    uploadAvatar: async (file) => {
      const image = await resizeImage(file);
      const { avatarKey } = await apiFetch<{ avatarKey: string }>('/pages/avatar', { method: 'POST', body: JSON.stringify(image) });
      return avatarUrlFromKey(avatarKey);
    },
    removeAvatar: async () => { await apiFetch('/pages/avatar', { method: 'DELETE' }); },
    chooseStockCover: async (name) => {
      const { coverKey } = await apiFetch<{ coverKey: string }>('/pages/cover/stock', { method: 'PUT', body: JSON.stringify({ name }) });
      return { coverKey, coverUrl: coverUrlFrom(coverKey, publicBase || null) };
    },
    uploadCover: async (file) => {
      const image = await resizeCover(file);
      const { coverKey } = await apiFetch<{ coverKey: string }>('/pages/cover', { method: 'POST', body: JSON.stringify(image) });
      return { coverKey, coverUrl: coverUrlFrom(coverKey, publicBase || null) };
    },
    removeCover: async () => { await apiFetch('/pages/cover', { method: 'DELETE' }); },
  };
  return <MyCuriosEditor initial={initial} api={api} uploadsEnabled={uploadsEnabled} />;
}
