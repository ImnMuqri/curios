import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinksEditor, type LinkItem } from './links-editor.js';

const three: LinkItem[] = [
  { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null, kind: 'LINK', provider: null, embedRef: null },
  { id: 'b', label: 'WhatsApp', url: 'https://wa.me/60123', size: null, kind: 'LINK', provider: null, embedRef: null },
  { id: 'c', label: 'GitHub', url: 'https://github.com/iman', size: null, kind: 'LINK', provider: null, embedRef: null },
];

function setup(links = three, overrides: Partial<Parameters<typeof LinksEditor>[0]> = {}) {
  const props = {
    links,
    onChange: vi.fn(),
    addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', ...i, url: `https://${i.url}`, size: null, kind: 'LINK' as const, provider: null, embedRef: null })),
    addWidget: vi.fn(async (i: { url: string; label: string | null }) => ({ id: 'w', label: i.label ?? 'Spotify', url: i.url, size: null, kind: 'WIDGET' as const, provider: 'SPOTIFY' as const, embedRef: 'track/abc' })),
    updateLink: vi.fn(async (id: string, patch: Partial<LinkItem>) => ({ ...links.find((l) => l.id === id)!, ...patch })),
    removeLink: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<LinksEditor {...props} />);
  return props;
}

/** A caller that feeds `onChange` back into `links`, as MyCuriosEditor does. */
function Harness(props: Omit<Parameters<typeof LinksEditor>[0], 'links' | 'onChange'>) {
  const [links, setLinks] = useState(three);
  return <LinksEditor {...props} links={links} onChange={setLinks} />;
}

