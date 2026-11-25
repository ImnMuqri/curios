import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { OwnerTopic, QuestionWeek, TopicTotals } from '@curios/db-read';
import { answerShare, listHref, QuestionsScreen, topicHref, weekLine } from './questions-screen.js';
import type { TopicActions } from './topic-detail.js';

const now = new Date('2026-10-17T06:00:00Z');
const base = { conflictAnswer: null, faqSlug: null, faqSuppressed: false, lastAskedAt: new Date('2026-10-17T03:00:00Z'), chat: null };
const w = (id: string, text: string, askCount: number) => ({ id, text, askCount });
const topics: OwnerTopic[] = [
  { ...base, id: 't1', title: 'Do you deliver to Klang?', askCount: 14, answer: null, wordings: [w('w1', 'Do you deliver to Klang?', 9), w('w2', 'delivery klang ada?', 5)] },
  { ...base, id: 't2', title: 'Is it halal?', askCount: 10, answer: 'Yes, all halal.', wordings: [w('w3', 'Is it halal?', 10)] },
  { ...base, id: 't3', title: 'Can you write on the cake?', askCount: 6, answer: 'Yes.', conflictAnswer: 'Up to 20 letters.', wordings: [w('w4', 'Can you write on the cake?', 6)] },
  {
    ...base,
    id: 't4',
    title: 'What time do you open?',
    askCount: 2,
    answer: null,
    wordings: [w('w5', 'What time do you open?', 2)],
    chat: { asked: 'What time do you open?', reply: '9am to 6pm, Monday to Saturday.', answered: true, at: new Date('2026-10-17T02:00:00Z') },
  },
];

const week: QuestionWeek = { thisWeek: 39, lastWeek: 27, days: [3, 5, 4, 8, 6, 7, 6] };
const totals: TopicTotals = { topics: { all: 4, needs: 2, chat: 1, answered: 1 }, asks: 32, answeredAsks: 10 };

const actions = (over: Partial<TopicActions> = {}): TopicActions => ({
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
});

type Props = Parameters<typeof QuestionsScreen>[0];

function show(extra: Partial<Props> = {}) {
  const calls = extra.actions ?? actions();
  const onChanged = vi.fn();
  const props: Props = {
    topics,
    totals,
    week,
    answerRate: { answered: 34, recorded: 39 },
    publishesFaq: true,
    faqMinAsks: 3,
    handle: 'keklina',
    publicUrl: 'https://curios.my/keklina',
    answerMax: 2000,
    titleMax: 200,
    pageName: 'Kek Lina',
    look: { accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null },
    now,
    actions: calls,
    onChanged,
    ...extra,
  };
  const view = render(<QuestionsScreen {...props} />);
  return { calls, onChanged, view, props };
}

const list = () => within(screen.getByRole('list', { name: 'Topics' }));
const card = (title: string) => screen.getByRole('link', { name: title }).closest('li')!;
const chips = () => within(screen.getByRole('group', { name: 'Show topics' }));
const strip = () => within(screen.getByRole('group', { name: 'Questions at a glance' }));

