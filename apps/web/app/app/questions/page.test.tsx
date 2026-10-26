import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getTopics = vi.fn();
const getOwnerPage = vi.fn();
const getMyCurios = vi.fn();
const countQuestionsThisWeek = vi.fn();
const getAnswerRate = vi.fn(async () => ({ answered: 0, recorded: 0 }));
const totals = { needs: 4, asks: 60, answeredAsks: 20 };
const getTopicTotals = vi.fn(async () => totals);
const getTopicChoices = vi.fn(async () => [{ id: 't1', title: 'Harga', answer: null }]);
vi.mock('@curios/db-read', () => ({ getTopics, getOwnerPage, getMyCurios, countQuestionsThisWeek, getAnswerRate, getTopicTotals, getTopicChoices }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// The screen closes over apiFetch and the router. These tests are about what
// the page tells it, so the screen records its props instead.
const Topics = vi.fn((_props: Record<string, unknown>) => null);
vi.mock('./questions-screen.js', () => ({ Questions: Topics }));

const QuestionsPage = (await import('./page.js')).default;

const business: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  published: true,
  suspendedAt: null,
  suspendReason: null,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  ordersPlaced: 0,
  ordersAtTrialReset: 0,
  trialResetAt: null,
  storeEnabled: false,
  allowSearchIndexing: false,
  avatarKey: null,
  chipRefused: false,
  payByQr: true,
};

describe('QuestionsPage', () => {
  beforeEach(() => {
    getTopics.mockReset();
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    Topics.mockClear();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getTopics.mockResolvedValue([]);
    countQuestionsThisWeek.mockResolvedValue(23);
    getMyCurios.mockResolvedValue({ handle: 'nadia', accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null });
  });

  it('tells the list a personal page publishes no FAQ pages', async () => {
    getOwnerPage.mockResolvedValue({ ...business, mode: 'PERSONAL' });

    render(await QuestionsPage({ searchParams: Promise.resolve({}) }));

    expect(Topics.mock.calls[0]?.[0]).toMatchObject({ publishesFaq: false });
  });

  it('tells the list a business page publishes them', async () => {
    getOwnerPage.mockResolvedValue(business);

    render(await QuestionsPage({ searchParams: Promise.resolve({}) }));

    expect(Topics.mock.calls[0]?.[0]).toMatchObject({ publishesFaq: true });
  });

  it('hands the list the topics and the length limits from core', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([{ id: 't1' }]);

    render(await QuestionsPage({ searchParams: Promise.resolve({}) }));

    expect(getTopics).toHaveBeenCalledWith('acc1', { now: expect.any(Date), show: 'all', limit: 8, offset: 0 });
    expect(Topics.mock.calls[0]?.[0]).toMatchObject({ topics: [{ id: 't1' }], answerMax: 2000, titleMax: 200, faqMinAsks: 3, paging: { page: 1, hasNext: false }, show: 'all', totals, choices: [{ id: 't1', title: 'Harga', answer: null }] });
  });

  it('shows seven topics a page, offers the next when an eighth came back, and reads ?page', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` })));

    render(await QuestionsPage({ searchParams: Promise.resolve({ page: '3' }) }));

    expect(getTopics).toHaveBeenCalledWith('acc1', { now: expect.any(Date), show: 'all', limit: 8, offset: 14 });
    const props = Topics.mock.calls[0]![0] as { topics: unknown[]; paging: unknown };
    expect(props.topics).toHaveLength(7);
    expect(props.paging).toEqual({ page: 3, hasNext: true });
  });

  it('filters with ?show before paging, ignoring a filter it does not know', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([{ id: 't1' }]);
    render(await QuestionsPage({ searchParams: Promise.resolve({ show: 'needs', page: '2' }) }));
    expect(getTopics).toHaveBeenLastCalledWith('acc1', { now: expect.any(Date), show: 'needs', limit: 8, offset: 7 });
    expect(Topics.mock.lastCall?.[0]).toMatchObject({ show: 'needs' });

    render(await QuestionsPage({ searchParams: Promise.resolve({ show: 'everything' }) }));
    expect(getTopics).toHaveBeenLastCalledWith('acc1', expect.objectContaining({ show: 'all' }));
  });

  it('sends a page past the last of a filter back to the first page of that filter', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([]);
    await expect(QuestionsPage({ searchParams: Promise.resolve({ show: 'needs', page: '9' }) })).rejects.toThrow('NEXT_REDIRECT:/app/questions?show=needs');
  });

  it('sends a page past the last back to the first', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([]);
    await expect(QuestionsPage({ searchParams: Promise.resolve({ page: '9' }) })).rejects.toThrow('NEXT_REDIRECT:/app/questions');
  });

  it('hands over this week, the page, and one moment for the whole screen', async () => {
    getOwnerPage.mockResolvedValue(business);

    render(await QuestionsPage({ searchParams: Promise.resolve({}) }));

    const props = Topics.mock.calls[0]![0];
    const now = getTopics.mock.calls[0]![1].now as Date;
    expect(countQuestionsThisWeek).toHaveBeenCalledWith('acc1', now);
    expect(props).toMatchObject({
      askedThisWeek: 23,
      handle: 'nadia',
      now: now.toISOString(),
      look: { accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null },
    });
    expect(props.publicUrl).toMatch(/\/nadia$/);
  });

  // Fix round 2, Important #3: AppFrame renders its own main around every
  // screen it wraps, this one included, so a second one here would nest.
  it('renders no main of its own', async () => {
    getOwnerPage.mockResolvedValue(business);

    render(await QuestionsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole('main')).toBeNull();
  });
});
