import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AiUsage } from '@curios/db-read/admin';
import { AiScreen } from './ai-screen.js';

const NOW = new Date('2026-10-27T04:00:00Z');

function fixture(over: Partial<AiUsage> = {}): AiUsage {
  return {
    calls: 64_120,
    answerMs: { median: 1400, p95: 3900 },
    perConversation: { milliCents: 2_100, previousMilliCents: 2_600 },
    unsure: { notSure: 9, recorded: 100 },
    failed: { count: 192, share: 0.003 },
    jobs: [
      { job: 'chat', model: 'chat-model', calls: 8420, avgMs: 1400, failed: 22, milliCents: 6_100_000 },
      { job: 'reading', model: 'read-model', calls: 312, avgMs: 9800, failed: 0, milliCents: 1_400_000 },
      { job: 'grouping', model: '—', calls: 0, avgMs: 0, failed: 0, milliCents: 0 },
    ],
    unsureLatest: [
      { question: 'Boleh hantar ke Klang?', handle: 'keklina', askedAt: new Date('2026-10-27T03:48:00Z') },
      { question: 'Ada sambal sotong hari ni?', handle: 'nasilemakkakmah', askedAt: new Date('2026-10-27T02:50:00Z') },
    ],
    nearCap: [
      { pageId: 'p1', displayName: 'Studio Hana', handle: 'studiohana', used: 187, cap: 200 },
      { pageId: 'p2', displayName: 'Kak Mah', handle: 'nasilemakkakmah', used: 152, cap: 200 },
    ],
    ...over,
  };
}

const figure = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

const empty = fixture({
  calls: 0,
  answerMs: null,
  perConversation: { milliCents: 0, previousMilliCents: 0 },
  unsure: { notSure: 0, recorded: 0 },
  failed: { count: 0, share: 0 },
  unsureLatest: [],
  nearCap: [],
});

describe('AiScreen', () => {
  it('shows the five figures with their sublines', () => {
    render(<AiScreen usage={fixture()} period="7d" cap={200} now={NOW} />);

    expect(within(figure('Model calls')).getByText('64,120')).toBeInTheDocument();
    expect(within(figure('Typical answer time')).getByText('1.4s')).toBeInTheDocument();
    expect(within(figure('Typical answer time')).getByText('Slowest 5%: 3.9s')).toBeInTheDocument();
    expect(within(figure('Cost a conversation')).getByText('US$0.021')).toBeInTheDocument();
    expect(within(figure('Cost a conversation')).getByText('Down from US$0.026')).toBeInTheDocument();
    expect(within(figure('“I’m not sure” replies')).getByText('9%')).toBeInTheDocument();
    expect(within(figure('“I’m not sure” replies')).getByText('Questions with no fact to answer')).toBeInTheDocument();
    expect(within(figure('Calls that failed')).getByText('0.3%')).toBeInTheDocument();
    expect(within(figure('Calls that failed')).getByText('Retried once, then the fixed reply')).toBeInTheDocument();
  });

  it('says Up from when the cost rose, and nothing when there is nothing to compare', () => {
    const { rerender } = render(
      <AiScreen usage={fixture({ perConversation: { milliCents: 3_000, previousMilliCents: 2_100 } })} period="7d" cap={200} now={NOW} />,
    );
    expect(screen.getByText('Up from US$0.021')).toBeInTheDocument();

    rerender(<AiScreen usage={fixture({ perConversation: { milliCents: 2_100, previousMilliCents: 0 } })} period="7d" cap={200} now={NOW} />);
    expect(screen.queryByText(/Down from|Up from/)).not.toBeInTheDocument();
  });

  it('shows a dash for every figure with no data', () => {
    render(<AiScreen usage={empty} period="7d" cap={200} now={NOW} />);

    for (const label of ['Typical answer time', 'Cost a conversation', '“I’m not sure” replies', 'Calls that failed']) {
      expect(within(figure(label)).getByText('—')).toBeInTheDocument();
    }
    expect(within(figure('Model calls')).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/Slowest 5%/)).not.toBeInTheDocument();
  });

  it('lists the three jobs with their labels and models, and a dash for a job with no calls', () => {
    render(<AiScreen usage={fixture()} period="7d" cap={200} now={NOW} />);

    const table = screen.getByRole('table', { name: 'What the AI costs' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('Answering visitors')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('chat-model')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('8,420')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('1.4s')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('22')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('US$61.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Reading sources into facts')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('9.8s')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Grouping questions')).toBeInTheDocument();
    expect(within(rows[3]!).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('lists the unsure questions with the page and when, and never a reply', () => {
    render(<AiScreen usage={fixture()} period="7d" cap={200} now={NOW} />);

    expect(screen.getByText('Boleh hantar ke Klang?')).toBeInTheDocument();
    expect(screen.getByText('curios.my/keklina · 12 min ago')).toBeInTheDocument();
    expect(screen.getByText('curios.my/nasilemakkakmah · 1h ago')).toBeInTheDocument();
    expect(screen.queryByText(/not sure about/)).not.toBeInTheDocument();
  });

  it('lists pages near the limit, each opening its page, with the cap in the subline and the note', () => {
    render(<AiScreen usage={fixture()} period="7d" cap={200} now={NOW} />);

    expect(screen.getByText('200 conversations')).toBeInTheDocument();
    expect(screen.getByText('A page at 200 gets the short fixed reply until the 1st. Nothing is charged.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Studio Hana/ });
    expect(link).toHaveAttribute('href', '/pages?page=p1');
    expect(within(link).getByText('187 of 200')).toBeInTheDocument();
  });

  it('says so when the lists are empty', () => {
    render(<AiScreen usage={empty} period="7d" cap={200} now={NOW} />);

    expect(screen.getByText('Nothing near the limit.')).toBeInTheDocument();
    expect(screen.getByText('No “I’m not sure” answers yet.')).toBeInTheDocument();
  });

  it('marks the period and links the others', () => {
    render(<AiScreen usage={fixture()} period="30d" cap={200} now={NOW} />);

    const nav = screen.getByRole('navigation', { name: 'Period' });
    expect(within(nav).getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'true');
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/ai?period=today');
    expect(within(nav).getByRole('link', { name: '7 days' })).toHaveAttribute('href', '/ai');
    expect(screen.getByText('From model calls, the last 30 days')).toBeInTheDocument();
  });
});
