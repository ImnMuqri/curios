import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ItemsApi } from './store-types.js';

const apiFetch = vi.fn();
const sendFile = vi.fn();
vi.mock('../../../lib/api.js', () => ({ apiFetch, API_BASE: 'https://api.example', ApiError: class extends Error {} }));
vi.mock('../../../lib/send-file.js', () => ({ sendFile }));
vi.mock('../curios/resize-image.js', () => ({ prepareOriginal: vi.fn(), resizeImage: vi.fn(), resizeContained: vi.fn() }));

// The screen builds the API and hands it to the editor; this takes it off the editor's props.
let itemsApi: ItemsApi;
vi.mock('./store-editor.js', () => ({
  StoreEditor: (props: { itemsApi: ItemsApi }) => {
    itemsApi = props.itemsApi;
    return null;
  },
}));

const { StoreScreen } = await import('./store-screen.js');

describe('the Store screen photo calls', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    sendFile.mockReset();
    const props: Parameters<typeof StoreScreen>[0] = { publicBase: 'https://files.example/', items: [], initial: {} as never, look: {} as never, chip: {} as never, orders: {} as never, qrUrl: null, uploadsEnabled: true, today: '2026-10-16', now: new Date() };
    render(<StoreScreen {...props} />);
  });

  it('replaces, recrops, removes and reorders, and builds the cover and original URLs', async () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    const frame = { x: 0.125, y: 0, size: 1 };
    apiFetch.mockResolvedValue({ photos: [], photoKey: null });
    sendFile.mockResolvedValue({ photos: [], photoKey: null });

    await itemsApi.replacePhoto('a', 'p1', blob, frame);
    expect(sendFile).toHaveBeenCalledWith('/store/items/a/photos/p1/picture', blob, expect.any(Function), { 'x-photo-frame': '0.125,0,1' });
    await itemsApi.recropPhoto('a', 'p1', frame);
    expect(apiFetch).toHaveBeenCalledWith('/store/items/a/photos/p1/frame', { method: 'PUT', body: JSON.stringify(frame) });
    await itemsApi.removePhoto('a', 'p1');
    expect(apiFetch).toHaveBeenCalledWith('/store/items/a/photos/p1', { method: 'DELETE' });
    await itemsApi.reorderPhotos('a', ['p2', 'p1']);
    expect(apiFetch).toHaveBeenCalledWith('/store/items/a/photos/order', { method: 'PUT', body: JSON.stringify({ ids: ['p2', 'p1'] }) });
    expect(itemsApi.photoUrl('items/a.webp')).toBe('https://files.example/items/a.webp');
    expect(itemsApi.originalUrl('a', 'p1')).toBe('https://api.example/store/items/a/photos/p1/original');
  });
});
