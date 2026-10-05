import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FactCategory } from '@curios/core';
import type { KnowledgeFact } from '@curios/db-read';
import { FactList } from './facts-tab.js';

const facts: KnowledgeFact[] = [
  { id: 'f1', category: 'PRICE', claim: 'Kek RM95.', origin: 'EXTRACTED', sourceLabel: 'https://nadia.example/' },
  { id: 'f2', category: 'HOURS', claim: 'Closed Sunday.', origin: 'OWNER', sourceLabel: null },
  { id: 'f3', category: 'HOURS', claim: 'Open 9 to 5.', origin: 'UNTRACKED', sourceLabel: null },
];

function list(overrides: Partial<Parameters<typeof FactList>[0]> = {}) {
  const props = {
    facts,
    categories: ['PRICE', 'HOURS', 'MISC'] as FactCategory[],
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

describe('FactList', () => {
  it('groups facts by category', () => {
    list();
    expect(screen.getByRole('heading', { name: 'Hours' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Price' })).toBeInTheDocument();
  });

  it('labels each fact by where it came from', () => {
    list();
    expect(within(card('Kek RM95.')).getByText('https://nadia.example/')).toBeInTheDocument();
    expect(within(card('Closed Sunday.')).getByText('Added by you')).toBeInTheDocument();
    expect(within(card('Open 9 to 5.')).getByText('Before tracking')).toBeInTheDocument();
  });

  it('adds a fact with its category', async () => {
    const { onAdd, onChanged } = list();
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'MISC');
    await userEvent.type(screen.getByLabelText('A fact'), 'Parking at the back.');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith('MISC', 'Parking at the back.');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByLabelText('A fact')).toHaveValue('');
  });

  it('keeps what the owner typed when adding fails, and says why', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('You already have a fact that says this.'));
    const { onChanged } = list({ onAdd });
    await userEvent.type(screen.getByLabelText('A fact'), 'Kek RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('You already have a fact that says this.')).toBeInTheDocument();
    expect(screen.getByLabelText('A fact')).toHaveValue('Kek RM95.');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('puts focus back on the fact field when adding fails', async () => {
    list({ onAdd: vi.fn().mockRejectedValue(new Error('You already have a fact that says this.')) });
    await userEvent.type(screen.getByLabelText('A fact'), 'Kek RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('You already have a fact that says this.');
    expect(screen.getByLabelText('A fact')).toHaveFocus();
  });

  it('edits a fact in place', async () => {
    const { onEdit, onChanged } = list();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit' }));
    const field = screen.getByDisplayValue('Kek RM95.');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kek RM99.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('f1', 'Kek RM99.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the draft and says why when saving an edit fails', async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error('That is not a usable fact.'));
    const { onChanged } = list({ onEdit });
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit' }));
    const field = screen.getByDisplayValue('Kek RM95.');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kek RM99.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('That is not a usable fact.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kek RM99.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('cancelling an edit restores the original claim', async () => {
    const { onEdit } = list();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByDisplayValue('Kek RM95.'), ' extra');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEdit).not.toHaveBeenCalled();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('Kek RM95.')).toBeInTheDocument();
  });

  it('removes a fact only after confirming', async () => {
    const { onRemove, onChanged } = list();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Remove' }));
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove fact' }));
    expect(onRemove).toHaveBeenCalledWith('f1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('says why when removing fails, and keeps the fact', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('A re-check is running. Try again shortly.'));
    const { onChanged } = list({ onRemove });
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove fact' }));
    expect(screen.getByText('A re-check is running. Try again shortly.')).toBeInTheDocument();
    expect(screen.getByText('Kek RM95.')).toBeInTheDocument();
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
    expect(screen.getByText('No facts match your search')).toBeInTheDocument();
    expect(screen.queryByText(/no facts yet/i)).toBeNull();
  });

  it('shows the same length hint on edit as on add', async () => {
    list();
    await userEvent.click(within(card('Kek RM95.')).getByRole('button', { name: 'Edit' }));
    expect(within(card('Kek RM95.')).getByText('One line, up to 500 characters.')).toBeInTheDocument();
  });

  it('has an empty state', () => {
    list({ facts: [] });
    expect(screen.getByText(/no facts yet/i)).toBeInTheDocument();
  });
});
