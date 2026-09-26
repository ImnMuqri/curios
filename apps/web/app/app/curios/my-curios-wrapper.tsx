'use client';

import type { MyCurios as MyCuriosData } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { MyCuriosEditor, type CuriosApi } from './my-curios.js';
import type { LinkItem } from './links-editor.js';

/**
 * Supplies the real API calls. Thin on purpose: a Server Component cannot hand
 * functions to a Client Component, so page.tsx passes plain values and the
 * closures over apiFetch are built here.
 */
export function MyCurios({ initial, uploadsEnabled }: { initial: MyCuriosData & { avatarUrl: string | null }; uploadsEnabled: boolean }) {
  const api: CuriosApi = {
    addLink: async (input) => (await apiFetch<{ link: LinkItem }>('/links', { method: 'POST', body: JSON.stringify(input) })).link,
    updateLink: async (id, patch) => (await apiFetch<{ link: LinkItem }>(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).link,
    removeLink: async (id) => { await apiFetch(`/links/${id}`, { method: 'DELETE' }); },
    reorder: async (ids) => { await apiFetch('/links/order', { method: 'PUT', body: JSON.stringify({ ids }) }); },
    saveAppearance: (patch) => apiFetch('/pages/appearance', { method: 'PATCH', body: JSON.stringify(patch) }),
    uploadAvatar: async () => null, // Task 9
    removeAvatar: async () => undefined, // Task 9
  };
  return <MyCuriosEditor initial={initial} api={api} uploadsEnabled={uploadsEnabled} />;
}
