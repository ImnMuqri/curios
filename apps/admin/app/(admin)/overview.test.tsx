import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Overview as OverviewData } from '@curios/db-read/admin';
import { Overview } from './overview.js';
import { parsePeriod } from './period.js';

function fixture(over: Partial<OverviewData> = {}): OverviewData {
  return {
    livePages: { count: 1284, newInPeriod: 38 },
    paying: { count: 212, newInPeriod: 9 },
    revenueCents: 270_100,
    conversations: { count: 25_780, previous: 23_226 },
    answered: { answered: 91, recorded: 100 },
    aiCost: { milliCents: 57_100_000, perConversationMilliCents: 2_215 },
    perDay: [1, 2, 3, 4, 5, 6, 10].map((count, i) => ({ day: `2026-10-${17 + i}`, count })),
    needsYou: { failedReads: 3, atCap: { count: 14, names: ['Studio Hana', 'Kak Mah'] }, plansEnding: 6 },
    newPages: [
      {
        name: 'Coach Farah',
        handle: 'coachfarah',
        mode: 'BUSINESS',
        createdAt: new Date('2026-10-23T03:00:00Z'),
        factCount: 7,
        hasConversation: true,
      },
      {
        name: 'Dan',
        handle: 'danieltan',
        mode: 'PERSONAL',
        createdAt: new Date('2026-10-22T03:00:00Z'),
        factCount: 2,
        hasConversation: false,
      },
    ],
    byKind: { personal: 1072, business: 212 },
    ...over,
  };
}

const figure = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

describe('Overview', () => {
  it('shows the six figures with their sublines', () => {
    render(<Overview overview={fixture()} period="7d" cap={200} />);

    expect(within(figure('Live pages')).getByText('1,284')).toBeInTheDocument();
    expect(within(figure('Live pages')).getByText('+38 this period')).toBeInTheDocument();
    expect(within(figure('Paying for Business')).getByText('212')).toBeInTheDocument();
    expect(within(figure('Paying for Business')).getByText('+9 new')).toBeInTheDocument();
    expect(within(figure('Business revenue, the last 7 days')).getByText('RM2,701')).toBeInTheDocument();
    expect(within(figure('Conversations, the last 7 days')).getByText('25,780')).toBeInTheDocument();
    expect(within(figure('Conversations, the last 7 days')).getByText('+11% on the period before')).toBeInTheDocument();
    expect(within(figure('Answered from facts')).getByText('91%')).toBeInTheDocument();
    expect(within(figure('Answered from facts')).getByText('9% got “I’m not sure”')).toBeInTheDocument();
    expect(within(figure('AI cost, the last 7 days')).getByText('US$571.00')).toBeInTheDocument();
    expect(within(figure('AI cost, the last 7 days')).getByText('US$0.022 a conversation')).toBeInTheDocument();
  });

  it('shows a dash where nothing was recorded', () => {
    render(<Overview overview={fixture({ answered: { answered: 0, recorded: 0 } })} period="7d" cap={200} />);

    expect(within(figure('Answered from facts')).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/got “I’m not sure”/)).not.toBeInTheDocument();
  });

  it('keeps a small per-conversation cost above zero', () => {
    const overview = fixture({ aiCost: { milliCents: 300, perConversationMilliCents: 300 } });
    render(<Overview overview={overview} period="today" cap={200} />);

    expect(within(figure('AI cost, today')).getByText('US$0.00')).toBeInTheDocument();
    expect(within(figure('AI cost, today')).getByText('US$0.003 a conversation')).toBeInTheDocument();
  });

  it('lists the open items, each with its button except failed reads', () => {
    render(<Overview overview={fixture()} period="7d" cap={200} />);

    expect(screen.getByText('23 open')).toBeInTheDocument();
    expect(screen.getByText('3 sources couldn’t be read')).toBeInTheDocument();
    expect(screen.getByText('14 pages hit the 200 limit')).toBeInTheDocument();
    expect(screen.getByText('Studio Hana and Kak Mah among them')).toBeInTheDocument();
    expect(screen.getByText('6 Business plans end this week')).toBeInTheDocument();
    const buttons = screen.getAllByRole('link', { name: 'See pages' });
    expect(buttons.map((b) => b.getAttribute('href'))).toEqual(['/pages', '/pages?filter=business']);
  });

  it('hides an item at zero, and says so when none is left', () => {
    const none = { failedReads: 0, atCap: { count: 0, names: [] }, plansEnding: 0 };
    const { rerender } = render(
      <Overview overview={fixture({ needsYou: { ...none, plansEnding: 2 } })} period="7d" cap={200} />,
    );
    expect(screen.getByText('2 Business plans end this week')).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be read/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hit the/)).not.toBeInTheDocument();

    rerender(<Overview overview={fixture({ needsYou: none })} period="7d" cap={200} />);
    expect(screen.getByText('Nothing needs you.')).toBeInTheDocument();
    expect(screen.getByText('0 open')).toBeInTheDocument();
  });

  it('marks the current period and links the others', () => {
    render(<Overview overview={fixture()} period="30d" cap={200} />);

    const nav = screen.getByRole('navigation', { name: 'Period' });
    expect(within(nav).getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'true');
    expect(within(nav).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/?period=today');
    expect(within(nav).getByRole('link', { name: '7 days' })).toHaveAttribute('href', '/');
  });

  it('lists the new pages and the mix', () => {
    render(<Overview overview={fixture()} period="7d" cap={200} />);

    const table = screen.getByRole('table', { name: 'New pages' });
    expect(within(table).getByText('Coach Farah')).toBeInTheDocument();
    expect(within(table).getByText('23 Oct 2026')).toBeInTheDocument();
    expect(within(table).getByText('Yes')).toBeInTheDocument();
    expect(within(table).getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByText('1,284 live')).toBeInTheDocument();
    expect(screen.getByText('1,072')).toBeInTheDocument();
  });
});

describe('parsePeriod', () => {
  it('defaults to 7 days', () => {
    expect(parsePeriod(undefined)).toBe('7d');
    expect(parsePeriod('nonsense')).toBe('7d');
    expect(parsePeriod('today')).toBe('today');
    expect(parsePeriod(['30d', 'today'])).toBe('30d');
  });
});