describe('QuestionsScreen, the header and the strip', () => {
  it('has the kicker, the title, the board’s line, and the FAQ link on a business page', () => {
    show();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Questions', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Answer a topic once and your page uses it for every way people ask.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your FAQ' })).toHaveAttribute('href', '/keklina/faq');
  });

  it('has no FAQ link on a personal page', () => {
    show({ publishesFaq: false });
    expect(screen.queryByRole('link', { name: 'See your FAQ' })).toBeNull();
  });

  it('shows the three figures: the topics waiting, the share answered over seven days, the week’s asks', () => {
    show();
    const needs = strip().getByRole('button', { name: /Needs your answer/ });
    expect(needs).toHaveTextContent('2');
    expect(needs).toHaveTextContent('Answer it →');
    const rate = strip().getByText('Answered by your page').closest('div')!;
    expect(rate).toHaveTextContent('87%');
    expect(rate).toHaveTextContent('34 of 39 this week');
    const asked = strip().getByText('Asked this week').closest('div')!;
    expect(asked).toHaveTextContent('39');
    expect(asked).toHaveTextContent('+12 on last week');
    // Exactly seven bars, today last.
    expect(asked.querySelectorAll('svg rect')).toHaveLength(7);
  });

  it('counts the strip’s waiting card and the chip from the same total, over every topic', () => {
    show({ topics: [topics[0]!], totals: { ...totals, topics: { all: 30, needs: 11, chat: 4, answered: 15 } } });
    expect(strip().getByRole('button', { name: /Needs your answer/ })).toHaveTextContent('11');
    expect(chips().getByRole('button', { name: /Needs you/ })).toHaveTextContent('11');
    expect(chips().getByRole('button', { name: /^Answered/ })).toHaveTextContent('15');
  });

  it('hides a chip count of zero', () => {
    show({ totals: { ...totals, topics: { all: 4, needs: 0, chat: 1, answered: 0 } } });
    expect(chips().getByRole('button', { name: 'Needs you' })).not.toHaveTextContent('0');
    expect(chips().getByRole('button', { name: 'Answered' })).not.toHaveTextContent('0');
  });

  it('has the three chips, and no Chat answers one', () => {
    show();
    expect(chips().getAllByRole('button').map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(['All', 'Needs you', 'Answered']);
  });

  it('with nothing recorded this week shows a dash and "Nothing asked this week", no bar, never NaN', () => {
    show({ answerRate: { answered: 0, recorded: 0 }, week: { thisWeek: 0, lastWeek: 0, days: [0, 0, 0, 0, 0, 0, 0] } });
    const rate = strip().getByText('Answered by your page').closest('div')!;
    expect(rate).toHaveTextContent('–');
    expect(rate).toHaveTextContent('Nothing asked this week');
    expect(rate).not.toHaveTextContent('0%');
    expect(rate.querySelector('[aria-hidden="true"] u')).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(strip().getByText('Same as last week')).toBeInTheDocument();
  });

  it('with asks this week but no outcome recorded (a capped chat) says so, not "Nothing asked"', () => {
    show({ answerRate: { answered: 0, recorded: 0 }, week: { thisWeek: 6, lastWeek: 2, days: [0, 0, 1, 1, 1, 1, 2] } });
    const rate = strip().getByText('Answered by your page').closest('div')!;
    expect(rate).toHaveTextContent('–');
    expect(rate).toHaveTextContent('No answers recorded yet');
    expect(rate).not.toHaveTextContent('Nothing asked');
    expect(rate.querySelector('u')).toBeNull();
  });

  it('shows 0% only when asks were recorded and none was answered', () => {
    show({ answerRate: { answered: 0, recorded: 4 } });
    const rate = strip().getByText('Answered by your page').closest('div')!;
    expect(rate).toHaveTextContent('0%');
    expect(rate).toHaveTextContent('0 of 4 this week');
  });

  it('mutes the week line for a fall or no change, and keeps green for a rise', () => {
    show({ week: { thisWeek: 5, lastWeek: 9, days: [1, 1, 1, 1, 1, 0, 0] } });
    expect(strip().getByText('−4 on last week')).toHaveAttribute('data-tone', 'down');
  });

  it('signs the week against the last, and gives a 7-bar spark from a longer array', () => {
    expect(weekLine(39, 27)).toBe('+12 on last week');
    expect(weekLine(5, 9)).toBe('−4 on last week');
    expect(weekLine(3, 3)).toBe('Same as last week');
    expect(answerShare({ answered: 5, recorded: 0 })).toBe(0);
    expect(answerShare({ answered: 18, recorded: 24 })).toBe(0.75);
    show({ week: { thisWeek: 1, lastWeek: 0, days: [9, 9, 0, 0, 0, 0, 0, 0, 1] } });
    expect(strip().getByText('Asked this week').closest('div')!.querySelectorAll('svg rect')).toHaveLength(7);
  });
});

