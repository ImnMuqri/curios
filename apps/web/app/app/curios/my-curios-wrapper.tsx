'use client';

import { apiFetch } from '../../../lib/api.js';
import { sendFile } from '../../../lib/send-file.js';
import { coverUrlFrom, joinAvatarUrl } from '../../../lib/avatar-url.js';
import { resizeCover, resizeImage } from './resize-image.js';
import { MyCuriosEditor, type CuriosApi, type EditorPage } from './my-curios.js';
import { Publish } from '../review/publish-button.js';
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
  publicUrl,
  published,
}: {
  initial: EditorPage;
  uploadsEnabled: boolean;
  publicBase: string;
  publicUrl: string;
  published: boolean;
}) {
  const avatarUrlFromKey = (key: string) => joinAvatarUrl(publicBase, key);

  const api: CuriosApi = {
    addLink: async (input) => (await apiFetch<{ link: LinkItem }>('/links', { method: 'POST', body: JSON.stringify(input) })).link,
    addWidget: async (input) => (await apiFetch<{ link: LinkItem }>('/links/widgets', { method: 'POST', body: JSON.stringify(input) })).link,
    updateLink: async (id, patch) => (await apiFetch<{ link: LinkItem }>(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).link,
    removeLink: async (id) => { await apiFetch(`/links/${id}`, { method: 'DELETE' }); },
    createGallery: async (input) => (await apiFetch<{ link: LinkItem }>('/links/pictures', { method: 'POST', body: JSON.stringify(input) })).link,
    // The file is the raw body, as item photos are; a bare Blob so only its type goes out as the content type.
    addPicture: async (id, file, onProgress) => (await sendFile<{ link: LinkItem }>(`/links/${id}/pictures`, file.slice(0, file.size, file.type), onProgress)).link,
    removePicture: async (id, pictureId) => (await apiFetch<{ link: LinkItem }>(`/links/${id}/pictures/${pictureId}`, { method: 'DELETE' })).link,
    reorderPictures: async (id, ids) => (await apiFetch<{ link: LinkItem }>(`/links/${id}/pictures/order`, { method: 'PUT', body: JSON.stringify({ ids }) })).link,
    reorder: async (ids) => { await apiFetch('/links/order', { method: 'PUT', body: JSON.stringify({ ids }) }); },
    setShopOpen: async (enabled) => { await apiFetch('/store/settings', { method: 'PATCH', body: JSON.stringify({ enabled }) }); },
    setShopSize: async (tileSize) => { await apiFetch('/store/settings', { method: 'PATCH', body: JSON.stringify({ tileSize }) }); },
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
    askPage: (question) => apiFetch<{ reply: string }>('/chat/test', { method: 'POST', body: JSON.stringify({ question, history: [] }) }),
  };
  return (
    <MyCuriosEditor
      initial={initial}
      api={api}
      uploadsEnabled={uploadsEnabled}
      publicUrl={publicUrl}
      storageBase={publicBase}
      // Until the page is public, the editor carries the same Publish card as Review (owner, 28 Nov 2026).
      publish={published ? undefined : <Publish publicUrl={publicUrl} published={false} />}
    />
  );
}
