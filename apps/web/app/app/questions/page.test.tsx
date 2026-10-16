import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getTopics = vi.fn();
const getOwnerPage = vi.fn();
const getMyCurios = vi.fn();
const countQuestionsThisWeek = vi.fn();
vi.mock('@curios/db-read', () => ({ getTopics, getOwnerPage, getMyCurios, countQuestionsThisWeek }));

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
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  trialResetAt: null,
  allowSearchIndexing: false,
  avatarKey: null,
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

    render(await QuestionsPage());

    expect(Topics.mock.calls[0]?.[0]).toMatchObject({ publishesFaq: false });
  });

  it('tells the list a business page publishes them', async () => {
    getOwnerPage.mockResolvedValue(business);

    render(await QuestionsPage());

    expect(Topics.mock.calls[0]?.[0]).toMatchObject({ publishesFaq: true });
  });

  it('hands the list the topics and the length limits from core', async () => {
    getOwnerPage.mockResolvedValue(business);
    getTopics.mockResolvedValue([{ id: 't1' }]);

    render(await QuestionsPage());

    expect(getTopics).toHaveBeenCalledWith('acc1', { now: expect.any(Date) });
    expect(Topics.mock.calls[0]?.[0]).toMatchObject({ topics: [{ id: 't1' }], answerMax: 2000, titleMax: 200, faqMinAsks: 3 });
  });

  it('hands over this week, the page, and one moment for the whole screen', async () => {
    getOwnerPage.mockResolvedValue(business);

    render(await QuestionsPage());

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

    render(await QuestionsPage());

    expect(screen.queryByRole('main')).toBeNull();
  });
});
