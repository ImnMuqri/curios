import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { OwnerTopic } from '@curios/db-read';
import { TopicDetail, type TopicActions } from './topic-detail.js';

const now = new Date('2026-10-17T06:00:00Z');

const klang: OwnerTopic = {
  id: 't1',
  title: 'Do you deliver to Klang?',
  askCount: 14,
  answer: null,
  conflictAnswer: null,
  faqSlug: null,
  faqSuppressed: false,
  lastAskedAt: new Date('2026-10-17T05:48:00Z'),
  wordings: [
    { id: 'w1', text: 'Do you deliver to Klang?', askCount: 6 },
    { id: 'w2', text: 'boleh hantar ke klang tak', askCount: 5 },
    { id: 'w3', text: 'delivery klang ada?', askCount: 3 },
  ],
  week: [1, 2, 1, 3, 2, 2, 3],
};

const halal: OwnerTopic = { ...klang, id: 't2', title: 'Is it halal?', askCount: 11, answer: 'Yes, all halal.', faqSlug: 'is-it-halal', wordings: [{ id: 'w4', text: 'Is it halal?', askCount: 11 }] };

function actions(over: Partial<TopicActions> = {}): TopicActions {
  return {
    answer: vi.fn(async () => undefined),
    withdraw: vi.fn(async () => undefined),
    suppress: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    merge: vi.fn(async () => undefined),
    resolve: vi.fn(async () => undefined),
    deleteTopic: vi.fn(async () => undefined),
    split: vi.fn(async () => undefined),
    deleteWording: vi.fn(async () => undefined),
    ...over,
  };
}

function show(topic = klang, opts: { calls?: TopicActions; others?: OwnerTopic[]; publishesFaq?: boolean } = {}) {
  const calls = opts.calls ?? actions();
  const onChanged = vi.fn();
  const onSelect = vi.fn();
  const say = vi.fn();
  render(
    <TopicDetail
      topic={topic}
      others={opts.others ?? [halal]}
      publishesFaq={opts.publishesFaq ?? true}
      faqMinAsks={3}
      handle="keklina"
      pageName="Kek Lina"
      answerMax={2000}
      titleMax={200}
      look={{ accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null }}
      now={now}
      actions={calls}
      onChanged={onChanged}
      onSelect={onSelect}
      say={say}
    />,
  );
  return { calls, onChanged, onSelect, say };
}

const answerBox = () => screen.getByRole('textbox', { name: 'Your answer' });

describe('TopicDetail, the head', () => {
  it('says what the topic waits on, how it was asked, and when', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Do you deliver to Klang?' })).toBeInTheDocument();
    expect(screen.getByText('Needs answer')).toBeInTheDocument();
    expect(screen.getByText(/14 asks in 3 wordings · last asked 12 min ago/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '14 asks in the last 7 days' })).toBeInTheDocument();
  });
});

/** These check what is on screen, not how it moves: motion off, as an owner can ask for. */
const motion = window.matchMedia.bind(window);
const still = (on: boolean) => {
  window.matchMedia = on ? (query: string) => ({ ...motion(query), matches: query.includes('reduce') }) : motion;
};