describe('QuestionsScreen, the cards', () => {
  it('shows each topic: its name as a link to its screen, its state, its asks and ways, its ways', () => {
    show();
    const klang = card('Do you deliver to Klang?');
    expect(within(klang).getByRole('link', { name: 'Do you deliver to Klang?' })).toHaveAttribute('href', '/app/questions?topic=t1');
    expect(klang).toHaveTextContent('Needs your answer');
    expect(klang).toHaveTextContent('14 asks · 2 ways');
    expect(within(klang).getByText('delivery klang ada?')).toBeInTheDocument();
    expect(card('Is it halal?')).toHaveTextContent('Answered');
    expect(card('Can you write on the cake?')).toHaveTextContent('Two answers');
    expect(card('What time do you open?')).toHaveTextContent('Chat answered');
  });

  it('keeps the list’s filter and page in the topic link, so back returns to it', () => {
    show({ show: 'needs', paging: { page: 2, pages: 3 } });
    expect(screen.getAllByRole('link', { name: /Do you deliver/ })[0]).toHaveAttribute('href', '/app/questions?topic=t1&show=needs&page=2');
    expect(topicHref('t9')).toBe('/app/questions?topic=t9');
    expect(listHref('answered', 3)).toBe('/app/questions?show=answered&page=3');
  });

  it('puts the answer on a soft block when answered, and a box to write it once when not', () => {
    show();
    expect(within(card('Is it halal?')).getByText('Yes, all halal.')).toBeInTheDocument();
    expect(within(card('Is it halal?')).queryByRole('textbox')).toBeNull();
    const box = within(card('Do you deliver to Klang?')).getByRole('textbox', { name: 'Your answer to Do you deliver to Klang?' });
    expect(box).toHaveAttribute('placeholder', 'Write your answer once. The page uses it every time.');
  });

  it('keeps the box closed on a chat-answered topic until the owner asks to write one, then focuses it', () => {
    show();
    const chat = card('What time do you open?');
    expect(within(chat).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(chat).getByRole('button', { name: 'Write your own answer' }));
    const box = within(chat).getByRole('textbox', { name: 'Your answer to What time do you open?' });
    expect(box).toHaveFocus();
    expect(within(chat).queryByRole('button', { name: 'Write your own answer' })).toBeNull();
    // A topic that needs an answer still has its box open, with no extra button.
    expect(within(card('Do you deliver to Klang?')).queryByRole('button', { name: 'Write your own answer' })).toBeNull();
  });

  it('closes the opened box with Cancel, drops the draft, and does not steal focus when it reopens elsewhere', () => {
    show();
    const chat = card('What time do you open?');
    fireEvent.click(within(chat).getByRole('button', { name: 'Write your own answer' }));
    fireEvent.change(within(chat).getByRole('textbox'), { target: { value: 'Nine' } });
    fireEvent.click(within(chat).getByRole('button', { name: 'Cancel' }));
    expect(within(chat).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(chat).getByRole('button', { name: 'Write your own answer' }));
    expect(within(chat).getByRole('textbox')).toHaveValue('');
    // A topic that needs an answer has no Cancel: its box is always there.
    expect(within(card('Do you deliver to Klang?')).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('puts Save answer and Cancel under the field, not inside it, and full width on phones', () => {
    const css = readFileSync(join(import.meta.dirname, 'questions.module.css'), 'utf8');
    // The field is its own box; the actions sit in a row under it (owner, 26 Nov).
    expect(css).toMatch(/\.in textarea \{[^}]*box-shadow: inset 0 0 0 1px var\(--edge\);/);
    expect(css).toMatch(/\.inActs \{[^}]*justify-content: flex-end;/);
    const phone = css.slice(css.indexOf('@media (max-width: 760px)'));
    expect(phone).toMatch(/\.in textarea \{\s*min-height: 104px;/);
    expect(phone).toMatch(/\.inActs > :is\(\.darkPill, \.litePill\) \{\s*flex: 1 1 100%;/);
  });

  it('saves an answer from the card, says so, refreshes, and shows it answered at once', async () => {
    const { calls, onChanged } = show();
    const klang = card('Do you deliver to Klang?');
    const save = within(klang).getByRole('button', { name: 'Save answer' });
    expect(save).toBeDisabled();
    fireEvent.change(within(klang).getByRole('textbox'), { target: { value: '  Yes, RM15.  ' } });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(calls.answer).toHaveBeenCalledWith('t1', 'Yes, RM15.');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText('Saved. The chat now answers all 2 ways with it.')).toBeInTheDocument();
    expect(klang).toHaveTextContent('Answered');
    expect(within(klang).getByText('Yes, RM15.')).toBeInTheDocument();
  });

  it('saves with Enter-free submit only once while a save is in flight', async () => {
    let finish!: () => void;
    const { calls } = show({ actions: actions({ answer: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) }) });
    const klang = card('Do you deliver to Klang?');
    fireEvent.change(within(klang).getByRole('textbox'), { target: { value: 'Yes.' } });
    fireEvent.click(within(klang).getByRole('button', { name: 'Save answer' }));
    fireEvent.click(within(klang).getByRole('button', { name: 'Save answer' }));
    await act(async () => finish());
    expect(calls.answer).toHaveBeenCalledTimes(1);
  });

  it('reports a failed save once, in the toast’s failure tone, and keeps the draft', async () => {
    show({ actions: actions({ answer: vi.fn(async () => { throw new Error('That answer is too long.'); }) }) });
    const klang = card('Do you deliver to Klang?');
    fireEvent.change(within(klang).getByRole('textbox'), { target: { value: 'Yes.' } });
    await act(async () => {
      fireEvent.click(within(klang).getByRole('button', { name: 'Save answer' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('That answer is too long.');
    expect(within(klang).getByRole('textbox')).toHaveValue('Yes.');
    expect(klang).toHaveTextContent('Needs your answer');
  });

  it('will not send an answer over the limit', () => {
    show({ answerMax: 5 });
    const klang = card('Do you deliver to Klang?');
    fireEvent.change(within(klang).getByRole('textbox'), { target: { value: 'Yes, definitely.' } });
    expect(within(klang).getByRole('button', { name: 'Save answer' })).toBeDisabled();
    expect(klang).toHaveTextContent('11 over');
  });

  it('sends a topic with two answers to its own screen to pick, with no box on the card', () => {
    show();
    const cake = card('Can you write on the cake?');
    expect(within(cake).queryByRole('textbox')).toBeNull();
    expect(cake).toHaveTextContent('Open it to pick the answer to keep.');
  });

  it('keeps the toast outside the screen', () => {
    show();
    const screenEl = screen.getByRole('heading', { name: 'Questions', level: 1 }).closest('header')!.parentElement!;
    expect(screenEl.querySelector('[role="status"]')).toBeNull();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});

describe('QuestionsScreen, the chips and the search', () => {
  const titles = () => list().getAllByRole('link').map((a) => a.textContent);

  it('narrows to what needs you (a topic with two answers included), and to what you answered', () => {
    show();
    fireEvent.click(chips().getByRole('button', { name: /Needs you/ }));
    expect(titles()).toEqual(['Do you deliver to Klang?', 'Can you write on the cake?']);
    fireEvent.click(chips().getByRole('button', { name: /^Answered/ }));
    expect(titles()).toEqual(['Is it halal?']);
    fireEvent.click(chips().getByRole('button', { name: 'All' }));
    expect(titles()).toHaveLength(4);
  });

  it('asks the server for the chip, and the strip’s card is the same filter', () => {
    const onShow = vi.fn();
    show({ onShow });
    fireEvent.click(chips().getByRole('button', { name: /^Answered/ }));
    expect(onShow).toHaveBeenLastCalledWith('answered');
    fireEvent.click(strip().getByRole('button', { name: /Needs your answer/ }));
    expect(onShow).toHaveBeenLastCalledWith('needs');
    expect(strip().getByRole('button', { name: /Needs your answer/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(strip().getByRole('button', { name: /Needs your answer/ }));
    expect(onShow).toHaveBeenLastCalledWith('all');
  });

  it('says so when nothing needs you', () => {
    show({ topics: [topics[1]!] });
    fireEvent.click(chips().getByRole('button', { name: /Needs you/ }));
    expect(screen.getByText('Nothing needs you')).toBeInTheDocument();
  });

  it('narrows by title or by any way people asked, inside the chip chosen', () => {
    show();
    const search = screen.getByRole('searchbox', { name: 'Search questions' });
    fireEvent.change(search, { target: { value: 'klang ada' } });
    expect(titles()).toEqual(['Do you deliver to Klang?']);
    fireEvent.change(search, { target: { value: 'parking' } });
    expect(screen.getByText('No topic on this page matches “parking”.')).toBeInTheDocument();
  });
});

describe('QuestionsScreen, the pager', () => {
  it('offers no paging when every topic fits on one screen', () => {
    show();
    expect(screen.queryByRole('navigation', { name: 'More topics' })).toBeNull();
  });

  it('numbers the pages and links Previous and Next within the filter in force', () => {
    show({ topics: [topics[0]!], show: 'needs', paging: { page: 2, pages: 3 } });
    const nav = within(screen.getByRole('navigation', { name: 'More topics' }));
    expect(nav.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/app/questions?show=needs');
    expect(nav.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/app/questions?show=needs&page=3');
    expect(nav.getByText('2')).toHaveAttribute('aria-current', 'page');
  });
});

describe('QuestionsScreen, before anyone asks', () => {
  it('says what will land here, and how to get the first question', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show({ topics: [], totals: { topics: { all: 0, needs: 0, chat: 0, answered: 0 }, asks: 0, answeredAsks: 0 } });
    expect(screen.getByRole('heading', { name: 'No questions yet', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try asking your page' })).toHaveAttribute('href', '/keklina#ask');
    expect(screen.queryByRole('group', { name: 'Questions at a glance' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy your link' }));
    expect(writeText).toHaveBeenCalledWith('https://curios.my/keklina');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('QuestionsScreen, a topic’s own screen', () => {
  it('opens it with "‹ Questions" back to the list the owner came from, and no list under it', () => {
    show({ topics: [], topic: topics[0]!, show: 'needs', paging: { page: 2, pages: 3 } });
    expect(screen.getByRole('link', { name: 'Questions' })).toHaveAttribute('href', '/app/questions?show=needs&page=2');
    expect(screen.getByRole('heading', { name: 'Do you deliver to Klang?', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Questions · Topic')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Topics' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Questions at a glance' })).toBeNull();
  });

  it('offers a topic on another page to merge into', () => {
    show({ topics: [], topic: topics[0]!, choices: [{ id: 't1', title: 'Do you deliver to Klang?', answer: null }, { id: 'elsewhere', title: 'On another page', answer: 'Ya' }] });
    expect(within(screen.getByRole('combobox', { name: 'Merge into' })).getByRole('option', { name: 'On another page' })).toBeInTheDocument();
  });

  it('goes to the list after a delete, and to the other topic after a merge', async () => {
    const onGo = vi.fn();
    const { view, props } = show({ topics: [], topic: topics[1]!, show: 'answered', onGo, choices: [{ id: 't2', title: 'Is it halal?', answer: 'Yes' }, { id: 't1', title: 'Do you deliver to Klang?', answer: null }] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete topic' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, delete topic' }));
    });
    expect(onGo).toHaveBeenCalledWith('/app/questions?show=answered');
    view.unmount();
    render(<QuestionsScreen {...props} topics={[]} topic={topics[1]} onGo={onGo} show="answered" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Merge into' }), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, merge' }));
    });
    expect(onGo).toHaveBeenLastCalledWith('/app/questions?topic=t1&show=answered');
  });

  it('moves focus to the heading on the way in, and back to the topic’s title link on the way out', () => {
    const scrolled = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const { view, props } = show();
    view.rerender(<QuestionsScreen {...props} topics={[]} topic={topics[1]} />);
    expect(screen.getByRole('heading', { name: 'Is it halal?', level: 1 })).toHaveFocus();
    view.rerender(<QuestionsScreen {...props} />);
    expect(screen.getByRole('link', { name: 'Is it halal?' })).toHaveFocus();
    scrolled.mockRestore();
  });

  it('falls back to the first card when the topic is no longer in the list', () => {
    const { view, props } = show();
    view.rerender(<QuestionsScreen {...props} topics={[]} topic={topics[1]} />);
    view.rerender(<QuestionsScreen {...props} topics={[topics[0]!]} />);
    expect(screen.getByRole('link', { name: 'Do you deliver to Klang?' })).toHaveFocus();
  });
});
