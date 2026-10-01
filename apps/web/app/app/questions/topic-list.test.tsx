import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OwnerTopic } from '@curios/db-read';
import { TopicList, type TopicActions } from './topic-list.js';

const at = new Date('2026-09-09T10:00:00Z');

const answered: OwnerTopic = {
  id: 't1',
  title: "What is Iman's full name",
  askCount: 4,
  answer: 'Iman Mukri.',
  conflictAnswer: null,
  faqSlug: 'what-is-imans-full-name',
  faqSuppressed: false,
  lastAskedAt: at,
  wordings: [
    { id: 'w1', text: "What is Iman's full name", askCount: 3 },
    { id: 'w2', text: 'What is his full name', askCount: 1 },
  ],
};
const unanswered: OwnerTopic = {
  id: 't2',
  title: 'Does Bsyx Labs support FPX payments?',
  askCount: 2,
  answer: null,
  conflictAnswer: null,
  faqSlug: null,
  faqSuppressed: false,
  lastAskedAt: at,
  wordings: [{ id: 'w3', text: 'Does Bsyx Labs support FPX payments?', askCount: 2 }],
};
const conflicted: OwnerTopic = {
  id: 't3',
  title: 'How much is the cake',
  askCount: 1,
  answer: 'RM95',
  conflictAnswer: 'RM90',
  faqSlug: null,
  faqSuppressed: false,
  lastAskedAt: at,
  wordings: [{ id: 'w4', text: 'How much is the cake', askCount: 1 }],
};

function actionsMock(): { [K in keyof TopicActions]: ReturnType<typeof vi.fn> } {
  return {
    answer: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue(undefined),
    suppress: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    deleteTopic: vi.fn().mockResolvedValue(undefined),
    split: vi.fn().mockResolvedValue(undefined),
    deleteWording: vi.fn().mockResolvedValue(undefined),
  };
}

function list(
  topics: OwnerTopic[] = [answered, unanswered, conflicted],
  overrides: Partial<Parameters<typeof TopicList>[0]> = {},
) {
  const actions = actionsMock();
  const onChanged = vi.fn();
  render(
    <TopicList
      topics={topics}
      publishesFaq={true}
      answerMax={2000}
      titleMax={200}
      actions={actions as unknown as TopicActions}
      onChanged={onChanged}
      {...overrides}
    />,
  );
  return { actions, onChanged };
}

const row = (title: string) => screen.getByText(title, { selector: 'p' }).closest('li') as HTMLElement;
const menuOf = async (title: string) => {
  await userEvent.click(within(row(title)).getByRole('button', { name: /more actions/i }));
  return within(row(title)).getByRole('list', { name: /^Actions for/ });
};

