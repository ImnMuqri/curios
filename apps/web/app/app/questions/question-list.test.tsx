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
    faqSlug: null,
    faqSuppressed: false,
  },
  {
    id: 'q2',
    text: 'ada delivery',
    askCount: 4,
    answered: true,
    lastAskedAt: new Date('2026-09-08T10:00:00Z'),
    faqSlug: 'ada-delivery',
    faqSuppressed: false,
  },
];

describe('QuestionList', () => {
  it('shows how often each was asked, because that is the ranking', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/asked 9/i)).toBeInTheDocument();
  });

  it('offers the primary action only where it would do something', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={vi.fn()} />);

    // One unanswered question, one Answer button. FRONTEND.md allows one
    // primary action per screen, and an already-answered question is not
    // where an owner should spend it.
    expect(screen.getAllByRole('button', { name: /answer this/i })).toHaveLength(1);
    expect(screen.getByText(/answered/i)).toBeInTheDocument();
  });

  it('sends what the owner wrote', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<QuestionList questions={questions} onAnswer={onAnswer} onSuppress={vi.fn()} onDelete={vi.fn()} />);

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
    render(<QuestionList questions={questions} onAnswer={onAnswer} onSuppress={vi.fn()} onDelete={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95 sekilo.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i);
    expect(screen.getByLabelText(/answer/i)).toHaveValue('RM95 sekilo.');
  });

  it('does not submit twice on a double tap', async () => {
    const onAnswer = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<QuestionList questions={questions} onAnswer={onAnswer} onSuppress={vi.fn()} onDelete={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('lets an owner back out without losing the list', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByRole('button', { name: /answer this/i })).toBeInTheDocument();
  });

  it('says what to do when there is nothing yet', async () => {
    // Empty states are instructions, not moods.
    render(<QuestionList questions={[]} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/share your link/i)).toBeInTheDocument();
  });
});

const suppressed: OwnerQuestion[] = [
  { ...questions[1]!, id: 'q3', text: 'ada parking', faqSuppressed: true },
];

describe('taking a published question down', () => {
  it('offers to hide a question that is live on the public FAQ', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={vi.fn()} />);

    // Only the published one. An answered question with no slug has no public
    // page to hide, and offering the control would imply otherwise.
    expect(screen.getAllByRole('button', { name: /hide from/i })).toHaveLength(1);
  });

  it('asks the API to suppress, not to delete', async () => {
    // The distinction the whole fix rests on: hiding must be reversible and
    // must not remove the answer chat still uses.
    const onSuppress = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn();
    render(<QuestionList questions={questions} onAnswer={vi.fn()} onSuppress={onSuppress} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: /hide from/i }));

    expect(onSuppress).toHaveBeenCalledWith('q2', true);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('offers to put a hidden question back', async () => {
    const onSuppress = vi.fn().mockResolvedValue(undefined);
    render(<QuestionList questions={suppressed} onAnswer={vi.fn()} onSuppress={onSuppress} onDelete={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /show on/i }));

    expect(onSuppress).toHaveBeenCalledWith('q3', false);
  });
});

describe('erasing a question', () => {
  it('asks before erasing, because a customer wrote those words', async () => {
    const onDelete = vi.fn();
    render(<QuestionList questions={questions} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('erases once confirmed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<QuestionList questions={questions} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete it/i }));

    expect(onDelete).toHaveBeenCalledWith('q2');
  });

  it('shuts the other controls while a delete is in flight', async () => {
    // Slice 5 shipped this bug on the leads screen: `busy` and the open prompt
    // are shared across rows, so a second control tapped mid-request answers
    // into the first one's prompt. The guard is that everything is disabled
    // while busy, and it is asserted here rather than assumed.
    let release: (() => void) | undefined;
    const onDelete = vi.fn().mockReturnValue(new Promise<void>((r) => { release = () => r(); }));
    // Two published rows, so "other controls" means another row's -- with one
    // row the hide button is inside the confirm branch and the test would be
    // asserting against itself.
    const two = [questions[1]!, { ...questions[1]!, id: 'q4', text: 'ada parking' }];
    render(<QuestionList questions={two} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={onDelete} />);

    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!);
    await userEvent.click(screen.getByRole('button', { name: /delete it/i }));

    expect(screen.getByRole('button', { name: /keep it/i })).toBeDisabled();
    // The other row's controls, which is where slice 5's bug actually bit.
    expect(screen.getByRole('button', { name: /hide from/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled();

    release?.();
  });
});
