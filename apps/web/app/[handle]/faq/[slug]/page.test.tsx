import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FaqAnswer } from '@curios/db-read';

const getFaqEntry = vi.fn();
vi.mock('@curios/db-read', () => ({ getFaqEntry }));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound }));

const FaqEntryPage = (await import('./page.js')).default;

const entry: FaqAnswer = {
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  question: 'Berapa harga kek lapis?',
  answer: 'RM12 sekotak, RM60 lima kotak.',
};

const params = (handle: string, slug: string) => ({
  params: Promise.resolve({ handle, slug }),
});

describe('one FAQ answer', () => {
  it('renders the question as the heading and the owner exact answer', async () => {
    getFaqEntry.mockResolvedValueOnce(entry);

    render(await FaqEntryPage(params('nadia', 'berapa-harga')));

    expect(screen.getByRole('heading', { name: 'Berapa harga kek lapis?' })).toBeInTheDocument();
    expect(screen.getByText('RM12 sekotak, RM60 lima kotak.')).toBeInTheDocument();
  });

  it('carries FAQPage structured data holding the pair', async () => {
    getFaqEntry.mockResolvedValueOnce(entry);

    const { container } = render(await FaqEntryPage(params('nadia', 'berapa-harga')));

    const block = container.querySelector('script[type="application/ld+json"]');
    const parsed = JSON.parse(block!.innerHTML) as {
      '@type': string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(parsed['@type']).toBe('FAQPage');
    expect(parsed.mainEntity[0]!.name).toBe('Berapa harga kek lapis?');
    expect(parsed.mainEntity[0]!.acceptedAnswer.text).toBe('RM12 sekotak, RM60 lima kotak.');
  });

  it('cannot be made to close its own script element', async () => {
    // The injection the escape exists for, asserted where it would actually
    // happen. An owner is the attacker here, and the target is every visitor.
    getFaqEntry.mockResolvedValueOnce({
      ...entry,
      answer: '</script><img src=x onerror=alert(1)>',
    });

    const { container } = render(await FaqEntryPage(params('nadia', 'berapa-harga')));

    const block = container.querySelector('script[type="application/ld+json"]');
    expect(block!.innerHTML).not.toContain('<');
    // And no element escaped into the document.
    expect(container.querySelector('img')).toBeNull();
  });

  it('404s a slug whose answer has been withdrawn', async () => {
    getFaqEntry.mockResolvedValueOnce(null);

    await expect(FaqEntryPage(params('nadia', 'berapa-harga'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
