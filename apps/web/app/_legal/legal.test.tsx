import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DOCS, LEGAL_DOCS, LEGAL_PATH, OPERATOR, type Block } from './content.js';
import { LegalPage, legalMetadata } from './LegalPage.js';

const text = (block: Block) => (typeof block === 'string' ? [block] : block.list);

describe('LegalPage', () => {
  it('shows the page’s title, marks its tab, and links the same page in the other language', () => {
    render(<LegalPage doc="privacy" locale="en" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Policies' });
    expect(within(tabs).getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Terms' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Bahasa Melayu' })).toHaveAttribute('href', '/ms/privacy');
  });

  it('sets the Malay page’s language, and links back to the English one', () => {
    const { container } = render(<LegalPage doc="refunds" locale="ms" />);
    expect(container.firstElementChild).toHaveAttribute('lang', 'ms');
    expect(screen.getByRole('heading', { level: 1, name: 'Dasar Bayaran Balik' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute('href', '/refunds');
  });

  it('turns the support address and the other pages’ names into links', () => {
    render(<LegalPage doc="terms" locale="en" />);
    for (const link of screen.getAllByRole('link', { name: 'support@curios.my' })) {
      expect(link).toHaveAttribute('href', 'mailto:support@curios.my');
    }
    expect(screen.getAllByRole('link', { name: 'Refund Policy' })[0]).toHaveAttribute('href', '/refunds');
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })[0]).toHaveAttribute('href', '/privacy');
  });

  it('leaves no placeholder token unrendered, in any page or language', () => {
    for (const locale of ['en', 'ms'] as const) {
      for (const doc of LEGAL_DOCS) {
        const { container, unmount } = render(<LegalPage doc={doc} locale={locale} />);
        expect(container.textContent).not.toMatch(/\{[a-z]+\}/);
        unmount();
      }
    }
  });

  it('says the same things in both languages: the same sections, paragraphs and list items', () => {
    for (const doc of LEGAL_DOCS) {
      const en = DOCS.en[doc].sections;
      const ms = DOCS.ms[doc].sections;
      expect(ms.length).toBe(en.length);
      en.forEach((section, i) => {
        expect(ms[i]!.body.map((b) => text(b).length)).toEqual(section.body.map((b) => text(b).length));
        // A link in one language is a link in the other.
        const tokens = (blocks: Block[]) => blocks.flatMap(text).join(' ').match(/\{[a-z]+\}/g) ?? [];
        expect(tokens(ms[i]!.body)).toEqual(tokens(section.body));
      });
    }
  });

  it('says, in both languages, that shop customers may pay through the owner’s own CHIP account, and what that shares', () => {
    const all = (locale: 'en' | 'ms', doc: 'terms' | 'privacy') => DOCS[locale][doc].sections.flatMap((s) => s.body.flatMap(text)).join(' ');
    expect(all('en', 'terms')).toContain('online through the owner’s own CHIP account');
    expect(all('en', 'terms')).toContain('We store the key encrypted and use it only to take payments for their shop.');
    expect(all('en', 'terms')).toContain('The owner is responsible for their CHIP account');
    expect(all('ms', 'terms')).toContain('akaun CHIP pemilik sendiri');
    expect(all('ms', 'terms')).toContain('Kami menyimpan kunci itu dalam bentuk tersulit');
    expect(all('en', 'privacy')).toContain('CHIP (Malaysia): processes online payments for shop orders');
    expect(all('en', 'privacy')).toContain('your email address, for CHIP’s receipt, and how you paid (the bank you chose, or your card’s brand and last four digits)');
    expect(all('ms', 'privacy')).toContain('cara anda membayar (bank yang anda pilih, atau jenama kad dan empat digit terakhirnya)');
    expect(all('ms', 'privacy')).toContain('CHIP (Malaysia): memproses bayaran dalam talian untuk tempahan kedai');
  });

  it('names who runs Curios on the Terms and Privacy pages', () => {
    for (const doc of ['terms', 'privacy'] as const) {
      const { container, unmount } = render(<LegalPage doc={doc} locale="en" />);
      expect(container.textContent).toContain(OPERATOR.name);
      unmount();
    }
  });

  it('gives each page a canonical address and its other-language alternate', () => {
    const meta = legalMetadata('terms', 'ms');
    expect(meta.title).toBe('Terma Perkhidmatan · Curios');
    expect(meta.alternates?.canonical).toBe(LEGAL_PATH.ms.terms);
    expect(meta.alternates?.languages).toMatchObject({ 'en-MY': '/terms', 'ms-MY': '/ms/terms' });
  });
});
