import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
vi.mock('../curios/resize-image.js', () => ({
  prepareOriginal: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/webp' }), width: 1000, height: 750 })),
}));

const { ItemEditor } = await import('./item-editor.js');
import { PHYSICAL_ITEM, PHYSICAL_ROW, type EditorItem, type ItemRow, type ItemsApi } from './store-types.js';

const photo = (id: string) => ({ id, squareKey: `items/${id}.webp`, width: 1000, height: 1000, frame: { x: 0, y: 0, size: 1 } });
const choices = {
  groupOne: { name: 'Flavour', choices: [{ id: 'a', label: 'Vanilla', photoId: null, photoKey: null }, { id: 'b', label: 'Chocolate', photoId: null, photoKey: null }] },
  groupTwo: { name: 'Size', choices: [{ id: 'x', label: '500g', photoId: null, photoKey: null }, { id: 'y', label: '1kg', photoId: null, photoKey: null }] },
  combos: [
    { id: 'c1', label: 'Vanilla · 500g', oneId: 'a', twoId: 'x', priceCents: 4500, available: true },
    { id: 'c2', label: 'Vanilla · 1kg', oneId: 'a', twoId: 'y', priceCents: 8000, available: false },
    { id: 'c3', label: 'Chocolate · 500g', oneId: 'b', twoId: 'x', priceCents: 5000, available: true },
    { id: 'c4', label: 'Chocolate · 1kg', oneId: 'b', twoId: 'y', priceCents: 9000, available: true },
  ],
};
const cake: EditorItem = {
  ...PHYSICAL_ITEM, id: 'k', name: 'Kek', slug: 'k', category: null, tag: null, sku: null, description: null, photoKey: null, priceCents: null, available: true, photoUrl: null,
  options: choices.combos.map(({ id, label, priceCents }) => ({ id, label, priceCents })), choices, photos: [photo('p1'), photo('p2')],
};
const plain: EditorItem = { ...cake, id: 'c', options: [{ id: 'o1', label: '1kg', priceCents: 9500 }, { id: 'o2', label: '2kg', priceCents: 17000 }], choices: undefined, photos: [] };

const row = (over: Partial<ItemRow> = {}): ItemRow => ({ ...PHYSICAL_ROW, id: 'k', name: 'Kek', slug: 'k', category: null, tag: null, sku: null, description: null, photoKey: null, available: true, priceCents: null, options: [], choices: null, ...over });

function api(): ItemsApi {
  return {
    add: vi.fn(async () => row()),
    update: vi.fn(async (id: string) => row({ id })),
    remove: vi.fn(), reorder: vi.fn(), addPhoto: vi.fn(), recropPhoto: vi.fn(), replacePhoto: vi.fn(), removePhoto: vi.fn(), reorderPhotos: vi.fn(),
    photoUrl: vi.fn((key: string) => `https://files.example/${key}`),
    originalUrl: vi.fn(), uploadFile: vi.fn(), removeFile: vi.fn(), addCodes: vi.fn(), addSession: vi.fn(), updateSession: vi.fn(), removeSession: vi.fn(),
  } as unknown as ItemsApi;
}

