import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_ITEMS } from '@curios/core/store';
import { ItemsEditor, type EditorItem, type ItemRow, type ItemsApi } from './items-editor.js';

const item = (id: string, name: string, over: Partial<EditorItem> = {}): EditorItem => ({
  id, name, description: null, photoKey: null, priceCents: 2500, options: [], available: true, photoUrl: null, ...over,
});

const three = [item('a', 'Kek Batik'), item('b', 'Cookies'), item('c', 'Tart')];

const rowOf = (id: string, over: Partial<ItemRow> = {}): ItemRow => ({
  id, name: 'x', description: null, photoKey: null, available: true, priceCents: 2500, options: [], ...over,
});

function setup(items: EditorItem[] = three, uploadsEnabled = true, overrides: Partial<ItemsApi> = {}) {
  const api = {
    add: vi.fn(async (input: Parameters<ItemsApi['add']>[0]) =>
      rowOf('new', { name: input.name, priceCents: input.pricing.kind === 'single' ? input.pricing.priceCents : null })),
    update: vi.fn(async (id: string, patch: Parameters<ItemsApi['update']>[1]) => rowOf(id, { name: 'Kek Batik', ...patch, pricing: undefined } as Partial<ItemRow>)),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    uploadPhoto: vi.fn(async () => 'https://files.example/p.webp'),
    removePhoto: vi.fn(async () => undefined),
    ...overrides,
  } satisfies ItemsApi;
  render(<ItemsEditor items={items} uploadsEnabled={uploadsEnabled} api={api} />);
  return api;
}

const PARSE = 'That price does not look right. Use ringgit and sen, like 95 or 95.50.';

async function startAdd(name = 'Cookies balang') {
  await userEvent.click(screen.getByRole('button', { name: '+ Add an item' }));
  await userEvent.type(screen.getByLabelText('Name'), name);
}

