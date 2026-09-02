import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FactCard } from './fact-card.js';

const fact = {
  id: 'f-1',
  category: 'PRICE' as const,
  claim: 'Kuih lapis is RM12 a box',
  sourceText: 'Our kuih lapis is RM12 per box, minimum two boxes.',
  sourceUrl: 'https://nadia.example/menu',
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
    const onEdit = vi.fn();
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onEdit).toHaveBeenCalledWith('f-1', 'Kuih lapis is RM14 a box');
  });
});
