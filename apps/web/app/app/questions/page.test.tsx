import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getQuestions = vi.fn();
const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getQuestions, getOwnerPage }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// The list closes over apiFetch and the router. These tests are about what the
// page tells it, so the list records its props instead.
const Questions = vi.fn((_props: { questions: unknown[]; publishesFaq: boolean }) => null);
vi.mock('./question-list.js', () => ({ Questions }));

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
};

describe('QuestionsPage', () => {
  beforeEach(() => {
    getQuestions.mockReset();
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    Questions.mockClear();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getQuestions.mockResolvedValue([]);
  });

  it('tells the list a personal page publishes no FAQ pages', async () => {
    getOwnerPage.mockResolvedValue({ ...business, mode: 'PERSONAL' });

    render(await QuestionsPage());

    expect(Questions.mock.calls[0]?.[0]).toMatchObject({ publishesFaq: false });
  });

  it('tells the list a business page publishes them', async () => {
    getOwnerPage.mockResolvedValue(business);

    render(await QuestionsPage());

    expect(Questions.mock.calls[0]?.[0]).toMatchObject({ publishesFaq: true });
  });

  // Fix round 2, Important #3: AppFrame renders its own main around every
  // screen it wraps, this one included, so a second one here would nest.
  it('renders no main of its own', async () => {
    getOwnerPage.mockResolvedValue(business);

    render(await QuestionsPage());

    expect(screen.queryByRole('main')).toBeNull();
  });
});