describe('TopicList', () => {
  it('shows one row per topic with its total count, most asked first', () => {
    list([answered, unanswered]);
    const titles = screen.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent);
    expect(titles).toEqual([answered.title, unanswered.title]);
    expect(within(row(answered.title)).getByText('4×')).toBeInTheDocument();
    expect(within(row(unanswered.title)).getByText('2×')).toBeInTheDocument();
  });

  it('offers Answer on an unanswered topic and Edit on an answered one, on the row', () => {
    list([answered, unanswered]);
    expect(within(row(unanswered.title)).getByRole('button', { name: 'Answer' })).toBeInTheDocument();
    expect(within(row(unanswered.title)).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(row(answered.title)).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(row(answered.title)).queryByRole('button', { name: 'Answer' })).toBeNull();
  });

  it('says how many other wordings a topic has, and folds them out', async () => {
    list([answered, unanswered]);
    expect(screen.queryByText('What is his full name')).toBeNull();
    expect(within(row(unanswered.title)).queryByText(/other wording/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '+1 other wording' }));

    const wording = screen.getByText('What is his full name').closest('li') as HTMLElement;
    expect(within(wording).getByText('1×')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+1 other wording' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('answers in place and refreshes', async () => {
    const { actions, onChanged } = list([answered, unanswered]);
    await userEvent.click(within(row(unanswered.title)).getByRole('button', { name: 'Answer' }));
    expect(screen.getByText('Up to 2000 characters.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Answer'), 'Yes, FPX works.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(actions.answer).toHaveBeenCalledWith('t2', 'Yes, FPX works.');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Answer')).toBeNull();
  });

  it('keeps the draft and shows the error when saving fails', async () => {
    const { actions, onChanged } = list([answered, unanswered]);
    actions.answer.mockRejectedValue(new Error('That answer is too long.'));
    await userEvent.click(within(row(unanswered.title)).getByRole('button', { name: 'Answer' }));
    await userEvent.type(screen.getByLabelText('Answer'), 'Yes, FPX works.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That answer is too long.')).toBeInTheDocument();
    expect(screen.getByLabelText('Answer')).toHaveValue('Yes, FPX works.');
    expect(screen.getByLabelText('Answer')).toHaveFocus();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("splits a wording out with 'Not the same question'", async () => {
    const { actions, onChanged } = list([answered, unanswered]);
    await userEvent.click(screen.getByRole('button', { name: '+1 other wording' }));
    const wording = screen.getByText('What is his full name').closest('li') as HTMLElement;
    await userEvent.click(within(wording).getByRole('button', { name: 'Not the same question' }));

    expect(actions.split).toHaveBeenCalledWith('w2');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('deletes a wording only after confirming', async () => {
    const { actions, onChanged } = list([answered, unanswered]);
    await userEvent.click(screen.getByRole('button', { name: '+1 other wording' }));
    const wording = () => screen.getByText('What is his full name').closest('li') as HTMLElement;

    await userEvent.click(within(wording()).getByRole('button', { name: 'Delete' }));
    expect(actions.deleteWording).not.toHaveBeenCalled();
    expect(
      screen.getByText('Delete this wording? A visitor typed these words; this cannot be undone.'),
    ).toBeInTheDocument();

    await userEvent.click(within(wording()).getByRole('button', { name: 'Keep it' }));
    expect(actions.deleteWording).not.toHaveBeenCalled();

    await userEvent.click(within(wording()).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(wording()).getByRole('button', { name: 'Delete wording' }));
    expect(actions.deleteWording).toHaveBeenCalledWith('w2');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("merges with 'Same as…', asking which answer to keep when both are answered", async () => {
    const { actions, onChanged } = list([answered, unanswered, conflicted]);
    const menu = await menuOf(answered.title);
    await userEvent.click(within(menu).getByRole('button', { name: 'Same as…' }));
    await userEvent.selectOptions(screen.getByLabelText('Same question as'), 't3');

    // Both answered: Merge waits for a choice.
    const merge = screen.getByRole('button', { name: 'Merge' });
    expect(merge).toBeDisabled();
    expect(screen.getByLabelText('Keep theirs: “RM95”')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/^Keep theirs/));
    expect(merge).toBeEnabled();
    await userEvent.click(merge);

    expect(actions.merge).toHaveBeenCalledWith('t1', 't3', 'into');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('merges straight away, keeping the only answer, when just one topic has one', async () => {
    const { actions } = list([answered, unanswered]);
    const menu = await menuOf(unanswered.title);
    await userEvent.click(within(menu).getByRole('button', { name: 'Same as…' }));
    await userEvent.selectOptions(screen.getByLabelText('Same question as'), 't1');

    expect(screen.queryByLabelText(/^Keep theirs/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(actions.merge).toHaveBeenCalledWith('t2', 't1', 'into');
  });

  it('renames from the ⋯ menu', async () => {
    const { actions, onChanged } = list([answered, unanswered]);
    const menu = await menuOf(unanswered.title);
    await userEvent.click(within(menu).getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('Title');
    expect(field).toHaveValue(unanswered.title);
    await userEvent.clear(field);
    await userEvent.type(field, 'Do you take FPX?');
    await userEvent.click(screen.getByRole('button', { name: 'Save title' }));

    expect(actions.rename).toHaveBeenCalledWith('t2', 'Do you take FPX?');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('hides from and shows on the FAQ only for business pages with a FAQ page', async () => {
    // Business page, topic with a FAQ page: Hide, then (once hidden) Show.
    const { actions } = list([answered, unanswered]);
    let menu = await menuOf(answered.title);
    await userEvent.click(within(menu).getByRole('button', { name: 'Hide from FAQ' }));
    expect(actions.suppress).toHaveBeenCalledWith('t1', true);
    // A topic with no FAQ page has no FAQ item.
    menu = await menuOf(unanswered.title);
    expect(within(menu).queryByRole('button', { name: /FAQ/ })).toBeNull();
  });

  it('offers Show on FAQ for a hidden topic, and no FAQ items on a personal page', async () => {
    const hidden = { ...answered, faqSuppressed: true };
    const { actions } = list([hidden]);
    const menu = await menuOf(hidden.title);
    await userEvent.click(within(menu).getByRole('button', { name: 'Show on FAQ' }));
    expect(actions.suppress).toHaveBeenCalledWith('t1', false);
  });

  it('shows no FAQ items on a personal page', async () => {
    list([answered, unanswered], { publishesFaq: false });
    const menu = await menuOf(answered.title);
    expect(within(menu).queryByRole('button', { name: /FAQ/ })).toBeNull();
    expect(within(row(answered.title)).queryByText(/\/faq/)).toBeNull();
  });

  it('says whether a topic is live on or hidden from /faq', () => {
    list([answered, { ...conflicted, faqSlug: 'x', faqSuppressed: true }]);
    expect(within(row(answered.title)).getByText(/Live on \/faq/)).toBeInTheDocument();
    expect(within(row(conflicted.title)).getByText(/Hidden from \/faq/)).toBeInTheDocument();
  });

  it('deletes a topic only after confirming, naming how many wordings go', async () => {
    const { actions, onChanged } = list([answered, unanswered]);
    const menu = await menuOf(answered.title);
    await userEvent.click(within(menu).getByRole('button', { name: 'Delete topic' }));

    expect(actions.deleteTopic).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete this topic and its 2 wordings\?/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(actions.deleteTopic).not.toHaveBeenCalled();

    const again = await menuOf(answered.title);
    await userEvent.click(within(again).getByRole('button', { name: 'Delete topic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete it' }));
    expect(actions.deleteTopic).toHaveBeenCalledWith('t1');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows "Two answers — pick one" and keeps the chosen one', async () => {
    const { actions, onChanged } = list([conflicted]);
    expect(screen.getByText('Two answers — pick one')).toBeInTheDocument();
    const other = screen.getByText('RM90').parentElement as HTMLElement;
    expect(screen.getByText('RM95')).toBeInTheDocument();
    await userEvent.click(within(other).getByRole('button', { name: 'Keep this answer: RM90' }));

    expect(actions.resolve).toHaveBeenCalledWith('t3', 'conflict');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps the current answer from the conflict flag', async () => {
    const { actions } = list([conflicted]);
    const current = screen.getByText('RM95').parentElement as HTMLElement;
    await userEvent.click(within(current).getByRole('button', { name: 'Keep this answer: RM95' }));
    expect(actions.resolve).toHaveBeenCalledWith('t3', 'answer');
  });

  it('closes the ⋯ menu with Escape and returns focus to the ⋯ button', async () => {
    list([answered]);
    const button = screen.getByRole('button', { name: /more actions/i });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('list', { name: /^Actions for/ })).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('shows the error under the row when an action fails', async () => {
    const { actions } = list([answered]);
    actions.deleteTopic.mockRejectedValue(new Error('Could not delete that.'));
    const menu = await menuOf(answered.title);
    await userEvent.click(within(menu).getByRole('button', { name: 'Delete topic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete it' }));

    expect(await screen.findByText('Could not delete that.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete it' })).toBeInTheDocument();
  });

  it('names the delete-topic consequence by whether it has an answer', async () => {
    list([answered, unanswered]);
    await userEvent.click(within(await menuOf(answered.title)).getByRole('button', { name: 'Delete topic' }));
    expect(screen.getByText(/Your answer goes too/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await userEvent.click(within(await menuOf(unanswered.title)).getByRole('button', { name: 'Delete topic' }));
    expect(screen.getByText(/Delete this topic and its 1 wording\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Your answer goes too/)).toBeNull();
  });

  it('moves focus to the first field when Rename, Same as… or Answer opens', async () => {
    list([answered, unanswered]);
    await userEvent.click(within(await menuOf(unanswered.title)).getByRole('button', { name: 'Rename' }));
    expect(screen.getByLabelText('Title')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(within(await menuOf(unanswered.title)).getByRole('button', { name: 'Same as…' }));
    expect(screen.getByLabelText('Same question as')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(within(row(unanswered.title)).getByRole('button', { name: 'Answer' }));
    expect(screen.getByLabelText('Answer')).toHaveFocus();
  });

  it('puts focus back on the ⋯ button after hiding from the FAQ', async () => {
    list([answered]);
    await userEvent.click(within(await menuOf(answered.title)).getByRole('button', { name: 'Hide from FAQ' }));
    expect(screen.getByRole('button', { name: /more actions/i })).toHaveFocus();
  });

  it('sends a request once when a button is tapped twice before the screen updates', async () => {
    const { actions } = list([conflicted]);
    let release: () => void = () => undefined;
    actions.resolve.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const keep = screen.getByRole('button', { name: 'Keep this answer: RM90' });
    act(() => { keep.click(); keep.click(); });
    expect(actions.resolve).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it('sends a wording action once on a double tap', async () => {
    const { actions } = list([answered]);
    await userEvent.click(screen.getByRole('button', { name: '+1 other wording' }));
    let release: () => void = () => undefined;
    actions.split.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const split = within(screen.getByText('What is his full name').closest('li') as HTMLElement).getByRole('button', {
      name: 'Not the same question',
    });
    act(() => { split.click(); split.click(); });
    expect(actions.split).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it('has an empty state', () => {
    list([]);
    expect(screen.getByText(/No questions yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
