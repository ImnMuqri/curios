import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { OwnerTopic } from '@curios/db-read';
import { QuestionsScreen } from './questions-screen.js';
import type { TopicActions } from './topic-detail.js';

const now = new Date('2026-10-17T06:00:00Z');
const base = { conflictAnswer: null, faqSlug: null, faqSuppressed: false, lastAskedAt: new Date('2026-10-17T03:00:00Z'), week: [0, 0, 0, 0, 0, 0, 1], chat: null };
const w = (id: string, text: string, askCount: number) => ({ id, text, askCount });
const topics: OwnerTopic[] = [
  { ...base, id: 't1', title: 'Do you deliver to Klang?', askCount: 14, answer: null, wordings: [w('w1', 'Do you deliver to Klang?', 9), w('w2', 'delivery klang ada?', 5)] },
  { ...base, id: 't2', title: 'Is it halal?', askCount: 10, answer: 'Yes.', wordings: [w('w3', 'Is it halal?', 10)] },
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

const actions = (): TopicActions => ({
  answer: vi.fn(), withdraw: vi.fn(), suppress: vi.fn(), rename: vi.fn(), merge: vi.fn(), resolve: vi.fn(), deleteTopic: vi.fn(), split: vi.fn(), deleteWording: vi.fn(),
});

function show(list = topics, publishesFaq = true, answerRate = { answered: 0, recorded: 0 }, paging?: { page: number; pages: number }) {
  render(
    <QuestionsScreen
      topics={list}
      paging={paging}
      askedThisWeek={23}
      answerRate={answerRate}
      publishesFaq={publishesFaq}
      faqMinAsks={3}
      handle="keklina"
      publicUrl="https://curios.my/keklina"
      answerMax={2000}
      titleMax={200}
      pageName="Kek Lina"
      look={{ accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null }}
      now={now}
      actions={actions()}
      onChanged={vi.fn()}
    />,
  );
}

// The header's one sentence, which carries the figures the stat cards used to (Dashboard v2).
const summary = () => screen.getByRole('heading', { name: 'Questions', level: 1 }).closest('header')!.querySelector('p')!;
const list = () => within(screen.getByRole('list', { name: 'Topics' }));
const filter = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Show topics' })).getByRole('tab', { name });

describe('QuestionsScreen, the figures', () => {
  it('counts this week’s questions, the topics waiting, and the share of asks with your own answer', () => {
    show();
    // A topic with two answers is still waiting on you. Nothing recorded yet: 10 of 32 asks have an answer that stands.
    expect(summary()).toHaveTextContent('2 topics need your answer. Your own answers cover 31% of asks, and 23 questions were asked this week.');
    expect(summary().querySelector('b')).toHaveTextContent('2 topics');
    expect(screen.queryByRole('list', { name: 'This week' })).toBeNull();
  });

  it('says what share of asks the chat could answer, once the chat has recorded it', () => {
    show(topics, true, { answered: 18, recorded: 24 });
    // Over the last thirty days' recorded asks, so "lately", not "this week".
    expect(summary()).toHaveTextContent('Your page answered 75% of what it was asked lately, and 23 questions were asked this week.');
  });

  it('links the FAQ on a business page only', () => {
    show();
    expect(screen.getByRole('link', { name: 'See your FAQ' })).toHaveAttribute('href', '/keklina/faq');
  });

  it('has no FAQ link on a personal page', () => {
    show(topics, false);
    expect(screen.queryByRole('link', { name: 'See your FAQ' })).toBeNull();
  });
});

describe('QuestionsScreen, the list', () => {
  it('shows each topic with what it waits on, and opens the first', () => {
    show();
    const klang = list().getByRole('button', { name: /Do you deliver to Klang\?/ });
    expect(klang).toHaveTextContent('Needs answer');
    expect(klang).toHaveTextContent('14 asks · 2 wordings · 3h ago');
    expect(klang).toHaveAttribute('aria-current', 'true');
    expect(list().getByRole('button', { name: /Can you write on the cake\?/ })).toHaveTextContent('Two answers');
    expect(list().getByRole('button', { name: /What time do you open\?/ })).toHaveTextContent('Chat answered');
    expect(screen.getByRole('heading', { name: 'Do you deliver to Klang?', level: 2 })).toBeInTheDocument();
  });

  it('opens the topic chosen', () => {
    show();
    fireEvent.click(list().getByRole('button', { name: /Is it halal\?/ }));
    expect(screen.getByRole('heading', { name: 'Is it halal?', level: 2 })).toBeInTheDocument();
  });

  it('filters to what needs you, counting them, to what the chat answered, and to what you answered', () => {
    show();
    // The topic the chat answered from the facts does not wait on you.
    expect(filter(/Needs you/)).toHaveTextContent('2');
    fireEvent.click(filter(/Needs you/));
    expect(list().getAllByRole('button').map((b) => b.querySelector('span span')?.textContent)).toEqual(['Do you deliver to Klang?', 'Can you write on the cake?']);
    fireEvent.click(filter(/By chat/));
    expect(list().getAllByRole('button').map((b) => b.querySelector('span span')?.textContent)).toEqual(['What time do you open?']);
    fireEvent.click(filter(/^Answered/));
    expect(list().getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Is it halal?', level: 2 })).toBeInTheDocument();
  });

  it('says so when nothing needs you', () => {
    show([topics[1]!]);
    fireEvent.click(filter(/Needs you/));
    expect(screen.getByText('Nothing needs you')).toBeInTheDocument();
  });
});

describe('QuestionsScreen, before anyone asks', () => {
  it('says what will land here, and how to get the first question', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show([]);
    expect(screen.getByRole('heading', { name: 'No questions yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try asking your page' })).toHaveAttribute('href', '/keklina#ask');
    fireEvent.click(screen.getByRole('button', { name: 'Copy your link' }));
    expect(writeText).toHaveBeenCalledWith('https://curios.my/keklina');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('QuestionsScreen, the search', () => {
  const search = () => screen.getByRole('searchbox', { name: 'Search questions' });
  const titles = () => list().getAllByRole('button').map((b) => b.querySelector('span span')?.textContent);

  it('narrows the topics by title or by any way people asked, inside the filter chosen', () => {
    show();
    fireEvent.change(search(), { target: { value: 'klang ada' } });
    expect(titles()).toEqual(['Do you deliver to Klang?']);
    fireEvent.change(search(), { target: { value: 'you' } });
    fireEvent.click(filter(/Needs you/));
    expect(titles()).toEqual(['Do you deliver to Klang?', 'Can you write on the cake?']);
  });

  it('says so when nothing on the page matches', () => {
    show();
    fireEvent.change(search(), { target: { value: 'parking' } });
    expect(screen.getByText('No topic on this page matches “parking”.')).toBeInTheDocument();
  });
});

describe('QuestionsScreen, without the template look', () => {
  it('says its numbers in words: no icon tiles, no ring in the header', () => {
    show();
    const header = screen.getByRole('heading', { name: 'Questions', level: 1 }).closest('header')!;
    expect(header.querySelector('svg')).toBeNull();
    expect(header.querySelector('[data-tone]')).toBeNull();
  });

  it('offers no paging when every topic fits on one screen', () => {
    show();
    expect(screen.queryByRole('navigation', { name: 'More topics' })).toBeNull();
  });

  it('links to the next and previous pages, the first page without ?page', () => {
    show(topics, true, { answered: 0, recorded: 0 }, { page: 2, pages: 3 });
    const nav = screen.getByRole('navigation', { name: 'More topics' });
    expect(within(nav).getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/app/questions');
    expect(within(nav).getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/app/questions?page=3');
  });

  it('numbers every page, marking the one shown', () => {
    show(topics, true, { answered: 0, recorded: 0 }, { page: 2, pages: 3 });
    const nav = within(screen.getByRole('navigation', { name: 'More topics' }));
    expect(nav.getByRole('link', { name: 'Page 1' })).toHaveAttribute('href', '/app/questions');
    expect(nav.getByText('2')).toHaveAttribute('aria-current', 'page');
    expect(nav.getByText('2')).toHaveAccessibleName('Page 2 of 3');
    expect(nav.getByRole('link', { name: 'Page 3' })).toHaveAttribute('href', '/app/questions?page=3');
  });

  it('has no Next link on the last page', () => {
    show(topics, true, { answered: 0, recorded: 0 }, { page: 3, pages: 3 });
    const nav = within(screen.getByRole('navigation', { name: 'More topics' }));
    expect(nav.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/app/questions?page=2');
    expect(nav.queryByRole('link', { name: 'Next' })).toBeNull();
  });
});

describe('QuestionsScreen, a list longer than a page', () => {
  const across = (extra: Partial<Parameters<typeof QuestionsScreen>[0]> = {}) =>
    render(
      <QuestionsScreen
        topics={[topics[0]!]}
        paging={{ page: 2, pages: 3 }}
        show="needs"
        totals={{ topics: { all: 30, needs: 11, chat: 4, answered: 15 }, asks: 400, answeredAsks: 100 }}
        choices={[
          { id: topics[0]!.id, title: topics[0]!.title, answer: null },
          { id: 'elsewhere', title: 'On another page', answer: 'Ya' },
        ]}
        askedThisWeek={23}
        answerRate={{ answered: 0, recorded: 0 }}
        publishesFaq
        faqMinAsks={3}
        handle="keklina"
        publicUrl="https://curios.my/keklina"
        answerMax={2000}
        titleMax={200}
        pageName="Kek Lina"
        look={{ accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null }}
        now={now}
        actions={actions()}
        onChanged={vi.fn()}
        {...extra}
      />,
    );

  it('counts what waits and the answered share over every topic, not the page in hand', () => {
    across();
    expect(summary()).toHaveTextContent('11 topics need your answer. Your own answers cover 25% of asks');
    expect(filter(/Needs you/)).toHaveTextContent('11');
  });

  it('asks the server for another filter, and pages within the one in force', () => {
    const onShow = vi.fn();
    across({ onShow });
    fireEvent.click(filter(/^Answered/));
    expect(onShow).toHaveBeenCalledWith('answered');
    const nav = screen.getByRole('navigation', { name: 'More topics' });
    expect(within(nav).getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/app/questions?show=needs');
    expect(within(nav).getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/app/questions?show=needs&page=3');
  });

  it('offers a topic on another page to merge into', () => {
    across();
    fireEvent.click(screen.getByRole('button', { name: 'Same question as…' }));
    expect(screen.getByRole('button', { name: 'On another page' })).toBeInTheDocument();
  });
});
