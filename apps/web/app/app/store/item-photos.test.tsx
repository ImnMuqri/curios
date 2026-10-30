import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('../curios/resize-image.js', () => ({
  prepareOriginal: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/webp' }), width: 1000, height: 750 })),
}));

const { ItemPhotos } = await import('./item-photos.js');
import { PHYSICAL_ITEM, type EditorItem, type ItemsApi, type OwnerPhoto } from './store-types.js';

afterEach(cleanup);
URL.createObjectURL = vi.fn(() => 'blob:x');
URL.revokeObjectURL = vi.fn();
class TestPointer extends MouseEvent {
  isPrimary = true;
}
const point = (type: string, over: MouseEventInit = {}) => new TestPointer(type, { bubbles: true, button: 0, ...over });
/** Presses on one square, moves, and lets go over another (elementFromPoint has no layout in jsdom). */
function drag(from: HTMLElement, to: HTMLElement, travel = 30) {
  document.elementFromPoint = vi.fn(() => to);
  fireEvent(from, point('pointerdown', { clientX: 0, clientY: 0 }));
  fireEvent(window, point('pointermove', { clientX: travel, clientY: 0 }));
  fireEvent(window, point('pointerup', { clientX: travel, clientY: 0 }));
}

const photo = (id: string): OwnerPhoto => ({ id, squareKey: `items/a/${id}.webp`, width: 1000, height: 750, frame: { x: 0.1, y: 0, size: 0.8 } });
const item = (photos: OwnerPhoto[], over: Partial<EditorItem> = {}): EditorItem => ({
  ...PHYSICAL_ITEM, id: 'a', name: 'Kek', slug: 'a', category: null, tag: null, sku: null, description: null, priceCents: 900, options: [], available: true,
  photoKey: photos[0]?.squareKey ?? null, photoUrl: photos[0] ? 'https://files.example/cover.webp' : null, photos, ...over,
});
const result = { photos: [photo('p1'), photo('p2')], photoKey: 'k' };

function show(current: EditorItem | null, over: Partial<ItemsApi> = {}, uploadsEnabled = true) {
  const api = {
    addPhoto: vi.fn(async () => result),
    recropPhoto: vi.fn(async () => result),
    replacePhoto: vi.fn(async () => result),
    removePhoto: vi.fn(async () => result),
    reorderPhotos: vi.fn(async () => result),
    photoUrl: vi.fn((key: string) => `https://files.example/${key}`),
    originalUrl: vi.fn((id: string, photoId: string) => `/original/${id}/${photoId}`),
    ...over,
  } as unknown as ItemsApi;
  const onChange = vi.fn();
  const onError = vi.fn();
  render(<ItemPhotos item={current} tint={0} uploadsEnabled={uploadsEnabled} api={api} onChange={onChange} onError={onError} />);
  return { api, onChange, onError };
}

const pick = async () => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Picture file'), { target: { files: [new File(['x'], 'k.png', { type: 'image/png' })] } });
  });
};

