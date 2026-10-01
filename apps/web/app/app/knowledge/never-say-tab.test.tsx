import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NeverSayList } from './never-say-tab.js';

const entries = [{ id: 'n1', phrase: 'halal certified' }];

function list(overrides: Partial<Parameters<typeof NeverSayList>[0]> = {}) {
  const props = {
    entries,
    max: 50,
    maxChars: 120,
    onAdd: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(),
    ...overrides,
  };
  render(<NeverSayList {...props} />);
  return props;
}

describe('NeverSayList', () => {
  it('says honestly what it is', () => {
    list();
    expect(screen.getByText(/very reliable, but not a guarantee/i)).toBeInTheDocument();
  });

  it('shows how many of the fifty are used', () => {
    list();
    expect(screen.getByText('1 of 50')).toBeInTheDocument();
  });

  it('counts characters as the owner types', async () => {
    list();
    await userEvent.type(screen.getByLabelText('Never mention'), 'pork');
    expect(screen.getByText(/4 of 120/)).toBeInTheDocument();
  });

  it('counts an emoji as one character, like the API does', async () => {
    list();
    await userEvent.type(screen.getByLabelText('Never mention'), '🎂');
    expect(screen.getByText(/1 of 120/)).toBeInTheDocument();
  });

  it('adds an entry and clears the box', async () => {
    const { onAdd, onChanged } = list();
    await userEvent.type(screen.getByLabelText('Never mention'), 'pork');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith('pork');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByLabelText('Never mention')).toHaveValue('');
  });

  it('keeps the text and says why when adding fails', async () => {
    const { onChanged } = list({ onAdd: vi.fn().mockRejectedValue(new Error("That's already on the list.")) });
    await userEvent.type(screen.getByLabelText('Never mention'), 'halal certified');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText("That's already on the list.")).toBeInTheDocument();
    expect(screen.getByLabelText('Never mention')).toHaveValue('halal certified');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('puts focus back on the box when adding fails', async () => {
    list({ onAdd: vi.fn().mockRejectedValue(new Error('You have reached 50. Remove one first.')) });
    await userEvent.type(screen.getByLabelText('Never mention'), 'pork');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByLabelText('Never mention')).toHaveFocus();
  });

  it('removes an entry', async () => {
    const { onRemove, onChanged } = list();
    await userEvent.click(screen.getByRole('button', { name: 'Remove halal certified' }));
    expect(onRemove).toHaveBeenCalledWith('n1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('says why when removing fails, beside that entry', async () => {
    const { onChanged } = list({ onRemove: vi.fn().mockRejectedValue(new Error('Could not remove it.')) });
    await userEvent.click(screen.getByRole('button', { name: 'Remove halal certified' }));
    expect(screen.getByText('Could not remove it.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
