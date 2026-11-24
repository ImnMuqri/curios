import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FactCard } from './fact-card.js';

const fact = {
  id: 'f-1',
  category: 'PRICE' as const,
  claim: 'Kuih lapis is RM12 a box',
  sourceText: 'Our kuih lapis is RM12 per box, minimum two boxes.',
  sourceBefore: null,
  sourceAfter: null,
  sourceUrl: 'https://nadia.example/menu',
  question: 'Berapa harga kuih lapis?',
  confidence: 0.91,
};

describe('FactCard', () => {
  it('shows the line it came from', () => {
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} />);

    // sourceText exists in the schema commented "the line it came from, for
    // the review screen". Without it the owner is asked to approve a claim
    // with no way to check it against anything.
    expect(screen.getByText(/minimum two boxes/i)).toBeInTheDocument();
  });

  it('picks the excerpt out of the line around it, when the line was kept', () => {
    render(
      <FactCard
        fact={{ ...fact, sourceBefore: 'Kuih of the day. ', sourceText: 'RM12 per box', sourceAfter: ', minimum two boxes.' }}
        onAccept={vi.fn()}
        onEdit={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const picked = screen.getByText('RM12 per box');
    expect(picked.tagName).toBe('B');
    expect(picked.parentElement).toHaveTextContent('“Kuih of the day. RM12 per box, minimum two boxes.”');
  });

  it('accepts exactly one fact and says which', async () => {
    const onAccept = vi.fn();
    render(<FactCard fact={fact} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    // Two lines rather than toHaveBeenCalledExactlyOnceWith -- see A1. The
    // count is half the assertion: a double-fire is a double POST.
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('f-1');
  });

  it('offers no control that acts on more than this fact', () => {
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} />);

    // The product's single hard rule, asserted at the surface that would
    // violate it. Nothing sets verified: true except an explicit human action
    // on one specific fact -- no select-all, no accept-remaining, no
    // confidence threshold. This test fails the day someone adds one.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of buttons) {
      expect(label).not.toMatch(/all|remaining|rest|everything/i);
    }
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('lets the claim be edited, because a wrong price is the thing to fix', async () => {
    // Resolves true = saved. A bare vi.fn() resolves undefined, which now
    // reads as "not saved" and correctly keeps the textarea open -- see A5.
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /fix it/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onEdit).toHaveBeenCalledWith('f-1', 'Kuih lapis is RM14 a box');
  });

  it('keeps the textarea open with the typed correction after a failed edit', async () => {
    // F2/A5 regression guard. `onEdit` resolves to `false` for a failed edit
    // -- ReviewQueue has already turned the failure into a message by the
    // time this resolves (see review-queue.test.tsx's FACT_DUPLICATE test)
    // -- and the card must not close the textarea except on `true`.
    // FACT_DUPLICATE is a normal outcome, not a crash, and this is the one
    // screen in the product where a human writes prose: closing the
    // textarea here throws that prose away and leaves the owner to retype
    // it from memory. Written first and watched failing against the
    // pre-fix code (Save fired onEdit then closed the textarea
    // unconditionally) -- see the report for the failure verbatim.
    const onEdit = vi.fn().mockResolvedValue(false);
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /fix it/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('textbox')).toHaveValue('Kuih lapis is RM14 a box');
  });

  it('closes the textarea after a successful edit', async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /fix it/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    // Back to view mode -- the Fix it button reappears, and there is no
    // textarea anymore. (This card doesn't know the corrected claim itself;
    // showing it is `ReviewQueue`'s job via the `edits` override, exercised
    // in review-queue.test.tsx's "keeps an edited card..." test.)
    expect(await screen.findByRole('button', { name: /^fix it$/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('leaves the card usable if a handler rejects', async () => {
    // `ReviewQueue` catches its own failures, so this cannot happen through
    // the wrapper. But this card is exported and rendered on its own, and
    // without a `finally` the busy flag would stick -- disabling Accept,
    // Fix it and Reject for good, with no recourse but a page reload, on the
    // highest-leverage screen in the product.
    const onAccept = vi.fn().mockRejectedValue(new Error('network gone'));
    render(<FactCard fact={fact} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} />);

    const accept = screen.getByRole('button', { name: /accept/i });
    await userEvent.click(accept);

    expect(onAccept).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(accept).not.toBeDisabled());
    expect(screen.getByRole('button', { name: /fix it/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /reject this fact/i })).not.toBeDisabled();
  });

  it('does not fire onEdit twice on a double tap of Save', async () => {
    let release: (saved: boolean) => void = () => {};
    const onEdit = vi.fn(() => new Promise<boolean>((resolve) => (release = resolve)));
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /fix it/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');

    const save = screen.getByRole('button', { name: /save/i });
    await userEvent.click(save);
    await userEvent.click(save);

    // Two overlapping PATCHes would race, and the later-resolving one wins
    // the displayed claim -- see F2/A5.
    expect(onEdit).toHaveBeenCalledTimes(1);

    // Unlike ClaimForm/SignInForm, resolving here still leaves the card
    // mounted (an edit, success or failure, never removes it) and its own
    // `setBusy(false)`/`setEditing(false)` fire in response -- so the
    // resolution has to be awaited through a query rather than left
    // dangling, or the update lands outside of act().
    release(true);
    expect(await screen.findByRole('button', { name: /^fix it$/i })).toBeInTheDocument();
  });

  it('reads the confidence and the source as the board does', () => {
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} />);

    // "Price · from keklina.example/menu", then "Read clearly from ...".
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getAllByText(/from nadia\.example\/menu/)).toHaveLength(2);
    expect(screen.getByText('Read clearly from nadia.example/menu.')).toBeInTheDocument();
    expect(screen.getByText('A customer might ask')).toBeInTheDocument();
  });

  it('says how sure it is, and where pasted text came from', () => {
    render(<FactCard fact={{ ...fact, confidence: 0.75, sourceUrl: null }} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('Fairly sure of this one from what you wrote.')).toBeInTheDocument();
  });

  it('acts on F, S and A, and not while typing or behind a dialog', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onSkip = vi.fn();
    render(<FactCard fact={fact} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} onSkip={onSkip} />);

    await userEvent.keyboard('s');
    expect(onSkip).toHaveBeenCalledWith('f-1');
    await userEvent.keyboard('a');
    expect(onAccept).toHaveBeenCalledWith('f-1');
    await waitFor(() => expect(screen.getByRole('button', { name: /^accept$/i })).not.toBeDisabled());

    await userEvent.keyboard('f');
    const field = screen.getByRole('textbox');
    // Typing an "a" or an "s" in the claim is typing, not Accept or Skip.
    await userEvent.type(field, 'as');
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('leaves F, S and A alone while a dialog is open', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <div role="dialog" aria-label="Help" />
        <FactCard fact={fact} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} onSkip={vi.fn()} />
      </>,
    );

    await userEvent.keyboard('a');
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('keeps Reject as a quiet option, with no key', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={vi.fn()} onReject={onReject} onSkip={vi.fn()} />);

    await userEvent.keyboard('r');
    expect(onReject).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /reject this fact/i }));
    expect(onReject).toHaveBeenCalledWith('f-1');
  });

  it('puts the cursor in the claim on F, and gives focus back to Fix it after Cancel', async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} onSkip={vi.fn()} />);

    await userEvent.keyboard('f');
    expect(screen.getByRole('textbox')).toHaveFocus();
    // No click: typing alone edits the draft.
    await userEvent.keyboard('!');
    expect(screen.getByRole('textbox')).toHaveValue('Kuih lapis is RM12 a box!');

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.getByRole('button', { name: /^fix it$/i })).toHaveFocus();
  });

  it('does not act on Ctrl+F, Cmd+A or Ctrl+S', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onSkip = vi.fn();
    render(<FactCard fact={fact} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} onSkip={onSkip} />);

    await userEvent.keyboard('{Control>}f{/Control}');
    await userEvent.keyboard('{Meta>}a{/Meta}');
    await userEvent.keyboard('{Control>}s{/Control}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });
});