describe('ItemPhotos', () => {
  it('shows the cover, the others, an add square and the count', () => {
    show(item([photo('p1'), photo('p2')]));
    expect(screen.getByRole('button', { name: 'Crop cover photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crop photo 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a photo' })).toBeTruthy();
    expect(screen.getByText('2 of 8')).toBeTruthy();
  });

  it('has no add square at eight', () => {
    show(item(Array.from({ length: 8 }, (_, i) => photo(`p${i + 1}`))));
    expect(screen.queryByRole('button', { name: 'Add a photo' })).toBeNull();
    expect(screen.getByText('8 of 8')).toBeTruthy();
  });

  it('adds a photo whole on Save', async () => {
    const { api, onChange } = show(item([photo('p1')]));
    await pick();
    expect(screen.getByRole('dialog', { name: 'Adjust photo' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(api.addPhoto).toHaveBeenCalledTimes(1);
    expect(api.addPhoto).toHaveBeenCalledWith('a', expect.any(Blob), { x: 0.125, y: 0, size: 1 });
    expect(onChange).toHaveBeenCalledWith(result);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uploads nothing on Cancel', async () => {
    const { api, onChange } = show(item([photo('p1')]));
    await pick();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.addPhoto).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('re-crops a saved photo from its original', async () => {
    const { api } = show(item([photo('p1'), photo('p2')]));
    fireEvent.click(screen.getByRole('button', { name: 'Crop photo 2' }));
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute('src', '/original/a/p2');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(api.recropPhoto).toHaveBeenCalledWith('a', 'p2', photo('p2').frame);
  });

  it('removes a photo from its crop window', async () => {
    const { api, onChange } = show(item([photo('p1'), photo('p2')]));
    fireEvent.click(screen.getByRole('button', { name: 'Crop photo 2' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove photo' })); });
    expect(api.removePhoto).toHaveBeenCalledWith('a', 'p2');
    expect(onChange).toHaveBeenCalled();
  });

  it('replaces a photo with a new file, whole', async () => {
    const { api } = show(item([photo('p1'), photo('p2')]));
    fireEvent.click(screen.getByRole('button', { name: 'Crop photo 2' }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Replace picture'), { target: { files: [new File(['x'], 'n.png', { type: 'image/png' })] } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(api.replacePhoto).toHaveBeenCalledWith('a', 'p2', expect.any(Blob), { x: 0.125, y: 0, size: 1 });
    expect(api.recropPhoto).not.toHaveBeenCalled();
  });

  it('moves a photo left with Alt+ArrowLeft and says so', async () => {
    const { api, onChange } = show(item([photo('p1'), photo('p2')]));
    await act(async () => { fireEvent.keyDown(screen.getByRole('button', { name: 'Crop photo 2' }), { key: 'ArrowLeft', altKey: true }); });
    expect(api.reorderPhotos).toHaveBeenCalledWith('a', ['p2', 'p1']);
    expect(onChange).toHaveBeenCalledWith(result);
    expect(screen.getByRole('status')).toHaveTextContent('Photo moved to position 1');
  });

  it('moves the cover right with Alt+ArrowRight, and does nothing past the ends', async () => {
    const { api } = show(item([photo('p1'), photo('p2')]));
    await act(async () => { fireEvent.keyDown(screen.getByRole('button', { name: 'Crop cover photo' }), { key: 'ArrowLeft', altKey: true }); });
    expect(api.reorderPhotos).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(screen.getByRole('button', { name: 'Crop cover photo' }), { key: 'ArrowRight', altKey: true }); });
    expect(api.reorderPhotos).toHaveBeenCalledWith('a', ['p2', 'p1']);
  });

  it('passes a rejected call to onError', async () => {
    const { onError } = show(item([photo('p1')]), { addPhoto: vi.fn(async () => { throw new Error('Too many photos.'); }) });
    await pick();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(onError).toHaveBeenLastCalledWith('Too many photos.');
  });

  it('shows a legacy picture as the cover, with Change picture', async () => {
    const { api } = show(item([], { photoUrl: 'https://files.example/old.webp' }));
    const change = screen.getByRole('button', { name: 'Change picture' });
    expect(change.querySelector('img')).toHaveAttribute('src', 'https://files.example/old.webp');
    expect(screen.queryByText(/of 8/)).toBeNull();
    await pick();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(api.addPhoto).toHaveBeenCalledTimes(1);
  });

  it('is disabled with the editor reasons', () => {
    show(null);
    expect(screen.getByRole('button', { name: 'Add a picture' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a picture' })).toHaveAttribute('title', 'Give it a name and a price first');
    cleanup();
    show(item([photo('p1')]), {}, false);
    expect(screen.getByRole('button', { name: 'Add a photo' })).toHaveAttribute('title', 'Pictures are switched off here');
    expect(screen.queryByLabelText('Picture file')).toBeNull();
  });

  it('reorders on a drag from one square onto another, to the latest onChange', async () => {
    const { api } = show(item([photo('p1'), photo('p2')]));
    await act(async () => { drag(screen.getByRole('button', { name: 'Crop photo 2' }), screen.getByRole('button', { name: 'Crop cover photo' })); });
    expect(api.reorderPhotos).toHaveBeenCalledWith('a', ['p2', 'p1']);
  });

  it('calls the onChange of the latest render, not the first', async () => {
    const calls = { reorderPhotos: vi.fn(async () => result), photoUrl: (key: string) => key } as unknown as ItemsApi;
    const first = vi.fn();
    const latest = vi.fn();
    const base = { tint: 0, uploadsEnabled: true, api: calls, onError: vi.fn() };
    const view = render(<ItemPhotos {...base} item={null} onChange={first} />);
    view.rerender(<ItemPhotos {...base} item={item([photo('p1'), photo('p2')])} onChange={latest} />);
    await act(async () => { drag(screen.getByRole('button', { name: 'Crop photo 2' }), screen.getByRole('button', { name: 'Crop cover photo' })); });
    expect(latest).toHaveBeenCalledWith(result);
    expect(first).not.toHaveBeenCalled();
  });

  it('treats a press and release without movement as a tap, not a drag', async () => {
    const { api } = show(item([photo('p1'), photo('p2')]));
    await act(async () => { drag(screen.getByRole('button', { name: 'Crop photo 2' }), screen.getByRole('button', { name: 'Crop cover photo' }), 2); });
    expect(api.reorderPhotos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Crop photo 2' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('forgets a drag that the browser cancelled', async () => {
    const { api } = show(item([photo('p1'), photo('p2')]));
    document.elementFromPoint = vi.fn(() => screen.getByRole('button', { name: 'Crop cover photo' }));
    fireEvent(screen.getByRole('button', { name: 'Crop photo 2' }), point('pointerdown'));
    fireEvent(window, point('pointercancel'));
    fireEvent(window, point('pointermove', { clientX: 40 }));
    await act(async () => { fireEvent(window, point('pointerup', { clientX: 40 })); });
    expect(api.reorderPhotos).not.toHaveBeenCalled();
  });

  it('starts a drag only from the primary button', async () => {
    const { api } = show(item([photo('p1'), photo('p2')]));
    document.elementFromPoint = vi.fn(() => screen.getByRole('button', { name: 'Crop cover photo' }));
    fireEvent(screen.getByRole('button', { name: 'Crop photo 2' }), point('pointerdown', { button: 2 }));
    fireEvent(window, point('pointermove', { clientX: 40 }));
    await act(async () => { fireEvent(window, point('pointerup', { clientX: 40 })); });
    expect(api.reorderPhotos).not.toHaveBeenCalled();
  });
});
