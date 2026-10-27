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
    needsYou: { failedReads: 3, atCap: { count: 14, names: ['Studio Hana', 'Kak Mah'] }, plansEnding: 6, webhooksFailed: { count: 0, latest: null }, reported: { pages: 3, top: { displayName: 'Gadget Murah 88', count: 4, reason: 'SCAM', today: true } } },
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
    byKind: { personal: 1072, business: 212 }, // sums to livePages.count
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

  it('lists the open items, each with its button', () => {
    render(<Overview overview={fixture()} period="7d" cap={200} />);

    expect(screen.getByText('26 open')).toBeInTheDocument();
    expect(screen.getByText('3 sources couldn’t be read')).toBeInTheDocument();
    expect(screen.getByText('14 pages hit the 200 limit')).toBeInTheDocument();
    expect(screen.getByText('Studio Hana and Kak Mah among them')).toBeInTheDocument();
    expect(screen.getByText('6 Business plans end this week')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open queue' })).toHaveAttribute('href', '/sources?filter=failed');
    expect(screen.getByRole('link', { name: 'See pages' })).toHaveAttribute('href', '/ai');
    expect(screen.getByRole('link', { name: 'See payments' })).toHaveAttribute('href', '/payments');
  });

  it('shows a failed payment webhook row, with the attempts and the payer, and a See it button', () => {
    const quiet = { failedReads: 0, atCap: { count: 0, names: [] }, plansEnding: 0, reported: { pages: 0, top: null } };
    const { rerender } = render(
      <Overview
        overview={fixture({ needsYou: { ...quiet, webhooksFailed: { count: 2, latest: { attempts: 3, displayName: 'Studio Hana' } } } })}
        period="7d"
        cap={200}
      />,
    );
    expect(screen.getByText('2 payment webhooks failed')).toBeInTheDocument();
    expect(screen.getByText('CHIP sent it 3 times. Studio Hana’s payment may not show as paid.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See it' })).toHaveAttribute('href', '/payments');
    expect(screen.getByText('2 open')).toBeInTheDocument();

    rerender(
      <Overview
        overview={fixture({ needsYou: { ...quiet, webhooksFailed: { count: 1, latest: { attempts: 1, displayName: null } } } })}
        period="7d"
        cap={200}
      />,
    );
    expect(screen.getByText('1 payment webhook failed')).toBeInTheDocument();
    expect(screen.getByText('CHIP sent it 1 time. A payment may not show as paid.')).toBeInTheDocument();
  });

  it('hides an item at zero, and says so when none is left', () => {
    const none = { failedReads: 0, atCap: { count: 0, names: [] }, plansEnding: 0, webhooksFailed: { count: 0, latest: null }, reported: { pages: 0, top: null } };
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

  it('shows the reported row with a Look button, and the subline for today or not', () => {
    const { rerender } = render(<Overview overview={fixture()} period="7d" cap={200} />);
    expect(screen.getByText('3 pages reported')).toBeInTheDocument();
    expect(screen.getByText('Gadget Murah 88 has 4 scam reports today')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Look' })).toHaveAttribute('href', '/reports');

    const quiet = { failedReads: 0, atCap: { count: 0, names: [] }, plansEnding: 0, webhooksFailed: { count: 0, latest: null } };
    rerender(
      <Overview
        overview={fixture({ needsYou: { ...quiet, reported: { pages: 1, top: { displayName: 'Coach Farah', count: 2, reason: 'IMPERSONATION', today: false } } } })}
        period="7d"
        cap={200}
      />,
    );
    expect(screen.getByText('1 page reported')).toBeInTheDocument();
    expect(screen.getByText('Coach Farah has 2 open impersonation reports')).toBeInTheDocument();

    const other = (today: boolean) =>
      fixture({ needsYou: { ...quiet, reported: { pages: 1, top: { displayName: 'Kedai Sri', count: 4, reason: 'OTHER', today } } } });
    rerender(<Overview overview={other(true)} period="7d" cap={200} />);
    expect(screen.getByText('Kedai Sri has 4 reports today')).toBeInTheDocument();
    rerender(<Overview overview={other(false)} period="7d" cap={200} />);
    expect(screen.getByText('Kedai Sri has 4 open reports')).toBeInTheDocument();
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
