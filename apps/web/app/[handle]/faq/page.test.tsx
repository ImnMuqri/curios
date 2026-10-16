import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FaqIndex } from '@curios/db-read';

const getFaqIndex = vi.fn();
vi.mock('@curios/db-read', () => ({ getFaqIndex }));

// Throws, because the real `notFound` throws NEXT_NOT_FOUND. A recording mock
// lets control fall past a 404 the route must not survive.
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound }));

const FaqIndexPage = (await import('./page.js')).default;

const index: FaqIndex = {
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  theme: { accentColor: '#2340c8', headingFont: 'JAKARTA', background: 'PAPER', backgroundColor: null },
  entries: [
    { slug: 'berapa-harga', question: 'Berapa harga kek lapis?', answer: 'RM12 sekotak.', askCount: 9 },
    { slug: 'ada-halal', question: 'Ada sertifikasi halal?', answer: 'Ya.', askCount: 4 },
  ],
  total: 2,
};

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });

describe('the FAQ index', () => {
  it('links every question to its own page', async () => {
    getFaqIndex.mockResolvedValueOnce(index);

    render(await FaqIndexPage(params('nadia')));

    // Real anchors, so this works before any JavaScript and is what a crawler
    // follows.
    const first = screen.getByRole('link', { name: /Berapa harga kek lapis\?/ });
    expect(first).toHaveAttribute('href', '/nadia/faq/berapa-harga');
    // How often each was asked, beside it.
    expect(first).toHaveTextContent('9 asked');
    // One per entry, plus the two ways back to the page itself (the arrow and the name).
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('narrows the list as the visitor searches, and offers to ask when nothing matches', async () => {
    getFaqIndex.mockResolvedValueOnce(index);
    render(await FaqIndexPage(params('nadia')));

    fireEvent.change(screen.getByRole('textbox', { name: 'Search questions' }), { target: { value: 'halal' } });
    expect(screen.queryByRole('link', { name: /Berapa harga/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Ada sertifikasi halal/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search questions' }), { target: { value: 'delivery' } });
    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask Nadia Bakes' })).toHaveAttribute('href', '/nadia#ask');
  });

  it('links back to the page itself, like the entry page does', async () => {
    getFaqIndex.mockResolvedValueOnce(index);

    render(await FaqIndexPage(params('nadia')));

    expect(screen.getByRole('link', { name: /back to nadia bakes/i })).toHaveAttribute(
      'href',
      '/nadia',
    );
  });

  it('404s a page with no FAQ pages rather than showing an empty index', async () => {
    // An index of nothing is a page with no reason to exist, and Google
    // indexing it is worse than it not existing.
    getFaqIndex.mockResolvedValueOnce({ ...index, entries: [] });

    await expect(FaqIndexPage(params('nadia'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s a handle with no published business page', async () => {
    getFaqIndex.mockResolvedValueOnce(null);

    await expect(FaqIndexPage(params('nobody'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
