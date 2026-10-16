import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ItemEditor } from './item-editor.js';
import type { EditorItem, ItemRow, ItemsApi } from './store-types.js';

const batik: EditorItem = { id: 'a', name: 'Kek Batik', description: 'Ten slices.', photoKey: null, priceCents: 4500, options: [], available: true, photoUrl: null };
const coklat: EditorItem = {
  id: 'c', name: 'Kek coklat', description: null, photoKey: null, priceCents: null, available: true, photoUrl: null,
  options: [{ id: 'o1', label: '1kg', priceCents: 9500 }, { id: 'o2', label: '2kg', priceCents: 17000 }],
};

const row = (over: Partial<ItemRow> = {}): ItemRow => ({ id: 'n', name: 'Tart', description: null, photoKey: null, available: true, priceCents: 900, options: [], ...over });

function api(over: Partial<ItemsApi> = {}): ItemsApi {
  return {
    add: vi.fn(async (input) => row({ name: input.name })),
    update: vi.fn(async (id, patch) => row({ id, ...(patch.name ? { name: patch.name } : {}), ...(patch.available !== undefined ? { available: patch.available } : {}) })),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    uploadPhoto: vi.fn(async () => 'https://files.example/items/a.webp'),
    removePhoto: vi.fn(async () => undefined),
    ...over,
  };
}

function show(item: EditorItem | null, calls = api(), uploadsEnabled = true) {
  const props = { onSaved: vi.fn(), onPreview: vi.fn(), onRemoved: vi.fn(), onClose: vi.fn() };
  render(<ItemEditor item={item} tint={0} uploadsEnabled={uploadsEnabled} api={calls} {...props} />);
  return { calls, ...props };
}

const pause = () => act(async () => { await vi.advanceTimersByTimeAsync(600); });

afterEach(() => vi.useRealTimers());

