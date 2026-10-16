import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FaqAnswer } from '@curios/db-read';

const getFaqEntry = vi.fn();
const getFaqRedirect = vi.fn();
vi.mock('@curios/db-read', () => ({ getFaqEntry, getFaqRedirect }));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const permanentRedirect = vi.fn((to: string) => {
  throw new Error(`PERMANENT_REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ notFound, permanentRedirect }));

const FaqEntryPage = (await import('./page.js')).default;

const entry: FaqAnswer = {
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  theme: { accentColor: '#2340c8', headingFont: 'JAKARTA', background: 'PAPER', backgroundColor: null },
  question: 'Berapa harga kek lapis?',
  answer: 'RM12 sekotak, RM60 lima kotak.',
  askCount: 14,
  related: [{ slug: 'ada-halal', question: 'Ada sertifikasi halal?' }],
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
    expect(screen.getByText(/Answered by Nadia Bakes · asked 14 times/)).toBeInTheDocument();
  });

  it('offers the conversation, and the page\'s other answers', async () => {
    getFaqEntry.mockResolvedValueOnce(entry);

    render(await FaqEntryPage(params('nadia', 'berapa-harga')));

    expect(screen.getByRole('link', { name: 'Ask' })).toHaveAttribute('href', '/nadia#ask');
    expect(screen.getByRole('link', { name: 'Ada sertifikasi halal?' })).toHaveAttribute('href', '/nadia/faq/ada-halal');
    expect(screen.getByRole('link', { name: 'All questions' })).toHaveAttribute('href', '/nadia/faq');
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

  // Review Focus 5.
  it('sends a retired address to its topic page with a permanent redirect', async () => {
    getFaqEntry.mockResolvedValueOnce(null);
    getFaqRedirect.mockResolvedValueOnce('what-is-imans-full-name');

    await expect(FaqEntryPage(params('Nadia', 'what-is-his-full-name'))).rejects.toThrow(
      'PERMANENT_REDIRECT:/nadia/faq/what-is-imans-full-name',
    );
    expect(getFaqRedirect).toHaveBeenCalledWith('Nadia', 'what-is-his-full-name');
  });

  it('404s an address that is neither live nor redirected', async () => {
    getFaqEntry.mockResolvedValueOnce(null);
    getFaqRedirect.mockResolvedValueOnce(null);

    await expect(FaqEntryPage(params('nadia', 'gone'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('does not look for a redirect when the entry is live', async () => {
    getFaqRedirect.mockClear();
    getFaqEntry.mockResolvedValueOnce(entry);

    render(await FaqEntryPage(params('nadia', 'berapa-harga')));

    expect(getFaqRedirect).not.toHaveBeenCalled();
  });

  it('404s a slug whose answer has been withdrawn', async () => {
    getFaqEntry.mockResolvedValueOnce(null);
    getFaqRedirect.mockResolvedValueOnce(null);

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
