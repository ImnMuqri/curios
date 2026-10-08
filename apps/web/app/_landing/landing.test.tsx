import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { LandingPage, landingMetadata } from './LandingPage.js';
import { COPY, en, ms } from './copy.js';
import { DEMO_QA, STORM_WORDINGS } from './demo.js';
import { BRAND } from './brand-colors.js';
import { LeadsStory } from './LeadsStory.js';
import { BusinessPrice } from './BusinessPrice.js';
import { ClaimField } from './ClaimField.js';
import { HeroDemo } from './HeroDemo.js';
import { mergeFor } from './StormStage.js';

const LOCALES = ['en', 'ms'] as const;

describe('the landing page', () => {
  it.each(LOCALES)('%s: has exactly one h1, and headings never skip a level', (locale) => {
    const { container } = render(<LandingPage locale={locale} />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);

    // The demo phone renders a real BentoPage, whose owner name is an h1 on
    // the product's own page. Here it must not be.
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it.each(LOCALES)('%s: every link goes somewhere that exists', (locale) => {
    // "No dead links": the only routes the page may point at are its own two
    // languages, its own anchors, and the two auth screens.
    const { container } = render(<LandingPage locale={locale} />);
    const allowed = new Set(['/', '/ms', '/signin', '/signup', '#main', '#how', '#pricing', '#faq']);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) expect(allowed).toContain(href);

    // Every in-page link lands on a section that exists.
    for (const href of hrefs.filter((h) => h?.startsWith('#'))) expect(container.querySelector(href!)).not.toBeNull();

    // The curios.my/ fields are real forms: they still reach sign-up with no JavaScript.
    const forms = [...container.querySelectorAll('form')];
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form).toHaveAttribute('action', '/signup');
      expect(form.querySelector('input[name="handle"]')).not.toBeNull();
    }
  });

  it.each(LOCALES)('%s: declares its language on the page itself', (locale) => {
    // The root layout's <html lang> is fixed to "en"; the Malay page has to
    // say so on its own outermost element.
    const { container } = render(<LandingPage locale={locale} />);
    expect(container.querySelector('[data-landing]')).toHaveAttribute('lang', locale);
  });

  it.each(LOCALES)('%s: ships structured data that matches what the page shows', (locale) => {
    const { container } = render(<LandingPage locale={locale} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.textContent) as { '@graph': Array<Record<string, unknown>> };
    const types = data['@graph'].map((node) => node['@type']);
    expect(types).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);

    const app = data['@graph'][2] as { offers: Array<{ price: string; priceCurrency: string }> };
    expect(app.offers.map((o) => o.price)).toEqual(['0', '39', '390']);
    expect(new Set(app.offers.map((o) => o.priceCurrency))).toEqual(new Set(['MYR']));

    const faq = data['@graph'][3] as { mainEntity: Array<{ name: string }> };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(COPY[locale].faq.items.map((item) => item.q));
    for (const item of COPY[locale].faq.items) expect(screen.getAllByText(item.q).length).toBeGreaterThan(0);
  });

  it('escapes "<" in structured data, so no copy can close the script tag', () => {
    const { container } = render(<LandingPage locale="en" />);
    expect(container.querySelector('script[type="application/ld+json"]')!.innerHTML).not.toContain('<');
  });
});

describe('metadata', () => {
  it.each(LOCALES)('%s: title and description fit in a search result', (locale) => {
    const meta = landingMetadata(locale);
    expect(typeof meta.title).toBe('string');
    expect((meta.title as string).length).toBeLessThan(60);
    expect(meta.description?.length).toBeLessThan(155);
  });

  it('points each language at itself and at the other', () => {
    expect(landingMetadata('en').alternates?.canonical).toBe('/');
    expect(landingMetadata('ms').alternates?.canonical).toBe('/ms');
    expect(landingMetadata('ms').alternates?.languages).toEqual({ 'en-MY': '/', 'ms-MY': '/ms', 'x-default': '/' });
  });
});

