import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getTopics = vi.fn();
const getOwnerPage = vi.fn();
const getMyCurios = vi.fn();
const getQuestionWeek = vi.fn();
const getAnswerRate = vi.fn(async () => ({ answered: 0, recorded: 0 }));
// 30 topics in all: five pages of seven; nine need the owner: two pages.
const totals = { topics: { all: 30, needs: 9, chat: 5, answered: 16 }, asks: 60, answeredAsks: 20 };
const getTopicTotals = vi.fn(async () => totals);
const getTopicChoices = vi.fn(async () => [{ id: 't1', title: 'Harga', answer: null }]);
const questionWeekStart = vi.fn((now: Date) => new Date(now.getTime() - 6 * 86_400_000));
vi.mock('@curios/db-read', () => ({ questionWeekStart, getTopics, getOwnerPage, getMyCurios, getQuestionWeek, getAnswerRate, getTopicTotals, getTopicChoices }));

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
    getQuestionWeek.mockResolvedValue({ thisWeek: 39, lastWeek: 27, days: [3, 5, 4, 8, 6, 7, 6] });
    getTopicChoices.mockClear();
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

    expect(getTopics).toHaveBeenCalledWith('acc1', { now: expect.any(Date), show: 'all', limit: 7, offset: 0 });
    expect(Topics.mock.calls[0]?.[0]).toMatchObject({ topics: [{ id: 't1' }], answerMax: 2000, titleMax: 200, faqMinAsks: 3, paging: { page: 1, pages: 5 }, show: 'all', totals, choices: [{ id: 't1', title: 'Harga', answer: null }] });
  });

  it('shows seven topics a page, counts the pages from the filter’s total, and reads ?page', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue(Array.from({ length: 7 }, (_, i) => ({ id: `t${i}` })));

    render(await QuestionsPage({ searchParams: Promise.resolve({ page: '3' }) }));

    expect(getTopics).toHaveBeenCalledWith('acc1', { now: expect.any(Date), show: 'all', limit: 7, offset: 14 });
    const props = Topics.mock.calls[0]![0] as { topics: unknown[]; paging: unknown };
    expect(props.topics).toHaveLength(7);
    expect(props.paging).toEqual({ page: 3, pages: 5 });
  });

  it('pages a filter by its own total', async () => {
    getOwnerPage.mockResolvedValue(business);
    render(await QuestionsPage({ searchParams: Promise.resolve({ show: 'needs' }) }));
    expect(Topics.mock.lastCall?.[0]).toMatchObject({ paging: { page: 1, pages: 2 } });
  });

  // Owner, 19 Nov 2026: "Chat answers" is dropped, and old links to it still open the page.
  it('opens an old ?show=chat link as All', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([{ id: 't1' }]);
    render(await QuestionsPage({ searchParams: Promise.resolve({ show: 'chat' }) }));
    expect(getTopics).toHaveBeenLastCalledWith('acc1', expect.objectContaining({ show: 'all' }));
    expect(Topics.mock.lastCall?.[0]).toMatchObject({ show: 'all', paging: { page: 1, pages: 5 } });
  });

  it('reads one topic by id for ?topic, leaves the list out, and keeps show and page for the way back', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([{ id: 't9', title: 'Harga' }]);
    render(await QuestionsPage({ searchParams: Promise.resolve({ topic: 't9', show: 'needs', page: '2' }) }));
    expect(getTopics).toHaveBeenLastCalledWith('acc1', { now: expect.any(Date), id: 't9' });
    expect(Topics.mock.lastCall?.[0]).toMatchObject({ topic: { id: 't9', title: 'Harga' }, topics: [], show: 'needs', paging: { page: 2, pages: 2 } });
  });

  it('sends a topic that is gone (or not this owner’s) back to the list', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([]);
    await expect(QuestionsPage({ searchParams: Promise.resolve({ topic: 'nope' }) })).rejects.toThrow('NEXT_REDIRECT:/app/questions');
    // Back to the list it came from: the same filter and page.
    await expect(QuestionsPage({ searchParams: Promise.resolve({ topic: 'nope', show: 'needs', page: '2' }) })).rejects.toThrow('NEXT_REDIRECT:/app/questions?show=needs&page=2');
  });

  it('does not read the week or the rate for a topic screen, which shows neither', async () => {
    getOwnerPage.mockResolvedValue(business);
    getQuestionWeek.mockClear();
    getAnswerRate.mockClear();
    getTopics.mockResolvedValue([{ id: 't9' }]);
    render(await QuestionsPage({ searchParams: Promise.resolve({ topic: 't9' }) }));
    expect(getQuestionWeek).not.toHaveBeenCalled();
    expect(getAnswerRate).not.toHaveBeenCalled();
  });

  it('filters with ?show before paging, ignoring a filter it does not know', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([{ id: 't1' }]);
    render(await QuestionsPage({ searchParams: Promise.resolve({ show: 'needs', page: '2' }) }));
    expect(getTopics).toHaveBeenLastCalledWith('acc1', { now: expect.any(Date), show: 'needs', limit: 7, offset: 7 });
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
    expect(getQuestionWeek).toHaveBeenCalledWith('acc1', now);
    // The card says "this week": seven days, not the thirty the query defaults to.
    // The same window as the week card: from the week's first Malaysian midnight, not a rolling 168 hours.
    expect(getAnswerRate).toHaveBeenCalledWith('acc1', now, 7, { from: questionWeekStart.mock.results.at(-1)!.value });
    expect(props).toMatchObject({
      week: { thisWeek: 39, lastWeek: 27, days: [3, 5, 4, 8, 6, 7, 6] },
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
