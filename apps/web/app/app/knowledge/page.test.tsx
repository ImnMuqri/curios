import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';

const getKnowledge = vi.fn();
const getOwnerPage = vi.fn();
const getTopics = vi.fn();
vi.mock('@curios/db-read', () => ({ getKnowledge, getOwnerPage, getTopics }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const Sources = vi.fn((_p: object) => null);
const Facts = vi.fn((_p: object) => null);
const Pinned = vi.fn((_p: object) => null);
const NeverSay = vi.fn((_p: object) => null);
vi.mock('./sources-tab.js', () => ({ Sources }));
vi.mock('./facts-tab.js', () => ({ Facts }));
vi.mock('./pinned-tab.js', () => ({ Pinned }));
vi.mock('./never-say-tab.js', () => ({ NeverSay }));
const Ask = vi.fn((_p: object): ReactElement | null => null);
vi.mock('./ask-panel.js', () => ({ Ask }));

const KnowledgePage = (await import('./page.js')).default;

const knowledge = { sources: [], facts: [], pinned: [], neverSay: [] };
const page = { id: 'p1', handle: 'nadia', displayName: 'Nadia', published: true, mode: 'BUSINESS' };
const open = (tab?: string, more: Record<string, string> = {}) => KnowledgePage({ searchParams: Promise.resolve({ ...(tab ? { tab } : {}), ...more }) });

describe('KnowledgePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getOwnerPage.mockResolvedValue(page);
    getKnowledge.mockResolvedValue(knowledge);
    getTopics.mockResolvedValue([]);
  });

  it('sends a signed-out visitor to sign in', async () => {
    resolveOwner.mockResolvedValue(null);
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/signin');
  });

  // Review Focus 5.
  it('sends an owner with no page to onboarding', async () => {
    getOwnerPage.mockResolvedValue(null);
    getKnowledge.mockResolvedValue(null);
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });

  // `page` and `knowledge` are two separate reads; the test above sets both
  // to null at once, which a check on only one of them would still pass.
  // These pin each half of `!page || !knowledge` independently.
  it('sends to onboarding even when only the page read comes back empty', async () => {
    getOwnerPage.mockResolvedValue(null);
    getKnowledge.mockResolvedValue(knowledge);
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });

  it('sends to onboarding even when only the knowledge read comes back empty', async () => {
    getOwnerPage.mockResolvedValue(page);
    getKnowledge.mockResolvedValue(null);
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });

  it('opens Facts by default', async () => {
    render(await open());
    expect(Facts).toHaveBeenCalled();
    expect(Sources).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Facts , 0' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the tab in the address, with what it needs', async () => {
    render(await open('never-say'));
    expect(NeverSay.mock.calls[0]?.[0]).toMatchObject({ entries: [], max: 50, maxChars: 120 });
  });

  it('gives the Sources tab the page it adds sources to', async () => {
    render(await open('sources'));
    expect(Sources.mock.calls[0]?.[0]).toMatchObject({ pageId: 'p1', pastedTextMax: 20_000, startAdding: false });
  });

  it('gives the Facts tab the categories and the limit', async () => {
    render(await open('facts'));
    expect(Facts.mock.calls[0]?.[0]).toMatchObject({ ownerFactMax: 500 });
    expect((Facts.mock.calls[0]?.[0] as { categories: string[] }).categories).toContain('HOURS');
  });

  // Every fixture above uses `[]` for all four lists, so a swap -- Facts
  // handed `knowledge.sources`, say -- would still match `toMatchObject` and
  // pass unnoticed. Distinct, non-empty rows per list close that gap.
  it('gives each tab its own list, not another tab’s', async () => {
    getKnowledge.mockResolvedValue({
      sources: [{ id: 'src-1' }],
      facts: [{ id: 'fact-1' }],
      pinned: [{ id: 'pin-1' }],
      neverSay: [{ id: 'never-1' }],
    });

    render(await open('facts'));
    expect(Facts.mock.calls[0]?.[0]).toMatchObject({ facts: [{ id: 'fact-1' }] });

    render(await open('sources'));
    expect(Sources.mock.calls[0]?.[0]).toMatchObject({ sources: [{ id: 'src-1' }] });

    render(await open('pinned'));
    expect(Pinned.mock.calls[0]?.[0]).toMatchObject({ pinned: [{ id: 'pin-1' }] });

    render(await open('never-say'));
    expect(NeverSay.mock.calls[0]?.[0]).toMatchObject({ entries: [{ id: 'never-1' }] });
  });

  it('opens a tab with its add form when the address asks', async () => {
    render(await open('facts', { add: '1' }));
    expect(Facts.mock.calls[0]?.[0]).toMatchObject({ startAdding: true });
  });

  it('counts each tab', async () => {
    getKnowledge.mockResolvedValue({ sources: [{ id: 's' }], facts: [{ id: 'a' }, { id: 'b' }], pinned: [], neverSay: [{ id: 'n' }] });
    render(await open());
    expect(screen.getByRole('link', { name: 'Facts , 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sources , 1' })).toBeInTheDocument();
  });

  // What customers ask most, to try; a page nobody has asked yet gets starters for its kind.
  it('suggests what customers ask most in Ask your page', async () => {
    getTopics.mockResolvedValue([{ title: 'Berapa kek coklat 2kg?' }, { title: 'Ada delivery?' }]);
    render(await open());
    expect(getTopics).toHaveBeenCalledWith('acc1', { limit: 4 });
    expect(Ask.mock.calls[0]?.[0]).toMatchObject({ suggestions: ['Berapa kek coklat 2kg?', 'Ada delivery?'] });
  });

  it('suggests starters when nobody has asked yet', async () => {
    getOwnerPage.mockResolvedValue({ ...page, mode: 'PERSONAL' });
    render(await open());
    expect(Ask.mock.calls[0]?.[0]).toMatchObject({ suggestions: ['What do you do?', 'How can I reach you?', 'Where are you based?', 'What have you worked on?'] });
  });

  // Dashboard v2: Ask your page is a normal AI chat on the dashboard's neutral panel, so it takes
  // the page's name for its replies but not the page's colours.
  it('gives Ask your page the page name, not its colours', async () => {
    render(await open());
    expect(Ask.mock.calls[0]?.[0]).toMatchObject({ pageName: 'Nadia' });
    expect(Ask.mock.calls[0]?.[0]).not.toHaveProperty('look');
  });

  // Dashboard v2: "Ask your page" runs the full height of the sheet, so the
  // header sits over the left column only, with the tabs under it.
  it('puts the header over the left column, with the tabs', async () => {
    Ask.mockImplementationOnce(() => <aside aria-label="Try your page" />);
    render(await open());
    const title = screen.getByRole('heading', { level: 1, name: 'Facts & sources' });
    const side = screen.getByRole('complementary', { name: 'Try your page' });
    expect(side.contains(title)).toBe(false);
    expect(side.previousElementSibling).toContainElement(title);
    expect(side.previousElementSibling).toContainElement(screen.getByRole('navigation', { name: 'Knowledge' }));
  });

  // AppFrame renders its own main around every screen it wraps, this one
  // included (app-frame.test.tsx), so a second one here would nest -- the
  // same reason questions/page.tsx and leads/page.tsx pass `as="div"`.
  it('renders no main of its own', async () => {
    render(await open());
    expect(screen.queryByRole('main')).toBeNull();
  });
});
