import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { OwnerTopic } from '@curios/db-read';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), usePathname: () => '/app/questions', useSearchParams: () => new URLSearchParams() }));
const apiFetch = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock('../../../lib/api.js', () => ({ apiFetch, ApiError: class extends Error {} }));

const { Questions } = await import('./questions-screen.js');

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  apiFetch.mockClear();
});

const topic: OwnerTopic = {
  id: 't1',
  title: 'Do you deliver to Klang?',
  askCount: 14,
  answer: null,
  conflictAnswer: null,
  faqSlug: null,
  faqSuppressed: false,
  lastAskedAt: new Date('2026-10-17T03:00:00Z'),
  chat: null,
  wordings: [{ id: 'w1', text: 'Do you deliver to Klang?', askCount: 14 }],
};

describe('Questions, the screen with its router', () => {
  it('refreshes after a delete navigates away, so the layout’s counts (sidebar, phone menu, bell) are read again', async () => {
    render(
      <Questions
        topics={[]}
        topic={topic}
        show="needs"
        paging={{ page: 1, pages: 1 }}
        week={{ thisWeek: 0, lastWeek: 0, days: [0, 0, 0, 0, 0, 0, 0] }}
        answerRate={{ answered: 0, recorded: 0 }}
        publishesFaq
        faqMinAsks={3}
        handle="keklina"
        publicUrl="https://curios.my/keklina"
        answerMax={2000}
        titleMax={200}
        pageName="Kek Lina"
        look={{ accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null }}
        now="2026-10-17T06:00:00Z"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete topic' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, delete topic' }));
    });
    expect(push).toHaveBeenCalledWith('/app/questions?show=needs');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]!);
  });
});
