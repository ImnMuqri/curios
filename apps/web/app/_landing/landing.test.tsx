import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLAN_PRICES_CENTS } from '@curios/core';
import { LandingPage, landingMetadata } from './LandingPage.js';
import { COPY } from './copy.js';
import { BRAND } from './brand-colors.js';
import { scene } from './order-scene.js';
import { payback } from './Pricing.js';
import { howAt } from './How.js';

const LOCALES = ['en', 'ms'] as const;
const { en, ms } = COPY;

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
    const { container } = render(<LandingPage locale={locale} />);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(COPY[locale].hero.line);
    for (const id of ['who', 'how', 'business', 'pricing', 'faq']) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
      expect(container.querySelector(`a[href="#${id}"]`)).not.toBeNull();
    }
    expect(container.firstElementChild).toHaveAttribute('lang', locale);
  });

  it('reads the rolling name once, as the first page in the deck', () => {
    render(<LandingPage locale="en" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(/Ask\s+Aisyah\./);
  });

  it('claims an address with a plain GET to sign-up, so it works without JavaScript', () => {
    const { container } = render(<LandingPage locale="en" />);
    const forms = [...container.querySelectorAll('form')];
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form).toHaveAttribute('action', '/signup');
      expect(form).toHaveAttribute('method', 'get');
      expect(form.querySelector('input[name="handle"]')).not.toBeNull();
    }
    expect(screen.getAllByLabelText('The address you want for your page')).toHaveLength(2);
  });

  it('links the other language, sign in and sign up', () => {
    render(<LandingPage locale="ms" />);
    const nav = screen.getByRole('banner');
    expect(within(nav).getByRole('link', { name: 'English' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Log masuk' })).toHaveAttribute('href', '/signin');
    expect(within(nav).getByRole('link', { name: 'Buat halaman anda' })).toHaveAttribute('href', '/signup');
  });

  it('links the Terms, Privacy and Refund pages from the footer, in the page’s language', () => {
    const { unmount } = render(<LandingPage locale="en" />);
    let foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(foot).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(foot).getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/refunds');
    unmount();

    render(<LandingPage locale="ms" />);
    foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('link', { name: 'Terma' })).toHaveAttribute('href', '/ms/terms');
    expect(within(foot).getByRole('link', { name: 'Bayaran balik' })).toHaveAttribute('href', '/ms/refunds');
  });

  it('the footer wordmark carries the full-body Peek on its o', () => {
    const { container } = render(<LandingPage locale="en" />);
    const foot = screen.getByRole('contentinfo');
    const o = foot.querySelector('span[class*="mo"]') as HTMLElement;
    const peek = o.querySelector('span[class*="footPeek"]') as HTMLElement;
    expect(peek).not.toBeNull();
    expect(peek).toHaveAttribute('aria-hidden', 'true');
    // Standing on the o: Peek's svg sits inside the o's box, with a unique clip id.
    const clip = peek.querySelector('clipPath') as Element;
    expect(clip.id).not.toBe('');
    expect(peek.querySelector(`[clip-path="url(#${clip.id})"]`)).not.toBeNull();
    for (const part of ['FootL', 'FootR', 'HandL', 'ArmR', 'Eyes', 'Pupils']) {
      expect(peek.querySelector(`[class*="${part}"]`), part).not.toBeNull();
    }
    expect(container.querySelectorAll('clipPath').length).toBeGreaterThanOrEqual(1);
    // The footer's mark clips sideways only, so Peek's head isn't cut off.
    const css = readFileSync(join(__dirname, 'tanya.module.css'), 'utf8');
    const rule = css.match(/\.footMark \{[^}]*\}/)![0];
    expect(rule).not.toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/overflow-x:\s*clip/);
  });

  it('escapes "<" in structured data, so no copy can close the script tag', () => {
    const { container } = render(<LandingPage locale="en" />);
    expect(container.querySelector('script[type="application/ld+json"]')!.innerHTML).not.toContain('<');
  });

  it('prices the structured data from PLAN_PRICES_CENTS', () => {
    const { container } = render(<LandingPage locale="en" />);
    const data = container.querySelector('script[type="application/ld+json"]')!.innerHTML;
    expect(data).toContain(`"price":"${PLAN_PRICES_CENTS.MONTHLY / 100}"`);
    expect(data).toContain(`"price":"${PLAN_PRICES_CENTS.ANNUAL / 100}"`);
  });
});