describe('ItemEditor, a new item', () => {
  it('sends nothing until it has a name and a price, then creates it once', async () => {
    vi.useFakeTimers();
    const { calls, onSaved } = show(null);
    expect(screen.getByLabelText('Name')).toHaveFocus();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tart' } });
    await pause();
    expect(calls.add).not.toHaveBeenCalled();
    expect(screen.getByText(/price does not look right/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '9' } });
    expect(screen.getByText('Customers see RM9')).toBeInTheDocument();
    await pause();
    expect(calls.add).toHaveBeenCalledTimes(1);
    expect(calls.add).toHaveBeenCalledWith({ name: 'Tart', description: null, pricing: { kind: 'single', priceCents: 900 } });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'n', name: 'Tart' }));

    // Later changes update the item it became, not another new one.
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '10' } });
    await pause();
    expect(calls.add).toHaveBeenCalledTimes(1);
    expect(calls.update).toHaveBeenCalledWith('n', { name: 'Tart', description: null, pricing: { kind: 'single', priceCents: 1000 } });
  });

  // The second save is sent while the first is still creating the item.
  it('does not create the item twice when the owner keeps typing while it is being created', async () => {
    vi.useFakeTimers();
    let finish!: (value: ItemRow) => void;
    const calls = api({ add: vi.fn(() => new Promise<ItemRow>((resolve) => { finish = resolve; })) });
    show(null, calls);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tart' } });
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '9' } });
    await pause();
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '12' } });
    await pause();
    await act(async () => finish(row()));

    expect(calls.add).toHaveBeenCalledTimes(1);
    expect(calls.update).toHaveBeenCalledWith('n', expect.objectContaining({ pricing: { kind: 'single', priceCents: 1200 } }));
  });

  it('keeps its picture, switch and Remove for once it exists', () => {
    show(null);
    expect(screen.getByRole('button', { name: 'Add a picture' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'In your shop' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove item' })).toBeNull();
  });

  it('will not close on Done while it cannot be saved, and says how to leave it', async () => {
    const { onClose } = show(null);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tart' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/go back to All items to leave it out/);

    fireEvent.click(screen.getByRole('button', { name: 'All items' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ItemEditor, an existing item', () => {
  it('saves a change once the owner pauses', async () => {
    vi.useFakeTimers();
    const { calls } = show(batik);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kek Batik Raya' } });
    expect(calls.update).not.toHaveBeenCalled();
    await pause();
    expect(calls.update).toHaveBeenCalledWith('a', { name: 'Kek Batik Raya', description: 'Ten slices.', pricing: { kind: 'single', priceCents: 4500 } });
  });

  it('Done sends a change still waiting, at once, then closes', async () => {
    vi.useFakeTimers();
    const { calls, onClose } = show(batik);
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '50' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(calls.update).toHaveBeenCalledWith('a', expect.objectContaining({ pricing: { kind: 'single', priceCents: 5000 } }));
    expect(onClose).toHaveBeenCalled();
    await pause();
    expect(calls.update).toHaveBeenCalledTimes(1);
  });

  it('stays open, with Retry, when that last save fails', async () => {
    const calls = api({ update: vi.fn(async () => { throw new Error('offline'); }) });
    const { onClose } = show(batik, calls);
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '50' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows what customers will see for options, and keeps a price when switching to options', () => {
    show(coklat);
    expect(screen.getByText('Customers see 1kg RM95 · 2kg RM170')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Options' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'One price' }));
    expect(screen.getByLabelText('Price in ringgit')).toHaveValue('95');
  });

  it('turns a single price into a first option called Regular', () => {
    show(batik);
    fireEvent.click(screen.getByRole('radio', { name: 'Options' }));
    expect(screen.getByLabelText('Option 1 name')).toHaveValue('Regular');
    expect(screen.getByLabelText('Option 1 price in ringgit')).toHaveValue('45');
    expect(screen.getByRole('button', { name: 'Remove option 1' })).toBeDisabled();
  });

  it('blocks an option with no name, saying so and sending nothing', async () => {
    vi.useFakeTimers();
    const { calls } = show(coklat);
    fireEvent.change(screen.getByLabelText('Option 2 name'), { target: { value: '' } });
    await pause();
    expect(calls.update).not.toHaveBeenCalled();
    expect(screen.getByText(/Give each option a name/)).toBeInTheDocument();
  });

  it('edits options: change one price, remove another, and saves exactly that', async () => {
    vi.useFakeTimers();
    const { calls } = show(coklat);
    fireEvent.change(screen.getByLabelText('Option 1 price in ringgit'), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 2' }));
    await pause();
    expect(calls.update).toHaveBeenLastCalledWith('c', { name: 'Kek coklat', description: null, pricing: { kind: 'options', options: [{ label: '1kg', priceCents: 9900 }] } });
  });

  it('hides it from the shop at once with its switch', async () => {
    const { calls, onSaved } = show(batik);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In your shop' })); });
    expect(calls.update).toHaveBeenCalledWith('a', { available: false });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ available: false }));
    expect(screen.getByText('Hidden from your shop and the chat')).toBeInTheDocument();
  });

  it('confirms a removal, then removes', async () => {
    const { calls, onRemoved } = show(batik);
    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }));
    expect(calls.remove).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' })); });
    expect(calls.remove).toHaveBeenCalledWith('a');
    expect(onRemoved).toHaveBeenCalledWith('a');
  });

  it('says why when a removal fails, and keeps the item', async () => {
    const calls = api({ remove: vi.fn(async () => { throw new Error('Could not reach the server.'); }) });
    const { onRemoved } = show(batik, calls);
    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' })); });
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.');
  });

  it('uploads and removes a picture', async () => {
    const { calls, onSaved } = show(batik);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Picture file'), { target: { files: [new File(['x'], 'k.png', { type: 'image/png' })] } });
    });
    expect(calls.uploadPhoto).toHaveBeenCalledWith('a', expect.any(File));
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ photoUrl: 'https://files.example/items/a.webp' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove picture' })); });
    expect(calls.removePhoto).toHaveBeenCalledWith('a');
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ photoUrl: null }));
  });

  it('says pictures are off, and offers no upload, when storage is off', () => {
    show(batik, api(), false);
    const picture = screen.getByRole('button', { name: 'Add a picture' });
    expect(picture).toBeDisabled();
    expect(picture).toHaveAttribute('title', 'Pictures are switched off here');
    expect(screen.queryByLabelText('Picture file')).toBeNull();
  });

  it('hands the preview the item as it reads now', () => {
    const { onPreview } = show(batik);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kek Batik Raya' } });
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', name: 'Kek Batik Raya', priceCents: 4500 }));

    // Unreadable: the preview keeps the item as last saved.
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: 'x' } });
    expect(onPreview).toHaveBeenLastCalledWith(batik);
  });
});
