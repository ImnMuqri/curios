import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FaqIndex } from '@curios/db-read';

const getFaqIndex = vi.fn();
const getPageAvailability = vi.fn(async (): Promise<{ status: string; language: string }> => ({ status: 'missing', language: 'en' }));
vi.mock('@curios/db-read', () => ({ getFaqIndex, getPageAvailability }));

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
  language: 'en',
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
    // The start of the owner's answer beside it, and no count of how often it was asked.
    expect(first).toHaveTextContent('RM12 sekotak.');
    expect(first).not.toHaveTextContent('asked');
    // One per entry, plus the two ways back to the page itself (the arrow and "Back to").
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('cuts a long answer to an excerpt at a word, with an ellipsis', async () => {
    getFaqIndex.mockResolvedValueOnce({
      ...index,
      entries: [{ slug: 'panjang', question: 'Panjang?', answer: `${'perkataan '.repeat(30)}akhir`, askCount: 1 }],
    });
    render(await FaqIndexPage(params('nadia')));
    const link = screen.getByRole('link', { name: /Panjang\?/ });
    expect(link).toHaveTextContent(/perkataan…$/);
    expect(link.textContent).not.toContain('akhir');
  });

  it('has an ask bar that opens the page’s chat with the question typed in', async () => {
    getFaqIndex.mockResolvedValueOnce(index);
    render(await FaqIndexPage(params('nadia')));
    const field = screen.getByRole('textbox', { name: 'Ask Nadia Bakes anything' });
    expect(field).toHaveAttribute('name', 'q');
    const form = field.closest('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/nadia#ask');
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute('type', 'submit');
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

    for (const link of screen.getAllByRole('link', { name: /back to nadia bakes/i })) {
      expect(link).toHaveAttribute('href', '/nadia');
    }
  });

  it('404s a page with no FAQ pages rather than showing an empty index', async () => {
    // An index of nothing is a page with no reason to exist, and Google
    // indexing it is worse than it not existing.
    getFaqIndex.mockResolvedValueOnce({ ...index, entries: [] });

    await expect(FaqIndexPage(params('nadia'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('says the page is unavailable, in its language and not indexed, when it is suspended', async () => {
    getFaqIndex.mockResolvedValue(null);
    getPageAvailability.mockResolvedValue({ status: 'suspended', language: 'ms' });
    try {
      render(await FaqIndexPage(params('nadia')));
      expect(screen.getByRole('heading', { name: 'Halaman ini tidak tersedia' })).toBeInTheDocument();
      expect(screen.getByText('Ia diturunkan buat masa ini.')).toBeInTheDocument();
      const { generateMetadata } = await import('./page.js');
      expect((await generateMetadata(params('nadia'))).robots).toMatchObject({ index: false });
    } finally {
      getFaqIndex.mockReset();
      getPageAvailability.mockResolvedValue({ status: 'missing', language: 'en' });
    }
  });

  it('404s a handle with no published business page', async () => {
    getFaqIndex.mockResolvedValueOnce(null);

    await expect(FaqIndexPage(params('nobody'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