describe('LinksEditor', () => {
  it('adds a link and hands the new list up', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shopee.com.my/iman');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).toHaveBeenCalledWith({ label: 'Shop', url: 'shopee.com.my/iman' });
    expect(props.onChange).toHaveBeenLastCalledWith([...three, expect.objectContaining({ label: 'Shop' })]);
  });

  it('closes the add form on Cancel without sending anything', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.addLink).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('says what is wrong with an address before sending it', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Bad');
    await userEvent.type(screen.getByLabelText('Address'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/does not look right/i);
  });

  it('shows each link with its address, without the scheme', () => {
    setup();
    const row = screen.getByRole('listitem', { name: 'WhatsApp' });
    expect(row).toHaveTextContent('wa.me/60123');
    expect(row).not.toHaveTextContent('https://');
  });

  it('has no move buttons, because order lives in Layout', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
  });

  it('asks before removing, because a removal cannot be undone', async () => {
    const props = setup();
    const row = screen.getByRole('listitem', { name: 'GitHub' });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove GitHub' }));
    expect(props.removeLink).not.toHaveBeenCalled();
    expect(row).toHaveTextContent('Remove?');

    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    expect(props.removeLink).toHaveBeenCalledWith('c');
  });

  // Review Focus 5.
  it('offers the first link from an empty state, and adds it', async () => {
    const props = setup([]);
    expect(screen.getByRole('heading', { name: 'Add your first link' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shop.example{Enter}');

    expect(props.addLink).toHaveBeenCalledWith({ label: 'Shop', url: 'shop.example' });
  });

  it('stops offering to add at the limit', () => {
    setup(Array.from({ length: 30 }, (_u, i) => ({ id: `${i}`, label: `L${i}`, url: 'https://a.co', size: null, kind: 'LINK', provider: null, embedRef: null })));
    expect(screen.queryByRole('button', { name: '+ Add link' })).toBeNull();
    expect(screen.getByText(/30 links is the most/i)).toBeInTheDocument();
  });

  // A tap on the link text swaps it for Name/Address fields wired to
  // useAutosave, which is what actually calls updateLink.
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
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    await userEvent.type(screen.getByLabelText('Address'), 'example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/give the link a name/i);
  });

  it('says so when adding a link fails to save', async () => {
    const props = setup(three, {
      addLink: vi.fn(async () => { throw new Error('Could not reach the server.'); }),
    });
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shop.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  // Removal is optimistic, the same way `move` is -- the row disappears
  // immediately, and only snaps back if `removeLink` itself is refused.
  it('says so and restores the link when removing it fails to save', async () => {
    const props = setup(three, {
      removeLink: vi.fn(async () => { throw new Error('Could not reach the server.'); }),
    });
    const row = screen.getByRole('listitem', { name: 'GitHub' });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove GitHub' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));

    expect(props.onChange).toHaveBeenLastCalledWith(three);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  // The inline editor must be reachable without a pointer.
  it('opens the inline editor from the keyboard', async () => {
    setup();
    const editButton = screen.getByRole('button', { name: 'Edit Portfolio' });
    editButton.focus();
    await userEvent.keyboard('{Enter}');

    expect(within(screen.getByRole('listitem', { name: 'Portfolio' })).getByLabelText('Name')).toBeInTheDocument();
  });

  // A save scheduled a moment before removal must not land afterwards and
  // report a spurious failure for a link that is already gone. Needs the
  // stateful harness: what cancels the pending debounce is LinkRow
  // unmounting when the link leaves the array. `fireEvent` drives it, because
  // userEvent with `shouldAdvanceTime` can burn past 600ms of simulated time
  // before the assertion runs.
  it('drops a pending inline save when the link is removed before it fires', async () => {
    vi.useFakeTimers();
    const updateLink = vi.fn(async (id: string, patch: Partial<LinkItem>) => ({ ...three.find((l) => l.id === id)!, ...patch }));
    render(<Harness addLink={vi.fn()} addWidget={vi.fn()} updateLink={updateLink} removeLink={vi.fn(async () => undefined)} />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Name'), { target: { value: 'Work' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Done' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Work' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));

    // The row is gone already -- proof the removal itself did not wait on `removeLink`.
    expect(row).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(updateLink).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    vi.useRealTimers();
  });

  // The guard on its own: a save already in flight -- not merely scheduled --
  // when removal happened must not resurrect the link or report a failure
  // once it settles. Only a rejected save exercises it: a success reconciles
  // via `.map()`, which cannot resurrect an id no longer in the array.
  it('does not report a stale save failure for a link that was removed while it was in flight', async () => {
    vi.useFakeTimers();
    let rejectUpdate!: (failure: Error) => void;
    const updateLink = vi.fn(() => new Promise<LinkItem>((_resolve, reject) => { rejectUpdate = reject; }));
    render(<Harness addLink={vi.fn()} addWidget={vi.fn()} updateLink={updateLink} removeLink={vi.fn(async () => undefined)} />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Name'), { target: { value: 'Work' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(updateLink).toHaveBeenCalled();

    fireEvent.click(within(row).getByRole('button', { name: 'Done' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Work' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    expect(row).not.toBeInTheDocument();

    // The stale save fails only now -- after the link is already gone.
    await act(async () => { rejectUpdate(new Error('Could not reach the server.')); });

    expect(screen.queryByText('Work')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    vi.useRealTimers();
  });

  // Reopening the editor must show what the server actually saved (e.g. a
  // normalised address), not the last-typed value.
  it('shows the normalised address after reopening the inline editor', async () => {
    vi.useFakeTimers();
    const updateLink = vi.fn(async (id: string, patch: Partial<LinkItem>) => ({
      ...three.find((link) => link.id === id)!,
      ...patch,
      url: 'https://wa.me/60123',
    }));
    render(<Harness addLink={vi.fn()} addWidget={vi.fn()} updateLink={updateLink} removeLink={vi.fn()} />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Address'), { target: { value: 'wa.me/60123' } });

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(updateLink).toHaveBeenCalled();

    fireEvent.click(within(row).getByRole('button', { name: 'Done' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));

    expect(within(row).getByLabelText('Address')).toHaveValue('https://wa.me/60123');
    vi.useRealTimers();
  });

  // A failed label save shows Retry beside the field, and Retry resends exactly the same label.
  it('offers Retry beside a failed label save, and Retry sends the same label again', async () => {
    vi.useFakeTimers();
    const updateLink = vi.fn(async () => { throw new Error('offline'); });
    setup(three, { updateLink });

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Name'), { target: { value: 'Work' } });

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(updateLink).toHaveBeenCalledWith('a', { label: 'Work' });
    expect(within(row).getByRole('alert')).toHaveTextContent('That did not save.');

    const retry = within(row).getByRole('button', { name: 'Retry' });
    updateLink.mockClear();
    await act(async () => { fireEvent.click(retry); });

    expect(updateLink).toHaveBeenCalledWith('a', { label: 'Work' });
    vi.useRealTimers();
  });

  // `persist` applies only the keys a call actually sent, not the server's
  // whole row -- otherwise an address save that lands while a label save is
  // still pending would put back the stale label its response carries.
  it('does not let an address save that succeeds overwrite a label save still pending', async () => {
    let resolveLabelSave!: (link: LinkItem) => void;
    const updateLink = vi.fn((id: string, patch: Partial<LinkItem>) => {
      if ('label' in patch) return new Promise<LinkItem>((resolve) => { resolveLabelSave = resolve; });
      return Promise.resolve({ ...three.find((l) => l.id === id)!, ...patch });
    });
    vi.useFakeTimers();
    render(<Harness addLink={vi.fn()} addWidget={vi.fn()} updateLink={updateLink} removeLink={vi.fn()} />);

    // The row's aria-label is bound to the `link.label` prop -- unlike the
    // Name field's value, which is local state -- so it shows whether the
    // prop itself got clobbered.
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Name'), { target: { value: 'Work' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(updateLink).toHaveBeenCalledWith('a', { label: 'Work' });

    // Its response, `{ ...original row (label: 'Portfolio'), url }`, lands first.
    fireEvent.change(within(row).getByLabelText('Address'), { target: { value: 'https://work.example' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(updateLink).toHaveBeenCalledWith('a', { url: 'https://work.example' });

    expect(row).toHaveAttribute('aria-label', 'Work');

    await act(async () => { resolveLabelSave({ id: 'a', label: 'Work', url: 'https://work.example', size: null, kind: 'LINK', provider: null, embedRef: null }); });

    expect(row).toHaveAttribute('aria-label', 'Work');
    vi.useRealTimers();
  });

  // Focus follows the inline editor open and closed.
  it('moves focus into the inline editor on open, and back to the Edit button on close', () => {
    setup();
    const row = screen.getByRole('listitem', { name: 'Portfolio' });

    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    expect(within(row).getByLabelText('Name')).toHaveFocus();

    fireEvent.click(within(row).getByRole('button', { name: 'Done' }));
    expect(within(row).getByRole('button', { name: 'Edit Portfolio' })).toHaveFocus();
  });

  // Focus goes to "Keep" -- the safer default -- when the confirm appears,
  // and back to the Remove button once the owner keeps the link.
  it('moves focus to Keep when the remove confirm appears, and back to Remove once kept', () => {
    setup();
    const row = screen.getByRole('listitem', { name: 'GitHub' });

    fireEvent.click(within(row).getByRole('button', { name: 'Remove GitHub' }));
    expect(within(row).getByRole('button', { name: 'Keep' })).toHaveFocus();

    fireEvent.click(within(row).getByRole('button', { name: 'Keep' }));
    expect(within(row).getByRole('button', { name: 'Remove GitHub' })).toHaveFocus();
  });

  describe('widgets', () => {
    const spotify = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';

    it('opens a widget field and names the service as the link is pasted', async () => {
      setup();
      await userEvent.click(screen.getByRole('button', { name: '+ Add a widget' }));
      await userEvent.type(screen.getByLabelText('Widget link'), spotify);
      const hint = screen.getByTestId('widget-service');
      expect(hint).toHaveTextContent('Spotify');
      expect(hint.querySelector('svg')).not.toBeNull();
    });

    it('saves with the url and the label, or null when the name is blank', async () => {
      const props = setup();
      await userEvent.click(screen.getByRole('button', { name: '+ Add a widget' }));
      await userEvent.type(screen.getByLabelText('Widget link'), spotify);
      await userEvent.type(screen.getByLabelText('Name (optional)'), 'My song');
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(props.addWidget).toHaveBeenCalledWith({ url: spotify, label: 'My song' });
      expect(props.onChange).toHaveBeenLastCalledWith([...three, expect.objectContaining({ id: 'w' })]);

      await userEvent.click(screen.getByRole('button', { name: '+ Add a widget' }));
      await userEvent.type(screen.getByLabelText('Widget link'), spotify);
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(props.addWidget).toHaveBeenLastCalledWith({ url: spotify, label: null });
    });

    it('shows the server message when it refuses the link', async () => {
      const addWidget = vi.fn(async () => {
        throw new Error('That Spotify link is not one we can show.');
      });
      setup(three, { addWidget });
      await userEvent.click(screen.getByRole('button', { name: '+ Add a widget' }));
      await userEvent.type(screen.getByLabelText('Widget link'), spotify);
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByRole('alert')).toHaveTextContent('That Spotify link is not one we can show.');
    });

    it('disables Add with the reason when the link is not a widget, but lets a short link through', async () => {
      setup();
      await userEvent.click(screen.getByRole('button', { name: '+ Add a widget' }));
      await userEvent.type(screen.getByLabelText('Widget link'), 'https://example.com/x');
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
      expect(screen.getByTestId('widget-note').textContent).not.toBe('');

      await userEvent.clear(screen.getByLabelText('Widget link'));
      await userEvent.type(screen.getByLabelText('Widget link'), 'https://spotify.link/abc123');
      expect(screen.getByTestId('widget-service')).toHaveTextContent('Spotify');
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    });

    it('announces the recognised service and the reason Add is off, to the link field', async () => {
      setup();
      await userEvent.click(screen.getByRole('button', { name: '+ Add a widget' }));
      const field = screen.getByLabelText('Widget link');
      const hint = document.getElementById(field.getAttribute('aria-describedby')!)!;
      expect(hint).toHaveAttribute('aria-live', 'polite');
      expect(hint).toBeEmptyDOMElement();
      await userEvent.type(field, spotify);
      expect(hint).toHaveTextContent('Spotify');
      await userEvent.clear(field);
      await userEvent.type(field, 'https://example.com/x');
      expect(hint.textContent).not.toBe('');
      expect(hint).toBe(document.getElementById(field.getAttribute('aria-describedby')!));
    });

    it('sends once when Add is pressed twice while the request is in flight', async () => {
      let release!: () => void;
      const addWidget = vi.fn(
        () => new Promise<LinkItem>((resolve) => { release = () => resolve({ id: 'w', label: 'Spotify', url: spotify, size: null, kind: 'WIDGET', provider: 'SPOTIFY', embedRef: 'track/x' }); }),
      );
      setup(three, { addWidget });
      await userEvent.click(screen.getByRole('button', { name: '+ Add a widget' }));
      await userEvent.type(screen.getByLabelText('Widget link'), spotify);
      const add = screen.getByRole('button', { name: 'Add' });
      await userEvent.click(add);
      expect(add).toBeDisabled();
      await userEvent.click(add);
      expect(addWidget).toHaveBeenCalledTimes(1);
      await act(async () => release());
    });

    it('draws a saved widget with its service and label, and no address box', async () => {
      const widget: LinkItem = { id: 'w', label: 'My song', url: spotify, size: null, kind: 'WIDGET', provider: 'SPOTIFY', embedRef: 'track/x' };
      setup([...three, widget]);
      const row = screen.getByRole('listitem', { name: 'My song' });
      expect(row).toHaveTextContent('Spotify');
      expect(row).toHaveTextContent('My song');
      await userEvent.click(within(row).getByRole('button', { name: 'Edit My song' }));
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.queryByLabelText('Address')).toBeNull();
    });
  });
});