describe('TopicDetail, the answer', () => {
  beforeEach(() => still(true));
  afterEach(() => still(false));

  it('saves an answer, says so, and refreshes', async () => {
    const { calls, onChanged, say } = show();
    expect(screen.getByRole('button', { name: 'Save answer' })).toBeDisabled();
    fireEvent.change(answerBox(), { target: { value: '  Yes, RM15 to Klang.  ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save answer' })); });
    expect(calls.answer).toHaveBeenCalledWith('t1', 'Yes, RM15 to Klang.');
    expect(onChanged).toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith('Saved. The chat now answers all 3 wordings with it.');
  });

  // The screen refreshes from the server after a save; until it does, what was saved stays on screen.
  it('shows the saved answer at once, before the refresh brings it back', async () => {
    show();
    fireEvent.change(answerBox(), { target: { value: 'Yes, RM15.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save answer' })); });
    expect(answerBox()).toHaveValue('Yes, RM15.');
    expect(screen.getByText('Answered')).toBeInTheDocument();
    expect(within(screen.getByLabelText('How the chat replies')).getByText('Yes, RM15.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update answer' })).toBeDisabled();
  });

  it('clears a withdrawn answer at once', async () => {
    show(halal);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); });
    expect(answerBox()).toHaveValue('');
    expect(screen.getByText('Needs answer')).toBeInTheDocument();
  });

  it('keeps the draft and shows the error when saving fails', async () => {
    show(klang, { calls: actions({ answer: vi.fn(async () => { throw new Error('That answer is too long.'); }) }) });
    fireEvent.change(answerBox(), { target: { value: 'Yes.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save answer' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('That answer is too long.');
    expect(answerBox()).toHaveValue('Yes.');
  });

  it('sends a request once when Save is tapped twice before the screen updates', async () => {
    let finish!: () => void;
    const calls = actions({ answer: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) });
    show(klang, { calls });
    fireEvent.change(answerBox(), { target: { value: 'Yes.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    await act(async () => finish());
    expect(calls.answer).toHaveBeenCalledTimes(1);
  });

  it('shows the chat replying with the answer, and says what happens without one', () => {
    show(halal);
    const chat = screen.getByLabelText('How the chat replies');
    expect(within(chat).getByText('Is it halal?')).toBeInTheDocument();
    expect(within(chat).getByText('Yes, all halal.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update answer' })).toBeDisabled();
  });

  it('shows the reply as plain text under "{Name}’s page"', () => {
    show(halal);
    const chat = within(screen.getByLabelText('How the chat replies'));
    expect(chat.getByText('Kek Lina’s page')).toBeInTheDocument();
    expect(chat.getByText('Yes, all halal.').previousElementSibling).toHaveTextContent('Kek Lina’s page');
  });

  it('says what the chat does without an answer, rather than inventing a reply', () => {
    show();
    expect(within(screen.getByLabelText('How the chat replies')).getByText(/replies from your facts, or says it isn.t sure/)).toBeInTheDocument();
  });

  it('without an answer, shows the unsure reply and the lead card, as the page would', () => {
    show();
    const chat = within(screen.getByLabelText('How the chat replies'));
    expect(chat.getByText(/not sure about that one. Leave your number and Kek will get back to you/)).toBeInTheDocument();
    expect(chat.getByText('Kek can answer this one')).toBeInTheDocument();
    expect(chat.getByPlaceholderText('012-345 6789')).toBeInTheDocument();
    expect(chat.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('withdraws an answer', async () => {
    const { calls } = show(halal);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Withdraw' })); });
    expect(calls.withdraw).toHaveBeenCalledWith('t2');
  });
});

describe('TopicDetail, two answers', () => {
  it('shows both and keeps the chosen one', async () => {
    const { calls } = show({ ...halal, conflictAnswer: 'No, not certified yet.' });
    expect(screen.getByText('Two answers')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your answer' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /No, not certified yet/ })); });
    expect(calls.resolve).toHaveBeenCalledWith('t2', 'conflict');
  });
});

describe('TopicDetail, the wordings', () => {
  it('splits a wording out', async () => {
    const { calls } = show();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not the same question: delivery klang ada?' })); });
    expect(calls.split).toHaveBeenCalledWith('w3');
  });

  it('deletes a wording only after confirming', async () => {
    const { calls } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete wording: delivery klang ada?' }));
    expect(calls.deleteWording).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Confirm deleting this wording' });
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Yes' })); });
    expect(calls.deleteWording).toHaveBeenCalledWith('w3');
  });

  it('offers no split for a topic with one wording', () => {
    show(halal);
    expect(screen.queryByRole('button', { name: /Not the same question/ })).toBeNull();
  });
});

describe('TopicDetail, the FAQ page', () => {
  it('links a live FAQ page, and hides it with the switch', async () => {
    const { calls } = show(halal);
    expect(screen.getByText('On your FAQ page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'curios.my/keklina/faq/is-it-halal' })).toHaveAttribute('href', '/keklina/faq/is-it-halal');
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show on your FAQ' })); });
    expect(calls.suppress).toHaveBeenCalledWith('t2', true);
  });

  it('shows a hidden page again', async () => {
    const { calls } = show({ ...halal, faqSuppressed: true });
    expect(screen.getByText('Hidden from your FAQ. The chat still uses the answer.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show on your FAQ' })); });
    expect(calls.suppress).toHaveBeenCalledWith('t2', false);
  });

  it('says what a topic needs before it gets a page', () => {
    show({ ...klang, askCount: 2 });
    expect(screen.getByText('A topic gets an FAQ page once it is asked 3 times and you have answered it.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('is not offered on a personal page', () => {
    show(halal, { publishesFaq: false });
    expect(screen.queryByText(/FAQ page/)).toBeNull();
  });
});

describe('TopicDetail, rename, merge and delete', () => {
  it('renames, with focus on the title', async () => {
    const { calls } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const title = screen.getByRole('textbox', { name: 'Topic title' });
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: 'Delivery to Klang' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(calls.rename).toHaveBeenCalledWith('t1', 'Delivery to Klang');
    expect(screen.queryByRole('textbox', { name: 'Topic title' })).toBeNull();
  });

  it('merges into the topic picked, which keeps its answer, and moves there', async () => {
    const { calls, onSelect } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Same question as…' }));
    const merge = screen.getByRole('group', { name: 'Same question as' });
    expect(within(merge).getByRole('button', { name: 'Merge' })).toBeDisabled();
    fireEvent.click(within(merge).getByRole('button', { name: 'Is it halal?' }));
    await act(async () => { fireEvent.click(within(merge).getByRole('button', { name: 'Merge' })); });
    expect(calls.merge).toHaveBeenCalledWith('t1', 't2', 'into');
    expect(onSelect).toHaveBeenCalledWith('t2');
  });

  it('keeps this topic’s answer when the one picked has none', async () => {
    const { calls } = show(halal, { others: [klang] });
    fireEvent.click(screen.getByRole('button', { name: 'Same question as…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Do you deliver to Klang?' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    expect(calls.merge).toHaveBeenCalledWith('t2', 't1', 'this');
  });

  it('says which answer stays when both have one', () => {
    show(halal, { others: [{ ...klang, answer: 'Yes.' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Same question as…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Do you deliver to Klang?' }));
    expect(screen.getByText('Both have an answer. The one you merge into keeps its answer.')).toBeInTheDocument();
  });

  it('deletes only after confirming, naming what goes', async () => {
    const { calls, onSelect } = show(halal);
    fireEvent.click(screen.getByRole('button', { name: 'Delete topic' }));
    const confirm = screen.getByRole('group', { name: 'Confirm deleting this topic' });
    expect(confirm).toHaveTextContent('Delete this topic and all its wordings? Your answer goes too.');
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Delete topic' })); });
    expect(calls.deleteTopic).toHaveBeenCalledWith('t2');
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the error when an action fails', async () => {
    show(klang, { calls: actions({ split: vi.fn(async () => { throw new Error('That wording moved.'); }) }) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not the same question: delivery klang ada?' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('That wording moved.');
  });
});

describe('TopicDetail, the board’s save', () => {
  afterEach(() => vi.useRealTimers());

  it('throws sparks off the button and types the answer into the chat', async () => {
    vi.useFakeTimers();
    show();
    fireEvent.change(answerBox(), { target: { value: 'Yes, RM15 to Klang.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save answer' })); });

    const chat = screen.getByLabelText('How the chat replies');
    const button = screen.getByRole('button', { name: 'Update answer' });
    expect(button.querySelectorAll('i')).toHaveLength(8);
    expect(within(chat).queryByText('Yes, RM15 to Klang.')).toBeNull();

    // Two characters every 22ms: the 19 characters are in by 220ms.
    // Each step waits for the one before it to render.
    for (let i = 0; i < 12; i += 1) await act(async () => { vi.advanceTimersByTime(22); });
    expect(within(chat).getByText('Yes, RM15 to Klang.')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(button.querySelectorAll('i')).toHaveLength(0);
  });
});

describe('TopicDetail, in the board’s words', () => {
  it('says what each change did', async () => {
    const { say } = show();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not the same question: boleh hantar ke klang tak' })); });
    expect(say).toHaveBeenLastCalledWith('“boleh hantar ke klang tak” is its own topic now. It will not be grouped back.');
  });

  it('says a topic went with its last wording, and lets go of it', async () => {
    const { say, onSelect } = show(halal);
    fireEvent.click(screen.getByRole('button', { name: 'Delete wording: Is it halal?' }));
    const confirm = screen.getByRole('group', { name: 'Confirm deleting this wording' });
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Yes' })); });
    expect(say).toHaveBeenLastCalledWith('Wording deleted, and its topic with it.');
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