describe('copy', () => {
  it('has the same shape in both languages', () => {
    // A Malay page missing a FAQ answer or a step would render a hole.
    const shape = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(shape)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
          : typeof value;
    expect(shape(ms)).toEqual(shape(en));
  });

  it('never uses the words the brief bans', () => {
    const text = JSON.stringify([en, ms]).toLowerCase();
    for (const word of ['seamless', 'revolutioni', 'empower', 'leverage', 'unlock', 'game-chang', 'cutting-edge', 'supercharge', 'effortless', 'elevate', 'next-level', 'harness', 'all-in-one']) {
      expect(text).not.toContain(word);
    }
  });

  it('has no em dashes anywhere a visitor reads', () => {
    expect(JSON.stringify([en, ms])).not.toMatch(/—/);
    render(<LandingPage locale="en" />);
    render(<LandingPage locale="ms" />);
    expect(document.body.textContent).not.toMatch(/—/);
  });

  it('never claims Instagram import, which does not exist', () => {
    // apps/workers/src/sources/instagram.adapter.ts throws NOT_CONFIGURED.
    for (const copy of [en, ms]) {
      const text = JSON.stringify(copy).toLowerCase();
      expect(text).not.toMatch(/paste (your )?instagram handle/);
      expect(text).toMatch(/instagram/);
    }
  });
});

describe('the storm', () => {
  it('draws exactly forty distinct wordings, because the copy says forty', () => {
    expect(STORM_WORDINGS).toHaveLength(40);
    expect(new Set(STORM_WORDINGS).size).toBe(40);
    expect(en.storm.body).toMatch(/forty/);
    expect(ms.storm.body).toMatch(/empat puluh/);
  });

  it('holds still at both ends of the scroll, so each state can be read', () => {
    expect(mergeFor(0)).toBe(0);
    expect(mergeFor(0.2)).toBe(0);
    expect(mergeFor(0.8)).toBe(1);
    expect(mergeFor(1)).toBe(1);
    expect(mergeFor(0.5)).toBeGreaterThan(0.4);
    expect(mergeFor(0.5)).toBeLessThan(0.6);
  });

  it('ends on one question, asked forty times, with the same answer the hero demo gives', () => {
    render(<LandingPage locale="en" />);
    expect(screen.getAllByText(DEMO_QA[0]!.a).length).toBeGreaterThan(0);
    expect(screen.getByText('asked 40×')).toBeInTheDocument();
  });
});

describe('the leads story', () => {
  it('jumps to any step, and shows the email only once the lead has been sent', async () => {
    render(<LeadsStory copy={en.leads} />);
    const steps = within(screen.getByRole('list')).getAllByRole('button');
    expect(steps).toHaveLength(5);

    const email = screen.getByText(/New lead for/).closest('article')!;
    await act(async () => fireEvent.click(steps[1]!));
    expect(email).toHaveAttribute('data-shown', 'no');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');

    await act(async () => fireEvent.click(steps[3]!));
    expect(email).toHaveAttribute('data-shown', 'yes');
  });

  it('shows the last step straight away when motion is reduced', async () => {
    const stub = window.matchMedia.bind(window);
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ ...stub(query), matches: query.includes('reduce') }));
    try {
      render(<LeadsStory copy={en.leads} />);
      const steps = within(screen.getByRole('list')).getAllByRole('button');
      expect(steps[4]).toHaveAttribute('aria-current', 'step');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('brand colours', () => {
  it('mirror tokens.css exactly', () => {
    // The OG image and touch icon cannot read CSS variables, so they use this
    // mirror. If the brand changes in tokens.css, this fails until it follows.
    const tokens = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'ui', 'src', 'tokens.css'), 'utf8');
    const read = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase();
    expect(BRAND).toEqual({
      ink: read('ink'),
      paper: read('paper'),
      biru: read('biru'),
      biruMuda: read('biru-muda'),
      kuning: read('kuning'),
      card: read('card'),
      muted: read('muted'),
    });
  });
});

describe('the interactive bits', () => {
  it('switches Business between monthly and yearly, and says which is on', async () => {
    render(<BusinessPrice business={en.pricing.business} />);
    expect(screen.getByText('RM39')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yearly' })));
    expect(screen.getByText('RM390')).toBeInTheDocument();
    expect(screen.getByText(en.pricing.business.billing.yearNote)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the address being typed on the demo page beside it', async () => {
    render(
      <>
        <ClaimField id="claim-test" label="Address" placeholder="yourshop" button="Create" />
        <HeroDemo label="Demo" hint="Tap" />
      </>,
    );
    // Both the browser's address bar and the page's own handle line follow along.
    expect(screen.getAllByText('curios.my/keklina')).toHaveLength(2);

    await act(async () => fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'Rojak Pak Ali' } }));
    expect(screen.getAllByText('curios.my/rojakpakali')).toHaveLength(2);

    // Cleared: back to the demo shop's own address.
    await act(async () => fireEvent.change(screen.getByLabelText('Address'), { target: { value: '' } }));
    // Both the browser's address bar and the page's own handle line follow along.
    expect(screen.getAllByText('curios.my/keklina')).toHaveLength(2);
  });
});
