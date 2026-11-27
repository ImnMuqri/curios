import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PicturesPanel, type PicturesApi } from './pictures-panel.js';
import type { LinkItem } from './links-editor.js';

const pic = (n: number) => ({ id: `p${n}`, key: `links/pg/${n}.webp`, contentType: 'image/webp', width: 800, height: 600, bytes: 1000, position: n - 1 });
const gallery = (count: number, extra: Partial<LinkItem> = {}): LinkItem => ({
  id: 'g',
  label: 'Fresh out of the oven',
  url: '',
  size: null,
  kind: 'WIDGET',
  provider: 'PICTURES',
  embedRef: null,
  embedTitle: null,
  embedImage: null,
  pictureMode: 'CAROUSEL',
  altText: null,
  pictures: Array.from({ length: count }, (_u, i) => pic(i + 1)),
  ...extra,
});
const file = (name: string, type: string, size = 2000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

function setup(link: LinkItem | null, provider: 'PICTURES' | 'GIF' = 'PICTURES') {
  const rows: { current: LinkItem } = { current: link ?? gallery(0, { provider, label: provider === 'GIF' ? 'GIF' : 'Pictures', pictureMode: provider === 'GIF' ? 'FULL' : 'CAROUSEL' }) };
  const api: PicturesApi = {
    create: vi.fn(async () => rows.current),
    add: vi.fn(async (_id: string, f: File) => {
      rows.current = { ...rows.current, pictures: [...rows.current.pictures, { ...pic(rows.current.pictures.length + 1), key: `links/pg/${f.name}.webp` }] };
      return rows.current;
    }),
    remove: vi.fn(async (_id: string, pictureId: string) => {
      rows.current = { ...rows.current, pictures: rows.current.pictures.filter((p) => p.id !== pictureId).map((p, i) => ({ ...p, position: i })) };
      return rows.current;
    }),
    reorder: vi.fn(async (_id: string, ids: string[]) => {
      rows.current = { ...rows.current, pictures: ids.map((id, i) => ({ ...rows.current.pictures.find((p) => p.id === id)!, position: i })) };
      return rows.current;
    }),
    url: (key: string) => `https://files.test/${key}`,
  };
  const updateLink = vi.fn(async (_id: string, patch: object) => ({ ...rows.current, ...patch }));
  const onLink = vi.fn();
  const onClose = vi.fn();
  const onDiscard = vi.fn();
  render(<PicturesPanel provider={provider} link={link} api={api} updateLink={updateLink} onLink={onLink} onDiscard={onDiscard} onClose={onClose} />);
  return { api, updateLink, onLink, onClose, onDiscard };
}

const choose = (files: File[]) => fireEvent.change(screen.getByLabelText(/Choose (pictures|a GIF)/), { target: { files } });
const order = () => within(screen.getByRole('list', { name: 'Pictures, in order' })).getAllByTestId('picture').map((el) => el.textContent);

describe('PicturesPanel', () => {
  it('makes the widget when the first file arrives, then sends each file as it is', async () => {
    const { api, onLink } = setup(null);
    const a = file('a.jpg', 'image/jpeg');
    const b = file('b.png', 'image/png');
    choose([a, b]);
    await waitFor(() => expect(api.add).toHaveBeenCalledTimes(2));
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith({ provider: 'PICTURES', mode: 'CAROUSEL', label: null, altText: null });
    expect((api.add as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual([a, b]);
    await waitFor(() => expect(order()).toEqual(['1', '2']));
    expect(onLink).toHaveBeenCalled();
    expect(screen.getByText('2 of 6 · drag to reorder')).toBeInTheDocument();
  });

  it('refuses a file of the wrong type, or over 10 MB, before sending anything', () => {
    const { api } = setup(null);
    choose([file('cat.gif', 'image/gif'), file('huge.jpg', 'image/jpeg', 11 * 1024 * 1024)]);
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts.some((t) => /cat\.gif is not a JPEG, PNG or WebP/.test(t ?? ''))).toBe(true);
    expect(alerts.some((t) => /huge\.jpg is over 10 MB/.test(t ?? ''))).toBe(true);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.add).not.toHaveBeenCalled();
  });

  it('holds six: the Add tile goes and extra files are left out', async () => {
    const { api } = setup(gallery(5));
    choose([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')]);
    await waitFor(() => expect(api.add).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).toHaveTextContent('up to 6 pictures. b.jpg was left out');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add' })).toBeNull());
  });

  it('says which file failed and why', async () => {
    const { api } = setup(gallery(1));
    (api.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Use a JPEG, PNG or WebP picture, up to 10 MB.'));
    choose([file('broken.jpg', 'image/jpeg')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('broken.jpg: Use a JPEG, PNG or WebP picture, up to 10 MB.');
    expect(order()).toEqual(['1']);
  });

  it('says to wait when the API rate-limits uploads (429)', async () => {
    const { api } = setup(gallery(1));
    (api.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { status: 429 }));
    choose([file('a.jpg', 'image/jpeg')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('a.jpg: Too many uploads at once. Wait a minute and try again.');
  });

  it('moves a picture with the buttons and sends the new order', async () => {
    const { api } = setup(gallery(3));
    await userEvent.click(screen.getByRole('button', { name: 'Move picture 1 later' }));
    expect(api.reorder).toHaveBeenCalledWith('g', ['p2', 'p1', 'p3']);
    expect(screen.getByRole('button', { name: 'Move picture 1 earlier' })).toBeDisabled();
  });

  it('puts the order back when the move is refused', async () => {
    const { api } = setup(gallery(2));
    (api.reorder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Your pictures changed. Reload and try again.'));
    await userEvent.click(screen.getByRole('button', { name: 'Move picture 2 earlier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your pictures changed');
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://files.test/links/pg/1.webp');
  });

  it('reorders by dragging one picture onto another', async () => {
    const { api } = setup(gallery(3));
    const frames = screen.getAllByTestId('picture');
    const data = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(frames[2]!, { dataTransfer: data });
    fireEvent.dragOver(frames[0]!.closest('li')!, { dataTransfer: data });
    fireEvent.drop(frames[0]!.closest('li')!, { dataTransfer: data });
    expect(api.reorder).toHaveBeenCalledWith('g', ['p3', 'p1', 'p2']);
    await waitFor(() => expect(order()).toEqual(['1', '2', '3']));
    expect(document.querySelectorAll('img')[0]).toHaveAttribute('src', 'https://files.test/links/pg/3.webp');
  });

  it('removes a picture', async () => {
    const { api } = setup(gallery(3));
    await userEvent.click(screen.getByRole('button', { name: 'Remove picture 2' }));
    expect(api.remove).toHaveBeenCalledWith('g', 'p2');
    await waitFor(() => expect(order()).toEqual(['1', '2']));
  });

  it('shows Carousel or Grid for several, and saves the choice with caption and description', async () => {
    const { updateLink, onClose } = setup(gallery(3));
    expect(screen.getByRole('radio', { name: /Carousel/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Grid/ }));
    expect(screen.getByRole('radio', { name: /Grid/ })).toBeChecked();
    await userEvent.clear(screen.getByLabelText('Caption'));
    await userEvent.type(screen.getByLabelText('Caption'), 'Saturday bakes');
    await userEvent.type(screen.getByLabelText('Describe them for screen readers'), 'Three cakes');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateLink).toHaveBeenCalledWith('g', { label: 'Saturday bakes', pictureMode: 'GRID', altText: 'Three cakes' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('offers Full width or Square for one picture, and keeps Carousel and Grid out of it', async () => {
    const { updateLink } = setup(gallery(1));
    expect(screen.queryByRole('radio', { name: /Carousel/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Full width/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Square/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateLink).toHaveBeenCalledWith('g', expect.objectContaining({ pictureMode: 'SQUARE' }));
  });

  it('moves the radio choice with the arrow keys', async () => {
    setup(gallery(2));
    screen.getByRole('radio', { name: /Carousel/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Grid/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Grid/ })).toHaveFocus();
  });

  it('is a GIF panel: one GIF, Full width or Square, only .gif accepted', async () => {
    const { api } = setup(null, 'GIF');
    expect(screen.getByLabelText('Choose a GIF')).toHaveAttribute('accept', 'image/gif');
    expect(screen.queryByRole('radio', { name: /Carousel/ })).toBeNull();
    choose([file('pic.jpg', 'image/jpeg')]);
    expect(screen.getByRole('alert')).toHaveTextContent('pic.jpg is not a GIF');
    choose([file('cat.gif', 'image/gif')]);
    await waitFor(() => expect(api.add).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({ provider: 'GIF', mode: 'FULL', label: null, altText: null });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add' })).toBeNull());
  });

  it('will not save an empty gallery', async () => {
    const { updateLink, onClose } = setup(null);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a picture first.');
    expect(updateLink).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('discards a widget made but left with no picture when the panel closes, and closes on Escape', async () => {
    const { api, onDiscard, onClose } = setup(null);
    (api.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));
    choose([file('a.jpg', 'image/jpeg')]);
    await screen.findByRole('alert');
    fireEvent.keyDown(screen.getByRole('region', { name: 'Pictures widget' }), { key: 'Escape' });
    expect(onDiscard).toHaveBeenCalledWith('g');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not exceed six with two quick picks', async () => {
    const { api } = setup(gallery(4));
    choose([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')]);
    choose([file('c.jpg', 'image/jpeg')]);
    await waitFor(() => expect(api.add).toHaveBeenCalledTimes(2));
  });

  it('shows two failures of the same file name', async () => {
    const { api } = setup(gallery(1));
    (api.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad'));
    choose([file('a.jpg', 'image/jpeg'), file('a.jpg', 'image/jpeg')]);
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  });

  it('closes without saving', async () => {
    const { updateLink, onClose } = setup(gallery(2));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(updateLink).not.toHaveBeenCalled();
  });

  it('shows a refused save and stays open', async () => {
    const { updateLink, onClose } = setup(gallery(2));
    updateLink.mockRejectedValueOnce(new Error('That did not save. Try again.'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That did not save');
    expect(onClose).not.toHaveBeenCalled();
  });
});
