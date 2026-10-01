import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PinnedList } from './pinned-tab.js';

const pinned = [{ questionId: 'q1', question: 'Berapa harga kek?', answer: 'RM95.' }];

function list(overrides: Partial<Parameters<typeof PinnedList>[0]> = {}) {
  const props = {
    pinned,
    onEdit: vi.fn().mockResolvedValue(undefined),
    onWithdraw: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(),
    ...overrides,
  };
  render(<PinnedList {...props} />);
  return props;
}

describe('PinnedList', () => {
  it('gives every row buttons that name their own question', () => {
    list({
      pinned: [
        { questionId: 'q1', question: 'Berapa harga kek?', answer: 'RM95.' },
        { questionId: 'q2', question: 'Bila buka?', answer: '9 to 5.' },
      ],
    });
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Edit answer to Berapa harga kek?',
      'Remove answer to Berapa harga kek?',
      'Edit answer to Bila buka?',
      'Remove answer to Bila buka?',
    ]);
  });

  it('shows the visitor’s question and the answer', () => {
    list();
    expect(screen.getByText('Berapa harga kek?')).toBeInTheDocument();
    expect(screen.getByText('RM95.')).toBeInTheDocument();
  });

  it('edits the answer', async () => {
    const { onEdit, onChanged } = list();
    await userEvent.click(screen.getByRole('button', { name: 'Edit answer to Berapa harga kek?' }));
    const field = screen.getByDisplayValue('RM95.');
    await userEvent.clear(field);
    await userEvent.type(field, 'RM99.');
    await userEvent.click(screen.getByRole('button', { name: 'Save answer to Berapa harga kek?' }));
    expect(onEdit).toHaveBeenCalledWith('q1', 'RM99.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the editor open and says why when saving fails', async () => {
    const { onChanged } = list({ onEdit: vi.fn().mockRejectedValue(new Error('Write an answer first.')) });
    await userEvent.click(screen.getByRole('button', { name: 'Edit answer to Berapa harga kek?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save answer to Berapa harga kek?' }));
    expect(screen.getByText('Write an answer first.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('RM95.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('puts the old answer back when an edit is cancelled', async () => {
    list();
    await userEvent.click(screen.getByRole('button', { name: 'Edit answer to Berapa harga kek?' }));
    await userEvent.type(screen.getByDisplayValue('RM95.'), 'xyz');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit answer to Berapa harga kek?' }));
    expect(screen.getByDisplayValue('RM95.')).toBeInTheDocument();
  });

  it('drops a failed save’s message when the edit is cancelled', async () => {
    list({ onEdit: vi.fn().mockRejectedValue(new Error('Write an answer first.')) });
    await userEvent.click(screen.getByRole('button', { name: 'Edit answer to Berapa harga kek?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save answer to Berapa harga kek?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Write an answer first.')).not.toBeInTheDocument();
  });

  it('withdraws only after saying where the question goes', async () => {
    const { onWithdraw, onChanged } = list();
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer to Berapa harga kek?' }));
    expect(screen.getByText(/goes back to questions as unanswered/i)).toBeInTheDocument();
    expect(onWithdraw).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer' }));
    expect(onWithdraw).toHaveBeenCalledWith('q1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('cancelling the confirm withdraws nothing', async () => {
    const { onWithdraw } = list();
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer to Berapa harga kek?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onWithdraw).not.toHaveBeenCalled();
    expect(screen.queryByText(/goes back to questions/i)).not.toBeInTheDocument();
  });

  it('says why when withdrawing fails, and drops the message on cancel', async () => {
    const { onChanged } = list({ onWithdraw: vi.fn().mockRejectedValue(new Error('Could not remove it.')) });
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer to Berapa harga kek?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer' }));
    expect(screen.getByText('Could not remove it.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Could not remove it.')).not.toBeInTheDocument();
  });

  it('points to Questions when there are none', () => {
    list({ pinned: [] });
    expect(screen.getByRole('link', { name: /questions/i })).toHaveAttribute('href', '/app/questions');
  });
});
