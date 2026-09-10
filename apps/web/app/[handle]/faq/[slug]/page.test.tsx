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

describe('the meta description', () => {
  it('leaves a short answer untouched', async () => {
    getFaqEntry.mockResolvedValueOnce(entry);

    const { generateMetadata } = await import('./page.js');
    const meta = await generateMetadata(params('nadia', 'berapa-harga'));

    expect(meta.description).toBe('RM12 sekotak, RM60 lima kotak.');
  });

  it('cuts before a price rather than mangling it mid-number', async () => {
    // Built so a hard `slice(0, 155)` lands exactly inside "RM120": 150 filler
    // characters with no space, then " RM120 sekotak." -- indices 0-149 are
    // filler, 150 is the space, 151-154 are "RM12". A naive slice(0, 155)
    // reproduces the review's exact failure, "RM120" truncated to "RM1". The
    // fix must instead back up to the last space and drop the whole word.
    const filler = 'x'.repeat(150);
    getFaqEntry.mockResolvedValueOnce({ ...entry, answer: `${filler} RM120 sekotak.` });

    const { generateMetadata } = await import('./page.js');
    const meta = await generateMetadata(params('nadia', 'berapa-harga'));

    expect(meta.description).toBe(`${filler}…`);
    expect(meta.description).not.toContain('RM1');
  });

  it('never splits a surrogate pair', async () => {
    // An emoji is one code point but two UTF-16 code units -- slicing a raw
    // string by index (rather than by code point) can land inside it and
    // leave a lone, unpaired surrogate in the output.
    const longPrefix = 'x'.repeat(154);
    getFaqEntry.mockResolvedValueOnce({ ...entry, answer: `${longPrefix}😀 more text after` });

    const { generateMetadata } = await import('./page.js');
    const meta = await generateMetadata(params('nadia', 'berapa-harga'));

    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
    expect(loneSurrogate.test(meta.description!)).toBe(false);
    expect(meta.description).toBe(`${longPrefix}😀…`);
  });
});
