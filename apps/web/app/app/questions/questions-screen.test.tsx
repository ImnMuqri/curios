import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { OwnerTopic } from '@curios/db-read';
import { QuestionsScreen } from './questions-screen.js';
import type { TopicActions } from './topic-detail.js';

const now = new Date('2026-10-17T06:00:00Z');
const base = { conflictAnswer: null, faqSlug: null, faqSuppressed: false, lastAskedAt: new Date('2026-10-17T03:00:00Z'), week: [0, 0, 0, 0, 0, 0, 1] };
const w = (id: string, text: string, askCount: number) => ({ id, text, askCount });
const topics: OwnerTopic[] = [
  { ...base, id: 't1', title: 'Do you deliver to Klang?', askCount: 14, answer: null, wordings: [w('w1', 'Do you deliver to Klang?', 9), w('w2', 'delivery klang ada?', 5)] },
  { ...base, id: 't2', title: 'Is it halal?', askCount: 10, answer: 'Yes.', wordings: [w('w3', 'Is it halal?', 10)] },
  { ...base, id: 't3', title: 'Can you write on the cake?', askCount: 6, answer: 'Yes.', conflictAnswer: 'Up to 20 letters.', wordings: [w('w4', 'Can you write on the cake?', 6)] },
];

const actions = (): TopicActions => ({
  answer: vi.fn(), withdraw: vi.fn(), suppress: vi.fn(), rename: vi.fn(), merge: vi.fn(), resolve: vi.fn(), deleteTopic: vi.fn(), split: vi.fn(), deleteWording: vi.fn(),
});

function show(list = topics, publishesFaq = true, answerRate = { answered: 0, recorded: 0 }) {
  render(
    <QuestionsScreen
      topics={list}
      askedThisWeek={23}
      answerRate={answerRate}
      publishesFaq={publishesFaq}
      faqMinAsks={3}
      handle="keklina"
      publicUrl="https://curios.my/keklina"
      answerMax={2000}
      titleMax={200}
      look={{ accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null }}
      now={now}
      actions={actions()}
      onChanged={vi.fn()}
    />,
  );
}

const stats = () => within(screen.getByRole('list', { name: 'This week' }));
const list = () => within(screen.getByRole('list', { name: 'Topics' }));
const filter = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Show topics' })).getByRole('tab', { name });

describe('QuestionsScreen, the figures', () => {
  it('counts this week’s questions, the topics waiting, and the share of asks with your own answer', () => {
    show();
    expect(stats().getByText('23').nextSibling).toHaveTextContent('Questions asked this week');
    // A topic with two answers is still waiting on you.
    expect(stats().getByText('2').nextSibling).toHaveTextContent('Topics waiting for your answer');
    // Nothing recorded yet: 10 of 30 asks have an answer that stands.
    expect(stats().getByText('33%').nextSibling).toHaveTextContent('Of asks with your own answer');
  });

  it('says what share of asks the chat could answer, once the chat has recorded it', () => {
    show(topics, true, { answered: 18, recorded: 24 });
    expect(stats().getByText('75%').nextSibling).toHaveTextContent('Of asks the chat can answer');
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
    expect(screen.getByRole('heading', { name: 'Do you deliver to Klang?', level: 2 })).toBeInTheDocument();
  });

  it('opens the topic chosen', () => {
    show();
    fireEvent.click(list().getByRole('button', { name: /Is it halal\?/ }));
    expect(screen.getByRole('heading', { name: 'Is it halal?', level: 2 })).toBeInTheDocument();
  });

  it('filters to what needs you, counting them, and to what is answered', () => {
    show();
    expect(filter(/Needs you/)).toHaveTextContent('2');
    fireEvent.click(filter(/Needs you/));
    expect(list().getAllByRole('button').map((b) => b.querySelector('span span')?.textContent)).toEqual(['Do you deliver to Klang?', 'Can you write on the cake?']);
    fireEvent.click(filter(/^Answered/));
    expect(list().getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Is it halal?', level: 2 })).toBeInTheDocument();
  });

  it('says so when nothing needs you', () => {
    show([topics[1]!]);
    fireEvent.click(filter(/Needs you/));
    expect(screen.getByText('All answered')).toBeInTheDocument();
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

describe('QuestionsScreen, without the template look', () => {
  it('shows its three numbers as plain figures: no icon tiles, no ring', () => {
    show();
    const figures = screen.getByRole('list', { name: 'This week' });
    expect(within(figures).getAllByRole('listitem')).toHaveLength(3);
    expect(figures.querySelector('svg')).toBeNull();
    expect(figures.querySelector('[data-tone]')).toBeNull();
  });
});
