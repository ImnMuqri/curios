import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FactCategory } from '@curios/core';
import type { KnowledgeFact } from '@curios/db-read';
import { FactList } from './facts-tab.js';

const facts: KnowledgeFact[] = [
  { id: 'f1', category: 'PRICE', claim: 'Kek RM95.', origin: 'EXTRACTED', sourceLabel: 'https://nadia.example/menu/' },
  { id: 'f2', category: 'HOURS', claim: 'Closed Sunday.', origin: 'OWNER', sourceLabel: null },
  { id: 'f3', category: 'HOURS', claim: 'Open 9 to 5.', origin: 'UNTRACKED', sourceLabel: null },
  { id: 'f4', category: 'PERSON', claim: 'Baking since 2019.', origin: 'EXTRACTED', sourceLabel: 'Raya 2026 order list' },
];

function list(overrides: Partial<Parameters<typeof FactList>[0]> = {}) {
  const props = {
    facts,
    categories: ['PRICE', 'HOURS', 'PERSON', 'MISC'] as FactCategory[],
    ownerFactMax: 500,
    onAdd: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(),
    ...overrides,
  };
  render(<FactList {...props} />);
  return props;
}

const card = (claim: string) => screen.getByText(claim).closest('li') as HTMLElement;

async function openAdd() {
  await userEvent.click(screen.getByRole('button', { name: '+ Add a fact' }));
}

describe('FactList', () => {
  it('groups facts by kind, in the board’s words', () => {
    list();
    expect(screen.getByRole('heading', { name: 'Hours' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Price' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Other' })).toBeNull();
  });

  it('labels each fact by where it came from, the address without its scheme', () => {
    list();
    expect(within(card('Kek RM95.')).getByText('nadia.example/menu')).toBeInTheDocument();
    expect(within(card('Closed Sunday.')).getByText('Added by you')).toBeInTheDocument();
    expect(within(card('Open 9 to 5.')).getByText('Before tracking')).toBeInTheDocument();
    expect(within(card('Baking since 2019.')).getByText('Raya 2026 order list')).toBeInTheDocument();
  });

  it('filters by kind, counting each, and offers only kinds that have facts', async () => {
    list();
    const show = screen.getByRole('group', { name: 'Show' });
    expect(within(show).getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(show).queryByRole('button', { name: /Other/ })).toBeNull();

    await userEvent.click(within(show).getByRole('button', { name: 'Hours 2' }));
    expect(screen.queryByText('Kek RM95.')).toBeNull();
    expect(screen.getByText('Closed Sunday.')).toBeInTheDocument();
  });

  it('adds a fact with its kind, trusted straight away', async () => {
    const { onAdd, onChanged } = list();
    await openAdd();
    expect(screen.getByText(/trusted straight away/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }));
    await userEvent.type(screen.getByLabelText('New fact'), 'Parking at the back.');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith('MISC', 'Parking at the back.');
    expect(onChanged).toHaveBeenCalled();
    // The line closes, and says so.
    expect(screen.queryByLabelText('New fact')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Added. The chat can use it now.');
  });

  it('starts a new fact in the kind being shown', async () => {
    list();
    await userEvent.click(screen.getByRole('button', { name: 'Hours 2' }));
    await openAdd();
    expect(screen.getByRole('radio', { name: 'Hours' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps what the owner typed when adding fails, says why, and puts focus back', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('You already have a fact that says this.'));
    const { onChanged } = list({ onAdd });
    await openAdd();
    await userEvent.type(screen.getByLabelText('New fact'), 'Kek RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a fact that says this.');
    expect(screen.getByLabelText('New fact')).toHaveValue('Kek RM95.');
    expect(screen.getByLabelText('New fact')).toHaveFocus();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('can open with the add line showing', () => {
    list({ startAdding: true });
    expect(screen.getByLabelText('New fact')).toHaveFocus();
  });

  it('edits a fact in place', async () => {
    const { onEdit, onChanged } = list();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit fact' }));
    const field = screen.getByRole('textbox', { name: 'Edit fact' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Kek RM99.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('f1', 'Kek RM99.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the draft and says why when saving an edit fails', async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error('That is not a usable fact.'));
    const { onChanged } = list({ onEdit });
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit fact' }));
    const field = screen.getByRole('textbox', { name: 'Edit fact' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Kek RM99.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('That is not a usable fact.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kek RM99.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('cancelling an edit restores the original claim', async () => {
    const { onEdit } = list();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit fact' }));
    await userEvent.type(screen.getByDisplayValue('Kek RM95.'), ' extra');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEdit).not.toHaveBeenCalled();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit fact' }));
    expect(screen.getByDisplayValue('Kek RM95.')).toBeInTheDocument();
  });

  it('removes a fact only after confirming, and Keep keeps it', async () => {
    const { onRemove, onChanged } = list();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Remove fact' }));
    expect(screen.getByText(/a re-read won’t bring it back/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Kek RM95.')).toBeInTheDocument();

    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Remove fact' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('f1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('says why when removing fails, and keeps the fact', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('A re-check is running. Try again shortly.'));
    const { onChanged } = list({ onRemove });
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Remove fact' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('A re-check is running. Try again shortly.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('filters by search', async () => {
    list();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search facts' }), 'sunday');
    expect(screen.queryByText('Kek RM95.')).toBeNull();
    expect(screen.getByText('Closed Sunday.')).toBeInTheDocument();
  });

  it('says so when a search matches nothing, and keeps the no-facts message for no facts', async () => {
    list();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search facts' }), 'zzzz');
    expect(screen.getByText('No match')).toBeInTheDocument();
    expect(screen.queryByText(/knows nothing yet/i)).toBeNull();
  });

  it('has an empty state that offers a source or a fact of your own', async () => {
    list({ facts: [] });
    expect(screen.getByText(/your page knows nothing yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a source' })).toHaveAttribute('href', '/app/knowledge?tab=sources&add=1');
    await userEvent.click(screen.getByRole('button', { name: 'Write a fact' }));
    expect(screen.getByLabelText('New fact')).toBeInTheDocument();
  });
});
