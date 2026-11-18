import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings } from '@curios/core/settings';
import { raisedSettings } from '@curios/core/test-settings';
import { LandingPage, landingMetadata } from './LandingPage.js';
import { COPY, landingCopy } from './copy.js';
import { structuredData } from './structured-data.js';
import { BRAND } from './brand-colors.js';
import { payback } from './Pricing.js';

const LOCALES = ['en', 'ms'] as const;
/** The prices and allowances in force: the defaults, as a database with no rows gives. */
const TERMS = defaultSettings();
const en = landingCopy('en', TERMS);
const ms = landingCopy('ms', TERMS);

/** Every visitor-facing string in a copy object, functions called with sample arguments. */
function words(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'function') return String((value as (...a: unknown[]) => unknown)('x', 2, 3));
  if (Array.isArray(value)) return value.map(words).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(words).join(' ');
  return '';
}

function reduceMotion() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the landing page', () => {
  it.each(LOCALES)('%s: has one h1, the headline, and every section the nav links to', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(COPY[locale].hero.line);
    for (const id of ['who', 'how', 'business', 'pricing', 'faq']) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
      expect(container.querySelector(`a[href="#${id}"]`)).not.toBeNull();
    }
    expect(container.firstElementChild).toHaveAttribute('lang', locale);
  });

  it('links the other language, sign in and sign up', () => {
    render(<LandingPage locale="ms" terms={TERMS} />);
    const nav = screen.getByRole('banner');
    expect(within(nav).getByRole('link', { name: 'English' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Log masuk' })).toHaveAttribute('href', '/signin');
    expect(within(nav).getByRole('link', { name: 'Buat halaman anda' })).toHaveAttribute('href', '/signup');
  });

  it('escapes "<" in structured data, so no copy can close the script tag', () => {
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    expect(container.querySelector('script[type="application/ld+json"]')!.innerHTML).not.toContain('<');
  });

  it('prices the structured data from the prices in force', () => {
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    const data = container.querySelector('script[type="application/ld+json"]')!.innerHTML;
    expect(data).toContain(`"price":"${TERMS.prices.MONTHLY / 100}"`);
    expect(data).toContain(`"price":"${TERMS.prices.ANNUAL / 100}"`);
  });
});

describe('motion', () => {
  it('holds every scene on its finished frame when the visitor asks for less motion', () => {
    reduceMotion();
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    // The hero's front page is answered, with no cursor and no caret.
    const hero = container.querySelector('section')!;
    expect(hero).toHaveTextContent(en.personas.aisyah.a);
    // Every zone has landed.
    expect(container.querySelector('#business')).toHaveTextContent(en.lands.service.first.title);
    // The closing line is up, not waiting to rise.
    expect(screen.getByRole('heading', { name: 'Curious? Just ask' })).toHaveAttribute('data-in');
  });

});

describe('pricing', () => {
  it('switches Business between monthly and yearly, and says which is on', async () => {
    render(<LandingPage locale="en" terms={TERMS} />);
    const pricing = document.querySelector('#pricing') as HTMLElement;
    expect(within(pricing).getByText('RM49 a month')).toBeInTheDocument();
    await userEvent.click(within(pricing).getByRole('button', { name: /Yearly/ }));
    expect(within(pricing).getByRole('button', { name: /Yearly/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(pricing).getByText('RM490 a year')).toBeInTheDocument();
    expect(pricing).toHaveTextContent('RM40.83 a month, paid once a year.');
  });

  it('works out the calculator from the real monthly price', () => {
    expect(en.pricing.monthlyRinggit).toBe(TERMS.prices.MONTHLY / 100);
    // Five orders of RM95: RM475, of which RM49 is about 10%, nine times over.
    expect(payback(5, 95, 49)).toMatchObject({ revenue: 475, pays: true, percent: 10, times: 9 });
    // One RM50 order does not cover it.
    expect(payback(1, 40, 49).pays).toBe(false);
  });
});

describe('pricing, at the prices the admin set', () => {
  const RAISED = raisedSettings({ freeLeads: 5 });

  it('shows the price in force, in both languages, and the calculator counts it', () => {
    render(<LandingPage locale="en" terms={RAISED} />);
    const pricing = document.querySelector('#pricing') as HTMLElement;
    expect(within(pricing).getByText('RM59 a month')).toBeInTheDocument();
    expect(within(pricing).getByRole('heading', { level: 2 })).toHaveTextContent('Free to be asked. RM59 when you’re selling.');
    expect(landingCopy('ms', RAISED).pricing.title).toBe('Percuma untuk ditanya. RM59 bila anda menjual.');
    expect(landingCopy('en', RAISED).pricing.monthlyRinggit).toBe(59);
  });

  it('prints a price with sen to two places, never RM49.5', () => {
    const SEN = { ...defaultSettings(), prices: { MONTHLY: 4950, ANNUAL: 49050 } };
    const en = landingCopy('en', SEN).pricing;
    expect(en.title).toBe('Free to be asked. RM49.50 when you’re selling.');
    expect(en.business.monthly).toBe('RM49.50');
    expect(en.business.yearly).toBe('RM490.50');
    expect(en.business.noteYearly).toBe('RM40.88 a month, paid once a year.');
    expect(landingCopy('ms', SEN).pricing.title).toBe('Percuma untuk ditanya. RM49.50 bila anda menjual.');
    // The calculator's bar says the same, not RM49.5.
    render(<LandingPage locale="en" terms={SEN} />);
    expect(within(document.querySelector('#pricing') as HTMLElement).getByText('Curios Business · RM49.50')).toBeInTheDocument();
  });

  it('counts the free leads in force', () => {
    expect(landingCopy('en', RAISED).pricing.business.points).toContain('Your first five leads are free');
    expect(landingCopy('en', RAISED).pricing.business.cta).toBe('Start with 5 free leads');
    expect(landingCopy('ms', RAISED).pricing.business.points).toContain('Lima lead pertama percuma');
    expect(landingCopy('ms', RAISED).pricing.business.cta).toBe('Mula dengan 5 lead percuma');
    expect(landingCopy('en', { ...RAISED, freeLeads: 1 }).pricing.business.points).toContain('Your first lead is free');
  });

  it('claims months free only when the prices give them', () => {
    const raised = landingCopy('en', RAISED).pricing;
    expect(raised.business.noteMonthly).toBe('Or RM490 a year.');
    expect(raised.twoMonths).toBe('');
    const tenTimes = landingCopy('en', { ...RAISED, prices: { MONTHLY: 5900, ANNUAL: 59000 } }).pricing;
    expect(tenTimes.business.noteMonthly).toBe('Or RM590 a year: two months free.');
    expect(tenTimes.twoMonths).toBe('−2 months');
  });

  it('says one RM95 order pays for Business only while it does: at RM95 a month, not at RM96', () => {
    const at = (MONTHLY: number) => ({ ...RAISED, prices: { ...RAISED.prices, MONTHLY } });
    expect(landingCopy('en', at(9500)).pricing.business.tag).toBe('One RM95 order pays for it');
    expect(landingCopy('ms', at(9500)).pricing.business.tag).toBe('Satu tempahan RM95 dah cukup bayar');
    expect(landingCopy('en', at(9600)).pricing.business.tag).toBe('');
    expect(landingCopy('ms', at(9600)).pricing.business.tag).toBe('');

    render(<LandingPage locale="en" terms={at(9600)} />);
    const pricing = document.querySelector('#pricing') as HTMLElement;
    expect(pricing).not.toHaveTextContent('One RM95 order pays for it');
    expect(pricing.querySelectorAll('[class*="planTag"]')).toHaveLength(1);
  });

  it('puts the prices in force in the structured data', () => {
    const offers = structuredData(landingCopy('en', RAISED), 'https://curios.my', RAISED.prices)['@graph'].flatMap((node) => ('offers' in node ? node.offers : []));
    expect(offers.map((o) => o?.price)).toEqual(['0', '59', '490']);
  });
});

describe('no cut, ever', () => {
  const section = (c: HTMLElement) => c.querySelector('#no-cut') as HTMLElement;
  const card = (c: HTMLElement) => section(c).querySelector('[role="img"]') as HTMLElement;
  const css = readFileSync(join(import.meta.dirname, 'tanya.module.css'), 'utf8');

  /** Motion allowed, and an observer the test moves in and out of view. */
  function watchable() {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    const watchers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          watchers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    return (ratio: number) =>
      act(() => watchers.forEach((w) => w([{ intersectionRatio: ratio, isIntersecting: ratio > 0 } as IntersectionObserverEntry], {} as IntersectionObserver)));
  }

  afterEach(() => vi.unstubAllGlobals());

  it.each(LOCALES)('%s: sits between For business and Pricing, with the board’s words', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    const ids = [...container.querySelectorAll('main > section[id]')].map((s) => s.id);
    expect(ids.slice(ids.indexOf('business'), ids.indexOf('business') + 3)).toEqual(['business', 'no-cut', 'pricing']);
    const copy = COPY[locale].noCut;
    const nc = section(container);
    expect(nc.querySelector('[class*="eyebrow"]')).toHaveTextContent(copy.eyebrow);
    expect(within(nc).getByRole('heading', { level: 2 })).toHaveTextContent(copy.title.join(''));
    // Named by its heading (jsdom's name adds a space around the inline 0%, which a browser does not).
    expect(document.getElementById(nc.getAttribute('aria-labelledby')!)).toBe(within(nc).getByRole('heading', { level: 2 }));
    expect(nc).toHaveTextContent(copy.sub('RM49'));
    expect(within(nc).getByRole('img', { name: copy.chartLabel })).toBeInTheDocument();
    for (const text of [copy.market.keep, copy.market.cut, copy.curios.keep, copy.site.title, copy.payments.title, copy.google.title, copy.google.result, copy.fine]) {
      expect(nc).toHaveTextContent(text);
    }
    expect(nc).toHaveTextContent(`curios.my/${copy.site.handle}`);
    expect([...nc.querySelectorAll('[class*="ncPays"] span')].map((s) => s.textContent)).toEqual(['FPX', 'TNG', 'GrabPay', 'Visa']);
  });

  it('carries the board’s numbers: RM100, about RM89 against RM99, and the 0%', () => {
    expect(en.noCut.title).toEqual(['Every sale is yours. We take ', '0%', '.']);
    expect(en.noCut.sub('RM49')).toBe('RM49 a month is all you pay us. However big the order.');
    expect(en.noCut.market).toEqual({ label: 'On a marketplace', note: 'platform fee, commission, transaction fee', keep: 'You keep about RM89', cut: '~RM11' });
    expect(en.noCut.curios).toEqual({ label: 'On Curios', note: 'only the bank’s RM1 FPX fee', keep: 'You keep RM99' });
    expect(en.noCut.fine).toBe('Marketplace example uses typical 2026 Malaysian fees: 5% platform fee, 2–6% commission and a 2.16% transaction fee. Card and e-wallet payments cost 1–2% through CHIP.');
    // The figures are the same in Malay.
    expect(ms.noCut.title[1]).toBe('0%');
    expect(ms.noCut.amount).toBe(en.noCut.amount);
    expect(ms.noCut.market.cut).toBe(en.noCut.market.cut);
    expect(ms.noCut.market.keep).toMatch(/RM89/);
    expect(ms.noCut.curios.keep).toMatch(/RM99/);
    expect(ms.noCut.payments.ways).toEqual(en.noCut.payments.ways);
  });

  it('quotes the price in force, in both languages', () => {
    const raised = raisedSettings({ freeLeads: 5 });
    render(<LandingPage locale="en" terms={raised} />);
    expect(section(document.body)).toHaveTextContent('RM59 a month is all you pay us.');
    expect(section(document.body)).not.toHaveTextContent('RM49');
    render(<LandingPage locale="ms" terms={raised} />);
    expect(document.querySelectorAll('#no-cut')[1]).toHaveTextContent('RM59 sebulan saja');
  });

  it('puts the 0% in the rose and the band on the board’s pink', () => {
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    expect(within(section(container)).getByText('0%').className).toMatch(/ncZero/);
    expect(css.match(/\n\.nc \{([^}]*)\}/)?.[1]).toMatch(/background:\s*var\(--tj-rose-100\)/);
    expect(css.match(/\n\.ncZero \{([^}]*)\}/)?.[1]).toMatch(/color:\s*var\(--tj-rose\)/);
  });

  it('hides the ~RM11 label on phones, so only the red bar shows', () => {
    const phone = [...css.matchAll(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(phone).toMatch(/\.ncCutLabel \{\s*display: none;/);
    render(<LandingPage locale="en" terms={TERMS} />);
    expect(section(document.body).querySelector('[class*="ncCutLabel"]')).toHaveTextContent('~RM11');
  });

  it('grows the bars only for visitors who have not asked for less motion', () => {
    const still = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');
    expect(still).not.toMatch(/animation:\s*ncGrow/);
    expect(css).toMatch(/animation: ncGrow 900ms/);
  });

  it.each(LOCALES)('%s: with reduced motion the bars are drawn full and never wait', (locale) => {
    reduceMotion();
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    expect(card(container)).not.toHaveAttribute('data-grow');
  });

  it('draws the bars full where nothing can tell it is in view', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    vi.stubGlobal('IntersectionObserver', undefined);
    // `'IntersectionObserver' in window` is still true with the stub, so take it away entirely.
    delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    expect(card(container)).not.toHaveAttribute('data-grow');
  });

  it('holds the bars short until the card is in view, grows them once, and leaves them grown', () => {
    const view = watchable();
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    expect(card(container)).toHaveAttribute('data-grow', 'wait');
    view(0.1);
    expect(card(container)).toHaveAttribute('data-grow', 'wait');
    view(0.5);
    expect(card(container)).toHaveAttribute('data-grow', 'go');
    view(0);
    view(0.5);
    expect(card(container)).toHaveAttribute('data-grow', 'go');
  });
});

describe('metadata', () => {
  it.each(LOCALES)('%s: title and description fit in a search result', (locale) => {
    const meta = landingMetadata(locale);
    expect((meta.title as string).length).toBeLessThan(60);
    expect(meta.description?.length).toBeLessThan(180);
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

  it('never uses the words DESIGN.md bans', () => {
    const text = words([en, ms]).toLowerCase();
    for (const word of ['seamless', 'revolutioni', 'empower', 'leverage', 'unlock', 'game-chang', 'cutting-edge', 'supercharge', 'effortless', 'elevate', 'next-level', 'harness', 'all-in-one', 'in seconds', '10x']) {
      expect(text).not.toContain(word);
    }
  });

  it('has no em dashes anywhere a visitor reads', () => {
    expect(words([en, ms])).not.toMatch(/—/);
    render(<LandingPage locale="en" terms={TERMS} />);
    render(<LandingPage locale="ms" terms={TERMS} />);
    expect(document.body.textContent).not.toMatch(/—/);
  });

  it('never claims Instagram import, which does not exist', () => {
    // apps/workers/src/sources/instagram.adapter.ts throws NOT_CONFIGURED.
    for (const copy of [en, ms]) {
      const text = words(copy).toLowerCase();
      expect(text).toMatch(/instagram/);
      expect(text).not.toMatch(/(paste|import|connect) (your )?instagram/);
    }
  });

  it('carries no slice 18 markers: checkout, QR payment and Orders are built', () => {
    for (const file of ['copy.ts', 'lands-script.ts', 'Lands.tsx']) {
      expect(readFileSync(join(import.meta.dirname, file), 'utf8')).not.toMatch(/SLICE 18/);
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

describe('less template', () => {
  const css = readFileSync(join(import.meta.dirname, 'tanya.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it.each(LOCALES)('%s: no curved marquee between the sections', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    expect(container.querySelector('[class*="loop"]')).toBeNull();
    expect(container.querySelector('textPath[href^="#loop"]')).toBeNull();
    expect(COPY[locale]).not.toHaveProperty('loop');
    expect(css).not.toMatch(/\.loop\b/);
  });

  it.each(LOCALES)('%s: no label above the hero headline', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    const hero = container.querySelector('section')!;
    expect(hero.querySelector('[class*="eyebrow"]')).toBeNull();
    expect(COPY[locale].hero).not.toHaveProperty('eyebrow');
    expect(hero.querySelector('h1')!.previousElementSibling).toBeNull();
  });

  it.each(LOCALES)('%s: no gradient blobs or grain in the hero and the closing section', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    expect(container.querySelector('[class*="blob"], [class*="grain"], feTurbulence')).toBeNull();
    expect(css).not.toMatch(/\.blobs?\b|\.grain\b|\.b[1-4]\b|@keyframes bl[1-4]/);
  });

  it('says the Business card is paid by FPX, e-wallet, card or the owner’s own QR', () => {
    expect(en.pricing.business.points).toContain('A shop paid by FPX, e-wallet, card or your own QR');
    expect(en.pricing.business.points).not.toContain('A shop with QR payment and payment proof');
    expect(ms.pricing.business.points).toContain('Kedai yang dibayar melalui FPX, e-dompet, kad atau QR anda sendiri');
    expect(ms.pricing.business.points).not.toContain('Kedai dengan bayaran QR dan bukti bayaran');
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(join(import.meta.dirname, 'tanya.module.css'), 'utf8');

  it('runs every looping animation only for visitors who have not asked for less motion', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');
    // One-shot transitions are fine anywhere; an `infinite` animation is not.
    expect(outside).not.toMatch(/animation:[^;]*infinite/);
  });
});
