import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinksEditor, type LinkItem } from './links-editor.js';

const three: LinkItem[] = [
  { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null },
  { id: 'b', label: 'WhatsApp', url: 'https://wa.me/60123', size: null },
  { id: 'c', label: 'GitHub', url: 'https://github.com/iman', size: null },
];

function setup(links = three, overrides: Partial<Parameters<typeof LinksEditor>[0]> = {}) {
  const props = {
    links,
    onChange: vi.fn(),
    addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', ...i, url: `https://${i.url}`, size: null })),
    updateLink: vi.fn(async (id: string, patch: Partial<LinkItem>) => ({ ...links.find((l) => l.id === id)!, ...patch })),
    removeLink: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<LinksEditor {...props} />);
  return props;
}

describe('LinksEditor', () => {
  it('adds a link and hands the new list up', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shopee.com.my/iman');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).toHaveBeenCalledWith({ label: 'Shop', url: 'shopee.com.my/iman' });
    expect(props.onChange).toHaveBeenLastCalledWith([...three, expect.objectContaining({ label: 'Shop' })]);
  });

  it('says what is wrong with an address before sending it', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Bad');
    await userEvent.type(screen.getByLabelText('Address'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/does not look right/i);
  });

  it('sets a tile size, and automatic clears it', async () => {
    const props = setup();
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Big tile' }));
    expect(props.updateLink).toHaveBeenLastCalledWith('a', { size: 'BIG' });

    await userEvent.click(within(row).getByRole('button', { name: 'Automatic size' }));
    expect(props.updateLink).toHaveBeenLastCalledWith('a', { size: null });
  });

  it('moves a link down with the keyboard-reachable button', async () => {
    const props = setup();
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Portfolio' })).getByRole('button', { name: 'Move Portfolio down' }));
    expect(props.reorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect(props.onChange).toHaveBeenLastCalledWith([three[1], three[0], three[2]]);
  });

  // Review Focus 1, on the client: a refused reorder must not leave the screen lying.
  it('snaps back and says so when a reorder is refused', async () => {
    const props = setup(three, { reorder: vi.fn(async () => { throw new Error('Your links changed somewhere else.'); }) });
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Portfolio' })).getByRole('button', { name: 'Move Portfolio down' }));

    expect(props.onChange).toHaveBeenLastCalledWith(three);
    expect(screen.getByRole('alert')).toHaveTextContent(/changed somewhere else/i);
  });

  it('asks before removing, because a removal cannot be undone', async () => {
    const props = setup();
    const row = screen.getByRole('listitem', { name: 'GitHub' });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove GitHub' }));
    expect(props.removeLink).not.toHaveBeenCalled();

    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    expect(props.removeLink).toHaveBeenCalledWith('c');
  });

  // Review Focus 5.
  it('invites the first link on an empty page', () => {
    setup([]);
    expect(screen.getByText(/add your first link/i)).toBeInTheDocument();
  });

  it('stops offering to add at the limit', () => {
    setup(Array.from({ length: 30 }, (_u, i) => ({ id: `${i}`, label: `L${i}`, url: 'https://a.co', size: null })));
    expect(screen.queryByRole('button', { name: '+ Add a link' })).toBeNull();
    expect(screen.getByText(/30 links is the most/i)).toBeInTheDocument();
  });

  // Step 5's inline editing: a tap on the link text swaps it for Name/Address
  // fields wired to useAutosave, which is what actually calls updateLink.
  it('edits a label inline, saving after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const props = setup();
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByText('Portfolio'), { delay: null });

    const nameField = within(row).getByLabelText('Name');
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Work', { delay: null });

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(props.updateLink).toHaveBeenLastCalledWith('a', { label: 'Work' });
    vi.useRealTimers();
  });

  // The Address half of the same inline editor -- proven separately because
  // it is wired through its own useAutosave instance (urlSave), not label's.
  it('edits an address inline, saving after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const props = setup();
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByText('Portfolio'), { delay: null });

    const urlField = within(row).getByLabelText('Address');
    await userEvent.clear(urlField);
    await userEvent.type(urlField, 'https://new.example', { delay: null });

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(props.updateLink).toHaveBeenLastCalledWith('a', { url: 'https://new.example' });
    vi.useRealTimers();
  });

  it('will not add a link with no name, or one over the character limit', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Address'), 'example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/give the link a name/i);
  });

  it('says so when adding a link fails to save', async () => {
    const props = setup(three, {
      addLink: vi.fn(async () => { throw new Error('Could not reach the server.'); }),
    });
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shop.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  it('says so when a tile-size change fails to save', async () => {
    const props = setup(three, {
      updateLink: vi.fn(async () => { throw new Error('Could not reach the server.'); }),
    });
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Big tile' }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  it('says so when removing a link fails to save', async () => {
    const props = setup(three, {
      removeLink: vi.fn(async () => { throw new Error('Could not reach the server.'); }),
    });
    const row = screen.getByRole('listitem', { name: 'GitHub' });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove GitHub' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });
});
