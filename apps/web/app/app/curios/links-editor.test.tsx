import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  // Fix round 1, Important #1: the preview reflects a size choice
  // immediately (from local state), independent of whether the save behind
  // it succeeds -- so a failed save shows the error but does not un-choose
  // the tile the owner just picked.
  //
  // Fix round 2: this is now the size group's own SaveState, not a
  // section-level Callout, and SaveState only surfaces an ApiError's own
  // message -- a plain Error (a dropped connection, here) gets the generic
  // sentence, with Retry.
  it('keeps a chosen tile size on screen, but says so, when the save fails', async () => {
    const props = setup(three, {
      updateLink: vi.fn(async () => { throw new Error('Could not reach the server.'); }),
    });
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Big tile' }));

    expect(props.onChange).toHaveBeenCalledWith(three.map((link) => (link.id === 'a' ? { ...link, size: 'BIG' } : link)));
    expect(await screen.findByRole('alert')).toHaveTextContent(/that did not save/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  // Fix round 1, Important #3 (the removal half): removal is optimistic, the
  // same way `move` already is -- the row disappears immediately, and only
  // snaps back if `removeLink` itself is refused.
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

  // Fix round 1, Important #2: the inline editor must be reachable without a
  // pointer.
  it('opens the inline editor from the keyboard', async () => {
    setup();
    const editButton = screen.getByRole('button', { name: 'Edit Portfolio' });
    editButton.focus();
    await userEvent.keyboard('{Enter}');

    expect(within(screen.getByRole('listitem', { name: 'Portfolio' })).getByLabelText('Name')).toBeInTheDocument();
  });

  // Fix round 1, Important #3 (the coordination half): a save scheduled a
  // moment before removal must not land afterwards and report a spurious
  // failure for a link that is already gone.
  //
  // This needs a real stateful harness, not `setup()`'s static `links` prop
  // and no-op `onChange` spy: what actually cancels the pending debounce is
  // `LinkRow` unmounting when the link leaves the array, and a spy that never
  // feeds back into a re-render would leave the row (and its timer) alive no
  // matter what `remove` does. `fireEvent` (synchronous, no per-interaction
  // real-time cost) drives it, because a handful of `userEvent` interactions
  // with `shouldAdvanceTime: true` can themselves burn past 600ms of
  // simulated time in this environment before the assertion even runs -- and
  // without `shouldAdvanceTime`, userEvent hangs against fake timers here.
  it('drops a pending inline save when the link is removed before it fires', async () => {
    vi.useFakeTimers();
    const updateLink = vi.fn(async (id: string, patch: Partial<LinkItem>) => ({ ...three.find((l) => l.id === id)!, ...patch }));
    const removeLink = vi.fn(async () => undefined);

    function Harness() {
      const [links, setLinks] = useState(three);
      return <LinksEditor links={links} onChange={setLinks} addLink={vi.fn()} updateLink={updateLink} removeLink={removeLink} reorder={vi.fn()} />;
    }
    render(<Harness />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    // Captured before typing: the live update (Fix #1) renames "Remove
    // Portfolio" to "Remove Work" the instant the field changes, same as the
    // row's own accessible name.
    const removeButton = within(row).getByRole('button', { name: 'Remove Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Name'), { target: { value: 'Work' } });
    fireEvent.click(removeButton);
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));

    // The row is gone already -- proof the removal itself is optimistic and
    // did not wait on `removeLink` to unmount it.
    expect(row).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(updateLink).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    vi.useRealTimers();
  });

  // Fix round 1, Important #3 (the guard, exercised on its own): a save that
  // was already in flight -- not merely scheduled -- when removal happened
  // must not resurrect the link or report a failure once it settles. A size
  // click persists immediately (no debounce), which is what makes it easy to
  // catch mid-flight with a promise this test controls by hand.
  //
  // The exact wording of the bug ("updateLink can land after removeLink and
  // show a spurious 'did not save'") is about the FAILURE branch: a success
  // reconciles via `.map()`, which cannot resurrect an id that is no longer
  // in the array either way, so only a rejected in-flight save actually
  // exercises the guard.
  it('does not report a stale save failure for a link that was removed while it was in flight', async () => {
    let rejectUpdate!: (failure: Error) => void;
    const updateLink = vi.fn(() => new Promise<LinkItem>((_resolve, reject) => { rejectUpdate = reject; }));
    const removeLink = vi.fn(async () => undefined);

    function Harness() {
      const [links, setLinks] = useState(three);
      return <LinksEditor links={links} onChange={setLinks} addLink={vi.fn()} updateLink={updateLink} removeLink={removeLink} reorder={vi.fn()} />;
    }
    render(<Harness />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Big tile' }));
    expect(updateLink).toHaveBeenCalled();

    fireEvent.click(within(row).getByRole('button', { name: 'Remove Portfolio' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    expect(row).not.toBeInTheDocument();

    // The stale save fails only now -- after the link is already gone.
    await act(async () => { rejectUpdate(new Error('Could not reach the server.')); });

    expect(screen.queryByText('Portfolio')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Fix round 1, Folded Minor: reopening the editor must show what the
  // server actually saved (e.g. a normalised address), not the last-typed
  // value from before that save resolved.
  //
  // `setup()` renders `LinksEditor` with a static `links` prop and a spy for
  // `onChange` -- exactly right for asserting what was PASSED UP, but the
  // component never re-renders with the reconciled array, so it cannot show
  // whether a later prop change is what the editor displays. This test needs
  // a real round trip, so it wires `onChange` back into state itself, the
  // same shape `MyCuriosEditor` uses in production.
  it('shows the normalised address after reopening the inline editor', async () => {
    vi.useFakeTimers();
    const updateLink = vi.fn(async (id: string, patch: Partial<LinkItem>) => ({
      ...three.find((link) => link.id === id)!,
      ...patch,
      url: 'https://wa.me/60123',
    }));

    function Harness() {
      const [links, setLinks] = useState(three);
      return <LinksEditor links={links} onChange={setLinks} addLink={vi.fn()} updateLink={updateLink} removeLink={vi.fn()} reorder={vi.fn()} />;
    }
    render(<Harness />);

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

  // Fix round 2, Important #1: a failed label save must show Retry beside
  // the field (not "Saved"), and Retry must resend exactly the same label --
  // proving `onPersist` now hands useAutosave a promise it can actually see
  // reject, instead of the old `Promise.resolve(void persist(...))` that
  // always resolved regardless of what `persist` did.
  it('offers Retry beside a failed label save, and Retry sends the same label again', async () => {
    vi.useFakeTimers();
    const updateLink = vi.fn(async () => { throw new Error('offline'); });
    setup(three, { updateLink });

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Name'), { target: { value: 'Work' } });

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(updateLink).toHaveBeenCalledWith('a', { label: 'Work' });
    expect(screen.queryByText('Saved')).toBeNull();

    const retry = within(row).getByRole('button', { name: 'Retry' });
    updateLink.mockClear();
    await act(async () => { fireEvent.click(retry); });

    expect(updateLink).toHaveBeenCalledWith('a', { label: 'Work' });
    vi.useRealTimers();
  });

  // The size half of the same fix: its own SaveState, its own Retry, and
  // Retry resends the size the owner actually chose (read off the current
  // `link.size`, which the optimistic `onLiveChange` already applied). Needs
  // the stateful harness, not `setup()`'s static `links` prop and no-op
  // `onChange` spy: Retry reads `link.size` off the CURRENT prop, and only a
  // caller that actually echoes `onChange` back into `links` (as
  // `MyCuriosEditor` does) ever updates it away from the value `setup()`
  // renders it with.
  it('offers Retry beside a failed size save, and Retry sends the same size again', async () => {
    const updateLink = vi.fn(async () => { throw new Error('offline'); });

    function Harness() {
      const [links, setLinks] = useState(three);
      return <LinksEditor links={links} onChange={setLinks} addLink={vi.fn()} updateLink={updateLink} removeLink={vi.fn()} reorder={vi.fn()} />;
    }
    render(<Harness />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Big tile' })); });
    expect(updateLink).toHaveBeenCalledWith('a', { size: 'BIG' });

    const retry = await within(row).findByRole('button', { name: 'Retry' });
    updateLink.mockClear();
    await act(async () => { fireEvent.click(retry); });

    expect(updateLink).toHaveBeenCalledWith('a', { size: 'BIG' });
  });

  // Fix round 2, Important #1's merge rule: `persist` must apply only the
  // keys a given call actually sent (`pick(saved, keys(change))`), not the
  // server's whole row -- otherwise a size save that lands while a label
  // save is still pending would overwrite that label with the stale copy
  // the size response happens to carry for it.
  it('does not let a size save that succeeds overwrite a label save still pending', async () => {
    let resolveLabelSave!: (link: LinkItem) => void;
    const updateLink = vi.fn((id: string, patch: Partial<LinkItem>) => {
      if ('label' in patch) return new Promise<LinkItem>((resolve) => { resolveLabelSave = resolve; });
      return Promise.resolve({ ...three.find((l) => l.id === id)!, ...patch });
    });

    function Harness() {
      const [links, setLinks] = useState(three);
      return <LinksEditor links={links} onChange={setLinks} addLink={vi.fn()} updateLink={updateLink} removeLink={vi.fn()} reorder={vi.fn()} />;
    }
    vi.useFakeTimers();
    render(<Harness />);

    // `aria-label` on the row is bound straight to the `link.label` prop,
    // in or out of edit mode -- unlike the Name field's value, which is
    // local state that only re-syncs from the prop when the editor reopens.
    // It is what actually proves whether the prop itself got clobbered.
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    fireEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    fireEvent.change(within(row).getByLabelText('Name'), { target: { value: 'Work' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(updateLink).toHaveBeenCalledWith('a', { label: 'Work' });

    // The size click saves at once, no debounce, and its response --
    // `{ ...original row (label: 'Portfolio'), size: 'BIG' }` -- lands
    // before the label save above (still in flight) ever resolves. A merge
    // that applies the whole response wholesale reverts the label to its
    // stale "Portfolio" right here, before the label save even settles.
    fireEvent.click(within(row).getByRole('button', { name: 'Big tile' }));
    await act(async () => {});

    expect(row).toHaveAttribute('aria-label', 'Work');

    // And once the label save itself resolves -- with a server copy whose
    // own `label` field agrees, since this is the response to the label
    // request -- the prop still correctly reads 'Work'.
    await act(async () => { resolveLabelSave({ id: 'a', label: 'Work', url: three[0]!.url, size: 'BIG' }); });

    expect(row).toHaveAttribute('aria-label', 'Work');
    vi.useRealTimers();
  });

  // Fix round 2, Minor #7: focus follows the inline editor open and closed --
  // into the first field when it appears, back to the button that opened it
  // once it is gone.
  it('moves focus into the inline editor on open, and back to the Edit button on close', () => {
    setup();
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    const editButton = within(row).getByRole('button', { name: 'Edit Portfolio' });

    fireEvent.click(editButton);
    expect(within(row).getByLabelText('Name')).toHaveFocus();

    fireEvent.click(within(row).getByRole('button', { name: 'Done' }));
    expect(within(row).getByRole('button', { name: 'Edit Portfolio' })).toHaveFocus();
  });

  // The confirm half of the same fix: focus goes to "Keep" -- the safer
  // default -- when the confirm appears, and back to the Remove button that
  // triggered it once the owner keeps the link after all.
  it('moves focus to Keep when the remove confirm appears, and back to Remove once kept', () => {
    setup();
    const row = screen.getByRole('listitem', { name: 'GitHub' });
    const removeButton = within(row).getByRole('button', { name: 'Remove GitHub' });

    fireEvent.click(removeButton);
    expect(within(row).getByRole('button', { name: 'Keep' })).toHaveFocus();

    fireEvent.click(within(row).getByRole('button', { name: 'Keep' }));
    expect(within(row).getByRole('button', { name: 'Remove GitHub' })).toHaveFocus();
  });
});
