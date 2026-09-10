import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  entries: [
    { slug: 'berapa-harga', question: 'Berapa harga kek lapis?' },
    { slug: 'ada-halal', question: 'Ada sertifikasi halal?' },
  ],
};

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });

describe('the FAQ index', () => {
  it('links every question to its own page', async () => {
    getFaqIndex.mockResolvedValueOnce(index);

    render(await FaqIndexPage(params('nadia')));

    // Real anchors, so this works before any JavaScript and is what a crawler
    // follows.
    expect(screen.getByRole('link', { name: 'Berapa harga kek lapis?' })).toHaveAttribute(
      'href',
      '/nadia/faq/berapa-harga',
    );
    // One per entry, plus the link back to the page itself.
    expect(screen.getAllByRole('link')).toHaveLength(3);
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