describe('ItemsEditor', () => {
  it('invites the first item when empty', () => {
    setup([]);
    expect(screen.getByText('No items yet — add the first thing you sell.')).toBeInTheDocument();
  });

  it('adds an item with one price', async () => {
    const api = setup([]);
    await startAdd();
    await userEvent.type(screen.getByLabelText('Price (RM)'), 'RM 25');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.add).toHaveBeenCalledWith({ name: 'Cookies balang', description: null, pricing: { kind: 'single', priceCents: 2500 } });
    expect(await screen.findByRole('listitem', { name: 'Cookies balang' })).toBeInTheDocument();
  });

  it('counts the description the way the server will, without its surrounding spaces', async () => {
    const api = setup([]);
    await startAdd();
    await userEvent.type(screen.getByLabelText('Price (RM)'), '25');
    const description = screen.getByLabelText('Description');
    await userEvent.click(description);
    await userEvent.paste(`${'a'.repeat(280)}   `);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.add).toHaveBeenCalledWith({ name: 'Cookies balang', description: 'a'.repeat(280), pricing: { kind: 'single', priceCents: 2500 } });
  });

  it('adds an item with options', async () => {
    const api = setup([]);
    await startAdd();
    await userEvent.click(screen.getByRole('radio', { name: 'Options' }));
    await userEvent.type(screen.getByLabelText('Option 1 name'), '1kg');
    await userEvent.type(screen.getByLabelText('Option 1 price (RM)'), '95');
    await userEvent.click(screen.getByRole('button', { name: '+ Add option' }));
    await userEvent.type(screen.getByLabelText('Option 2 name'), '2kg');
    await userEvent.type(screen.getByLabelText('Option 2 price (RM)'), '170');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.add).toHaveBeenCalledWith({
      name: 'Cookies balang',
      description: null,
      pricing: { kind: 'options', options: [{ label: '1kg', priceCents: 9500 }, { label: '2kg', priceCents: 17000 }] },
    });
  });

  it('explains an unreadable price and a zero price without calling the API', async () => {
    const api = setup([]);
    await startAdd();
    await userEvent.type(screen.getByLabelText('Price (RM)'), '95.555');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent(PARSE);

    await userEvent.clear(screen.getByLabelText('Price (RM)'));
    await userEvent.type(screen.getByLabelText('Price (RM)'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give it a price above RM0');
    expect(screen.getByRole('alert')).not.toHaveTextContent(PARSE);
    expect(api.add).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Price (RM)'));
    await userEvent.type(screen.getByLabelText('Price (RM)'), '1,200');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ pricing: { kind: 'single', priceCents: 120000 } }));
  });

  it('hides an item with the Available switch', async () => {
    const api = setup();
    const row = screen.getByRole('listitem', { name: 'Kek Batik' });
    await userEvent.click(within(row).getByRole('switch', { name: /available/i }));
    expect(api.update).toHaveBeenCalledWith('a', { available: false });
    expect(await within(row).findByText('Hidden from your shop')).toBeInTheDocument();
  });

  it('confirms a removal, then removes', async () => {
    const api = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Kek Batik' }));
    expect(screen.getByText('Remove Kek Batik? It leaves your shop and the chat.')).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(api.remove).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('listitem', { name: 'Kek Batik' })).toBeNull();
  });

  it('brings the row back and says why when a removal fails', async () => {
    setup(three, true, { remove: vi.fn(async () => { throw new Error('No connection.'); }) });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Kek Batik' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(await screen.findByRole('listitem', { name: 'Kek Batik' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No connection.');
  });

  const order = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));

  it('reorders with the move buttons', async () => {
    const api = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Move Kek Batik down' }));
    expect(api.reorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect(order()).toEqual(['Cookies', 'Kek Batik', 'Tart']);
    await userEvent.click(screen.getByRole('button', { name: 'Move Tart up' }));
    expect(api.reorder).toHaveBeenLastCalledWith(['b', 'c', 'a']);
  });

  it('restores the old order when reordering fails', async () => {
    setup(three, true, { reorder: vi.fn(async () => { throw new Error('Order is out of date.'); }) });
    await userEvent.click(screen.getByRole('button', { name: 'Move Kek Batik down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Order is out of date.');
    expect(order()).toEqual(['Kek Batik', 'Cookies', 'Tart']);
  });

  it('replaces the add button at the limit', () => {
    setup(Array.from({ length: MAX_ITEMS }, (_, i) => item(`i${i}`, `Item ${i}`)));
    expect(screen.queryByRole('button', { name: '+ Add an item' })).toBeNull();
    expect(screen.getByText('40 items is the most a shop holds. Remove one to add another.')).toBeInTheDocument();
  });

  it('saves edited text only when Save is pressed', async () => {
    const api = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
    await userEvent.clear(screen.getByLabelText('Price (RM)'));
    await userEvent.type(screen.getByLabelText('Price (RM)'), '30');
    expect(api.update).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.update).toHaveBeenCalledWith('a', { name: 'Kek Batik', description: null, pricing: { kind: 'single', priceCents: 3000 } });
  });

  it('says pictures are off when uploads are disabled', async () => {
    setup(three, false);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
    expect(screen.getByText('Pictures are switched off here.')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload a picture for Kek Batik')).toBeDisabled();
  });

  it('shows an upload, and removes a picture', async () => {
    const api = setup([item('a', 'Kek Batik', { photoKey: 'k', photoUrl: 'https://files.example/k.webp' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
    await userEvent.upload(screen.getByLabelText('Upload a picture for Kek Batik'), new File(['x'], 'k.png', { type: 'image/png' }));
    expect(api.uploadPhoto).toHaveBeenCalledWith('a', expect.any(File));
    expect(await screen.findByAltText('Picture of Kek Batik')).toHaveAttribute('src', 'https://files.example/p.webp');
    await userEvent.click(screen.getByRole('button', { name: 'Remove picture' }));
    expect(api.removePhoto).toHaveBeenCalledWith('a');
    expect(screen.queryByAltText('Picture of Kek Batik')).toBeNull();
  });

  it('shows the API sentence when a save fails, and keeps what was typed', async () => {
    setup(three, true, { update: vi.fn(async () => { throw new Error('Give each option a name.'); }) });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
    await userEvent.type(screen.getByLabelText('Description'), 'Soft');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give each option a name.');
    expect(screen.getByLabelText('Description')).toHaveValue('Soft');
  });

  it('puts the switch back when hiding fails', async () => {
    setup(three, true, { update: vi.fn(async () => { throw new Error('No connection.'); }) });
    const row = screen.getByRole('listitem', { name: 'Kek Batik' });
    await userEvent.click(within(row).getByRole('switch', { name: /available/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection.');
    expect(within(row).getByRole('switch', { name: /available/i })).toBeChecked();
    expect(within(row).queryByText('Hidden from your shop')).toBeNull();
  });

  it('cannot move the first item up or the last item down', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Move Kek Batik up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Tart down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Cookies up' })).toBeEnabled();
  });

  describe('option lists', () => {
    const kgs = item('o', 'Cookies', {
      priceCents: null,
      options: [
        { id: 'o1', label: '1kg', priceCents: 9500 },
        { id: 'o2', label: '2kg', priceCents: 17000 },
        { id: 'o3', label: '3kg', priceCents: 24000 },
      ],
    });

    it('blocks an option with no name, with no API call', async () => {
      const api = setup([]);
      await startAdd();
      await userEvent.click(screen.getByRole('radio', { name: 'Options' }));
      await userEvent.type(screen.getByLabelText('Option 1 price (RM)'), '95');
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Give each option a name');
      expect(api.add).not.toHaveBeenCalled();
    });

    it('blocks an option with no price, with no API call', async () => {
      const api = setup([]);
      await startAdd();
      await userEvent.click(screen.getByRole('radio', { name: 'Options' }));
      await userEvent.type(screen.getByLabelText('Option 1 name'), '1kg');
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByRole('alert')).toHaveTextContent(PARSE);
      expect(api.add).not.toHaveBeenCalled();
    });

    it('blocks an edited option list with a blank name on Save', async () => {
      const api = setup([kgs]);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Cookies' }));
      await userEvent.clear(screen.getByLabelText('Option 2 name'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Give each option a name');
      expect(api.update).not.toHaveBeenCalled();
    });

    it('edits an existing options item: change one price, remove another, save exactly that', async () => {
      const api = setup([kgs]);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Cookies' }));
      expect(screen.getByLabelText('Option 1 name')).toHaveValue('1kg');
      expect(screen.getByLabelText('Option 2 price (RM)')).toHaveValue('170');
      await userEvent.clear(screen.getByLabelText('Option 1 price (RM)'));
      await userEvent.type(screen.getByLabelText('Option 1 price (RM)'), '99.50');
      await userEvent.click(screen.getByRole('button', { name: 'Remove option 2' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(api.update).toHaveBeenCalledWith('o', {
        name: 'Cookies',
        description: null,
        pricing: { kind: 'options', options: [{ label: '1kg', priceCents: 9950 }, { label: '3kg', priceCents: 24000 }] },
      });
    });

    it('sends nothing while option fields are typed in, until Save', async () => {
      const api = setup([kgs]);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Cookies' }));
      await userEvent.type(screen.getByLabelText('Option 1 name'), 'x');
      await userEvent.click(screen.getByRole('button', { name: '+ Add option' }));
      await userEvent.type(screen.getByLabelText('Option 4 name'), 'half');
      expect(api.update).not.toHaveBeenCalled();
      expect(api.add).not.toHaveBeenCalled();
    });

    it('switches an existing single-price item to options and saves it', async () => {
      const api = setup();
      await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
      await userEvent.click(screen.getByRole('radio', { name: 'Options' }));
      await userEvent.type(screen.getByLabelText('Option 1 name'), 'Small');
      await userEvent.type(screen.getByLabelText('Option 1 price (RM)'), '20');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(api.update).toHaveBeenCalledWith('a', {
        name: 'Kek Batik',
        description: null,
        pricing: { kind: 'options', options: [{ label: 'Small', priceCents: 2000 }] },
      });
    });

    it('stops offering more options at the limit', async () => {
      const many = item('m', 'Box', { priceCents: null, options: Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, label: `S${i}`, priceCents: 100 })) });
      setup([many]);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Box' }));
      expect(screen.queryByRole('button', { name: '+ Add option' })).toBeNull();
      expect(screen.getByText('10 options is the most an item holds.')).toBeInTheDocument();
    });
  });
});