describe('motion', () => {
  it('holds every scene on its finished frame when the visitor asks for less motion', () => {
    reduceMotion();
    const { container } = render(<LandingPage locale="en" />);
    // The hero's front page is answered, with no cursor and no caret.
    const hero = container.querySelector('section')!;
    expect(hero).toHaveTextContent(en.personas.aisyah.a);
    // The order has landed and been confirmed.
    expect(container.querySelector('#business')).toHaveTextContent(en.business.confirmed);
    // The closing line is up, not waiting to rise.
    expect(screen.getByRole('heading', { name: 'Curious? Just ask' })).toHaveAttribute('data-in');
  });

  it('types the answer out on the front page of the deck', async () => {
    vi.useFakeTimers();
    const { container } = render(<LandingPage locale="en" />);
    const hero = container.querySelector('section')!;
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(hero).toHaveTextContent(en.personas.aisyah.q);
    expect(hero).not.toHaveTextContent(en.personas.aisyah.a);
    await act(async () => {
      vi.advanceTimersByTime(26 * (en.personas.aisyah.a.length + 2));
    });
    expect(hero).toHaveTextContent(en.personas.aisyah.a);
  });

  it('moves the deck on when it is pressed', async () => {
    render(<LandingPage locale="en" />);
    const deck = screen.getByRole('button', { name: en.hero.next });
    await userEvent.click(deck);
    // Kek Lina's page is at the front now; the hero is on her question.
    await act(() => new Promise((r) => setTimeout(r, 2200)));
    expect(deck).toHaveTextContent(en.personas.lina.q);
  });
});

describe('who it is for', () => {
  it('shows the page of the kind of owner pointed at', () => {
    render(<LandingPage locale="en" />);
    const row = screen.getByRole('button', { name: /Job seekers/ });
    fireEvent.mouseEnter(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('figure', { name: 'Daniel Tan’s Curios page' })).toHaveTextContent(en.personas.daniel.a);
  });
});

describe('pricing', () => {
  it('switches Business between monthly and yearly, and says which is on', async () => {
    render(<LandingPage locale="en" />);
    const pricing = document.querySelector('#pricing') as HTMLElement;
    expect(within(pricing).getByText('RM49 a month')).toBeInTheDocument();
    await userEvent.click(within(pricing).getByRole('button', { name: /Yearly/ }));
    expect(within(pricing).getByRole('button', { name: /Yearly/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(pricing).getByText('RM490 a year')).toBeInTheDocument();
    expect(pricing).toHaveTextContent('RM40.83 a month, paid once a year.');
  });

  it('works out the calculator from the real monthly price', () => {
    expect(en.pricing.monthlyRinggit).toBe(PLAN_PRICES_CENTS.MONTHLY / 100);
    // Five orders of RM95: RM475, of which RM49 is about 10%, nine times over.
    expect(payback(5, 95, 49)).toMatchObject({ revenue: 475, pays: true, percent: 10, times: 9 });
    // One RM50 order does not cover it.
    expect(payback(1, 40, 49).pays).toBe(false);
  });
});

describe('the order, played out', () => {
  it('starts empty and ends confirmed, with the basket and the sheet in between', () => {
    expect(scene(0)).toMatchObject({ basketCount: 0, sheet: 0, view: 'form', confirmed: false });
    expect(scene(0.2)).toMatchObject({ basketCount: 3, basketTotal: 235, step: 0 });
    expect(scene(0.4)).toMatchObject({ view: 'form', step: 1 });
    expect(scene(0.4).sheet).toBe(100);
    expect(scene(0.6)).toMatchObject({ view: 'pay', uploaded: true, step: 2 });
    expect(scene(1)).toMatchObject({ confirmed: true, step: 4, success: 1 });
  });
});

describe('how it works, pinned', () => {
  it('holds each room, slides to the next, and marks the dot of the room in view', () => {
    expect(howAt(0)).toEqual({ at: 0, step: 0 });
    expect(howAt(0.1)).toEqual({ at: 0, step: 0 });
    expect(howAt(0.5)).toEqual({ at: 1, step: 1 });
    expect(howAt(1)).toEqual({ at: 2, step: 2 });
    // The dot only moves on once the next room is mostly in.
    expect(howAt(0.29).at).toBeGreaterThan(0.5);
    expect(howAt(0.29).step).toBe(0);
    expect(howAt(0.31).step).toBe(1);
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
    render(<LandingPage locale="en" />);
    render(<LandingPage locale="ms" />);
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
    for (const file of ['copy.ts', 'order-scene.ts', 'Business.tsx']) {
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

describe('the stylesheet', () => {
  const css = readFileSync(join(import.meta.dirname, 'tanya.module.css'), 'utf8');

  it('frosts the nav pill and nothing else (DESIGN.md allows that one surface)', () => {
    const frosted = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*backdrop-filter/g)].map((m) => m[1]!.trim());
    expect(frosted).toEqual(['.navpill']);
  });

  it('runs every looping animation only for visitors who have not asked for less motion', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');
    // One-shot transitions are fine anywhere; an `infinite` animation is not.
    expect(outside).not.toMatch(/animation:[^;]*infinite/);
  });
});