function show(item: EditorItem | null) {
  const calls = api();
  const props = { onSaved: vi.fn(), onPreview: vi.fn(), onRemoved: vi.fn(), onClose: vi.fn() };
  render(<ItemEditor item={item} tint={0} uploadsEnabled paysOnline categories={[]} api={calls} shop={{ handle: 'keklina', open: true }} {...props} />);
  return { calls, ...props };
}
const pause = () => act(async () => { await vi.advanceTimersByTimeAsync(600); });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const lastPricing = (calls: ItemsApi) => vi.mocked(calls.update).mock.calls.at(-1)![1].pricing;
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ItemEditor, choices inside options', () => {
  it('opens a choices item as choices and saves a name edit as choices, never as plain options', async () => {
    vi.useFakeTimers();
    const { calls, onPreview } = show(cake);
    expect(screen.getByText('Customers see From RM45')).toBeInTheDocument();
    expect((screen.getByLabelText('Vanilla, 1kg price') as HTMLInputElement).value).toBe('80');
    expect(screen.getByLabelText('Vanilla, 1kg on sale')).toHaveAttribute('aria-checked', 'false');
    type('Name', 'Kek lapis');
    await pause();
    const pricing = lastPricing(calls);
    expect(pricing?.kind).toBe('choices');
    expect(pricing).toMatchObject({ combos: [{ one: 0, two: 0, available: true }, { one: 0, two: 1, priceCents: 8000, available: false }, {}, {}] });
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ choices: expect.objectContaining({ combos: expect.any(Array) }) }));
  });

  it('edits one cell, and removing group two sends one-group combinations without a two', async () => {
    vi.useFakeTimers();
    const { calls } = show(cake);
    type('Chocolate, 1kg price', '95');
    await pause();
    expect((lastPricing(calls) as { combos: { priceCents: number }[] }).combos[3]!.priceCents).toBe(9500);
    fireEvent.click(screen.getByRole('button', { name: 'Remove group two' }));
    await pause();
    const one = lastPricing(calls) as unknown as { groupTwo?: unknown; combos: Record<string, unknown>[] };
    expect(one.groupTwo).toBeUndefined();
    expect(one.combos).toHaveLength(2);
    expect(one.combos.every((c) => !('two' in c))).toBe(true);
  });

  it('turning off the last combination explains and sends nothing', async () => {
    vi.useFakeTimers();
    const { calls } = show(cake);
    for (const label of ['Vanilla, 500g on sale', 'Chocolate, 500g on sale']) {
      fireEvent.click(screen.getByLabelText(label));
      await pause();
    }
    expect(calls.update).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText('Chocolate, 1kg on sale'));
    await pause();
    expect(screen.getByText('Keep at least one combination on sale.')).toBeInTheDocument();
    expect(calls.update).toHaveBeenCalledTimes(2);
  });

  it('refuses a RM0 combination in the options wording', () => {
    show(cake);
    type('Vanilla, 500g price', '0');
    expect(screen.getByText('"Vanilla · 500g": Give it a price above RM0, up to RM10,000.')).toBeInTheDocument();
  });

  it('same price collapses to one row', () => {
    show(cake);
    fireEvent.click(screen.getByLabelText('Same price for every Flavour'));
    expect(screen.queryByLabelText('Chocolate, 1kg price')).toBeNull();
    expect(screen.getByLabelText('1kg, every Flavour price')).toBeInTheDocument();
  });

  it('picks a group-one photo from the item photos', async () => {
    vi.useFakeTimers();
    const { calls } = show(cake);
    const picker = screen.getByRole('radiogroup', { name: 'Photo for Vanilla' });
    fireEvent.click(within(picker).getByRole('radio', { name: 'Photo 2' }));
    await pause();
    expect((lastPricing(calls) as { groupOne: { choices: { photoId?: string }[] } }).groupOne.choices[0]!.photoId).toBe('p2');
  });

  it('removing a choice drops its combinations', async () => {
    vi.useFakeTimers();
    const { calls } = show(cake);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Chocolate from Flavour' }));
    await pause();
    expect((lastPricing(calls) as { combos: unknown[] }).combos).toHaveLength(2);
    expect(screen.queryByLabelText('Chocolate, 1kg price')).toBeNull();
  });

  it('an options item gets a choice group, with the options as group one; no photos yet means a hint', async () => {
    vi.useFakeTimers();
    const { calls } = show(plain);
    fireEvent.click(screen.getByRole('button', { name: '+ Add a choice group' }));
    expect(screen.getByText('Group two')).toBeInTheDocument();
    expect(screen.getByText(/Add photos above to pick one per/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: 'No photo' })[0]).toBeDisabled();
    type('Group one name', 'Size');
    type('Group two name', 'Flavour');
    type('Group two choice 1 name', 'Vanilla');
    await pause();
    expect(lastPricing(calls)).toEqual({
      kind: 'choices',
      groupOne: { name: 'Size', choices: [{ label: '1kg' }, { label: '2kg' }] },
      groupTwo: { name: 'Flavour', choices: [{ label: 'Vanilla' }] },
      combos: [{ one: 0, two: 0, priceCents: 9500, available: true }, { one: 1, two: 0, priceCents: 17000, available: true }],
    });
  });

  it('goes back to a plain list of the combinations on sale', async () => {
    vi.useFakeTimers();
    const { calls } = show(cake);
    fireEvent.click(screen.getByRole('button', { name: 'Use a plain list of options instead' }));
    await pause();
    expect(lastPricing(calls)).toEqual({
      kind: 'options',
      options: [{ label: 'Vanilla · 500g', priceCents: 4500 }, { label: 'Chocolate · 500g', priceCents: 5000 }, { label: 'Chocolate · 1kg', priceCents: 9000 }],
    });
  });
});
