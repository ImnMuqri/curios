import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OwnerQuestion } from '@curios/db-read';
import { QuestionList } from './question-list.js';

const questions: OwnerQuestion[] = [
  {
    id: 'q1',
    text: 'berapa harga kek',
    askCount: 9,
    answered: false,
    lastAskedAt: new Date('2026-09-09T10:00:00Z'),
  },
  {
    id: 'q2',
    text: 'ada delivery',
    askCount: 4,
    answered: true,
    lastAskedAt: new Date('2026-09-08T10:00:00Z'),
  },
];

describe('QuestionList', () => {
  it('shows how often each was asked, because that is the ranking', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} />);
    expect(screen.getByText(/asked 9/i)).toBeInTheDocument();
  });

  it('offers the primary action only where it would do something', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} />);

    // One unanswered question, one Answer button. FRONTEND.md allows one
    // primary action per screen, and an already-answered question is not
    // where an owner should spend it.
    expect(screen.getAllByRole('button', { name: /answer this/i })).toHaveLength(1);
    expect(screen.getByText(/answered/i)).toBeInTheDocument();
  });

  it('sends what the owner wrote', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<QuestionList questions={questions} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95 sekilo.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onAnswer).toHaveBeenCalledWith('q1', 'RM95 sekilo.');
  });

  it('keeps the draft when saving fails', async () => {
    // The same rule the fact editor learned the hard way: this is one of two
    // places a human writes real prose, and throwing it away on a failed save
    // means retyping from memory.
    const onAnswer = vi.fn().mockRejectedValue(new Error('That failed. Try again.'));
    render(<QuestionList questions={questions} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95 sekilo.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i);
    expect(screen.getByLabelText(/answer/i)).toHaveValue('RM95 sekilo.');
  });

  it('does not submit twice on a double tap', async () => {
    const onAnswer = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<QuestionList questions={questions} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('lets an owner back out without losing the list', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByRole('button', { name: /answer this/i })).toBeInTheDocument();
  });

  it('says what to do when there is nothing yet', async () => {
    // Empty states are instructions, not moods.
    render(<QuestionList questions={[]} onAnswer={vi.fn()} />);
    expect(screen.getByText(/share your link/i)).toBeInTheDocument();
  });
});
