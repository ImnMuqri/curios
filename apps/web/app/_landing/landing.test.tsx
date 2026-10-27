import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings } from '@curios/core/settings';
import { raisedSettings } from '@curios/core/test-settings';
import { LandingPage, landingMetadata } from './LandingPage.js';
import { COPY, landingCopy } from './copy.js';
import { structuredData } from './structured-data.js';
import { BRAND } from './brand-colors.js';
import { STEP_MS, STEP_STARTS, advance, scene, stepProgress } from './order-scene.js';
import { payback } from './Pricing.js';
import { howAt } from './How.js';

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

  it('reads the rolling name once, as the first page in the deck', () => {
    render(<LandingPage locale="en" terms={TERMS} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(/Ask\s+Aisyah\./);
  });

  it('claims an address with a plain GET to sign-up, so it works without JavaScript', () => {
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
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
    render(<LandingPage locale="ms" terms={TERMS} />);
    const nav = screen.getByRole('banner');
    expect(within(nav).getByRole('link', { name: 'English' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Log masuk' })).toHaveAttribute('href', '/signin');
    expect(within(nav).getByRole('link', { name: 'Buat halaman anda' })).toHaveAttribute('href', '/signup');
  });

  it('links the Terms, Privacy and Refund pages from the footer, in the page’s language', () => {
    const { unmount } = render(<LandingPage locale="en" terms={TERMS} />);
    let foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(foot).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(foot).getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/refunds');
    unmount();

    render(<LandingPage locale="ms" terms={TERMS} />);
    foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('link', { name: 'Terma' })).toHaveAttribute('href', '/ms/terms');
    expect(within(foot).getByRole('link', { name: 'Bayaran balik' })).toHaveAttribute('href', '/ms/refunds');
  });

  it('the footer wordmark carries the full-body Peek on its o', () => {
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
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
    // The order has landed and been confirmed.
    expect(container.querySelector('#business')).toHaveTextContent(en.business.done);
    // The closing line is up, not waiting to rise.
    expect(screen.getByRole('heading', { name: 'Curious? Just ask' })).toHaveAttribute('data-in');
  });

  it('types the answer out on the front page of the deck', async () => {
    vi.useFakeTimers();
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
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
    render(<LandingPage locale="en" terms={TERMS} />);
    const deck = screen.getByRole('button', { name: en.hero.next });
    await userEvent.click(deck);
    // Kek Lina's page is at the front now; the hero is on her question.
    await act(() => new Promise((r) => setTimeout(r, 2200)));
    expect(deck).toHaveTextContent(en.personas.lina.q);
  });
});

describe('who it is for', () => {
  it('shows the page of the kind of owner pointed at', () => {
    render(<LandingPage locale="en" terms={TERMS} />);
    const row = screen.getByRole('button', { name: /Job seekers/ });
    fireEvent.mouseEnter(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('figure', { name: 'Daniel Tan’s Curios page' })).toHaveTextContent(en.personas.daniel.a);
  });
});

describe('the floating chat', () => {
  it("the floating chat's reply is a white card with the label", () => {
    render(<LandingPage locale="en" terms={TERMS} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Job seekers/ }));
    const figure = screen.getByRole('figure', { name: 'Daniel Tan’s Curios page' });
    const reply = within(figure).getByText(en.personas.daniel.a, { exact: false });
    expect(reply).toHaveTextContent('Daniel Tan’s page');
    const css = readFileSync(join(import.meta.dirname, 'tanya.module.css'), 'utf8');
    expect(css).toMatch(/^\.floatA \{[^}]*background: var\(--card\)/m);
    expect(css).toMatch(/^\.pcA \{[^}]*padding: 0/m);
    expect(css).not.toMatch(/^\.pcA \{[^}]*background/m);
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

describe('the order, played out', () => {
  it('starts empty and ends completed, with the basket and the sheet in between', () => {
    expect(scene(0)).toMatchObject({ basketCount: 0, sheet: 0, view: 'form', completed: false });
    expect(scene(0.2)).toMatchObject({ basketCount: 2, basketTotal: 190, step: 0 });
    expect(scene(0.23)).toMatchObject({ basketCount: 3, basketTotal: 235, step: 0 });
    expect(scene(0.23).rows.map((r) => r.qty)).toEqual([2, 1, 0, 0]);
    expect(scene(0.4)).toMatchObject({ view: 'form', step: 1 });
    expect(scene(0.4).sheet).toBe(100);
    expect(scene(1)).toMatchObject({ completed: true, step: 4, success: 1 });
  });

  it('picks FPX, then Maybank2u, and pays through CHIP without a QR or a receipt', () => {
    expect(scene(0.52)).toMatchObject({ view: 'pay', wayPicked: false, bankPicked: false, chip: false });
    expect(scene(0.54)).toMatchObject({ wayPicked: true, bankPicked: false });
    expect(scene(0.55)).toMatchObject({ bankPicked: true, chip: false });
    expect(scene(0.6)).toMatchObject({ chip: true, approved: false });
    expect(scene(0.62)).toMatchObject({ chip: true, approved: true, step: 2 });
    expect(scene(0.7)).toMatchObject({ step: 3 });
    expect(scene(0.6)).not.toHaveProperty('receipt');
    expect(scene(0.6)).not.toHaveProperty('uploading');
  });

  it('lands in Orders already paid, then completed', () => {
    expect(scene(0.7)).toMatchObject({ today: 480, paidCount: 3, completed: false, card: { isNew: false } });
    expect(scene(0.85)).toMatchObject({ paidCount: 4, completed: false, card: { isNew: true } });
    expect(scene(0.88).today).toBe(715);
    expect(scene(0.95)).toMatchObject({ completed: true, paidCount: 3 });
  });

  it('gives each step its own duration', () => {
    expect(STEP_MS).toEqual([5800, 4600, 4800, 2600, 4000]);
    expect(STEP_STARTS).toEqual([0, 0.24, 0.5, 0.64, 0.76, 1]);
    expect(advance(0, 5800)).toBeCloseTo(0.24);
    expect(advance(0.24, 4600)).toBeCloseTo(0.5);
    expect(advance(0.64, 2600)).toBeCloseTo(0.76);
    expect(stepProgress(0.37, 1)).toBeCloseTo(50);
    expect(stepProgress(0.1, 3)).toBe(0);
  });
});

describe('the order, from the link in bio', () => {
  it('starts on Kek Lina’s link in bio, with nothing in the basket', () => {
    expect(scene(0)).toMatchObject({ lib: { x: 0, pressed: false }, basketCount: 0, step: 0 });
    // The cursor comes up from below to the Shop link, the first link.
    expect(scene(0).cursor).toMatchObject({ x: 200, y: 470, o: 0 });
    expect(scene(0.04).cursor).toMatchObject({ x: 128, y: 268, o: 1, pressed: false });
  });

  it('taps the Shop link, the page slides away and the shop opens', () => {
    expect(scene(0.05)).toMatchObject({ lib: { x: 0, pressed: true } });
    expect(scene(0.05).cursor.pressed).toBe(true);
    expect(scene(0.058).lib.pressed).toBe(false);
    expect(scene(0.0725).lib.x).toBeLessThan(0);
    expect(scene(0.0725).lib.x).toBeGreaterThan(-100);
    expect(scene(0.085).lib.x).toBe(-100);
    expect(scene(0.5).lib.x).toBe(-100);
    expect(scene(1).lib.x).toBe(-100);
  });

  it('shows the shop untouched until the link has been tapped, then plays the old first step', () => {
    expect(scene(0.085)).toMatchObject({ basketCount: 0, sheet: 0, step: 0 });
    expect(scene(0.085).cursor).toMatchObject({ x: 128, y: 268 });
    // The tap on the first cake lands once the shop is open: 0.09 of the old film.
    expect(scene(0.085 + 0.155 * (0.095 / 0.24)).rows[0]!.qty).toBe(1);
    expect(scene(0.24)).toMatchObject({ step: 1, basketCount: 3 });
  });

  it('draws the link in bio as the board does, the Shop link first', async () => {
    reduceMotion();
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    const biz = container.querySelector('#business') as HTMLElement;
    await userEvent.click(within(biz).getByRole('button', { name: new RegExp(en.business.caps[0]!.title) }));
    const lib = biz.querySelector('[class*="csLib"]') as HTMLElement;
    expect(lib).not.toBeNull();
    expect(lib.style.transform).toBe('translateX(0%)');
    expect(lib).toHaveTextContent('curios.my/keklina');
    expect(lib).toHaveTextContent('Kek Lina');
    expect(lib).toHaveTextContent(en.business.lib.bio);
    expect(lib).toHaveTextContent(en.hero.linksTab);
    expect(lib).toHaveTextContent(en.hero.askTab);
    const links = [...lib.querySelectorAll('[class*="lbShop"], [class*="lbL"]')].map((l) => l.textContent);
    expect(links[0]).toContain(en.business.lib.shop);
    expect(links[0]).toContain(en.business.lib.shopSub);
    expect(links.slice(1)).toEqual(en.business.lib.links);
    // Three overlapping thumbnails on the Shop link.
    expect(lib.querySelectorAll('[class*="lbTh"] > i')).toHaveLength(3);
    expect(lib).toHaveTextContent(en.business.lib.foot);
    // The stage says it starts there, for assistive tech.
    expect(biz.querySelector('[role="img"]')).toHaveAccessibleName(/link in bio/);
    expect(ms.business.lib.shop).not.toBe('');
  });
});

describe('For business, the steps', () => {
  const business = (c: HTMLElement) => c.querySelector('#business') as HTMLElement;

  it('a step can be clicked to jump to it', async () => {
    reduceMotion();
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    expect(business(container)).toHaveTextContent(en.business.done);
    await userEvent.click(within(business(container)).getByRole('button', { name: new RegExp(en.business.caps[2]!.title) }));
    expect(business(container).querySelector('[data-state="now"]')).toHaveTextContent(en.business.caps[2]!.title);
    expect(business(container)).toHaveTextContent(en.business.howPay);
    await userEvent.click(within(business(container)).getByRole('button', { name: new RegExp(en.business.caps[1]!.title) }));
    expect(business(container)).toHaveTextContent(en.business.continueToPay);
    expect(business(container)).not.toHaveTextContent(en.business.howPay);
    await userEvent.click(within(business(container)).getByRole('button', { name: new RegExp(en.business.caps[0]!.title) }));
    expect(business(container)).toHaveTextContent(en.business.basketEmpty);
  });

  it('each step has its own duration and a progress line', async () => {
    reduceMotion();
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    await userEvent.click(within(business(container)).getByRole('button', { name: new RegExp(en.business.caps[1]!.title) }));
    const bar = business(container).querySelector('[data-state="now"] [data-bar] i') as HTMLElement;
    expect(parseFloat(bar.style.width)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(bar.style.width)).toBeLessThan(1);
    expect(business(container).querySelectorAll('[data-bar]')).toHaveLength(5);
  });

  it('hovering the phones pauses', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
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
    const { container } = render(<LandingPage locale="en" terms={TERMS} />);
    act(() => watchers.forEach((w) => w([{ intersectionRatio: 0.5 } as IntersectionObserverEntry], {} as IntersectionObserver)));
    const bar = () => parseFloat((business(container).querySelector('[data-state="now"] [data-bar] i') as HTMLElement).style.width);
    const tick = (now: number) => act(() => frames.splice(0).forEach((f) => f(now)));
    tick(1000);
    tick(1050);
    tick(1100);
    const before = bar();
    expect(before).toBeGreaterThan(0);
    const phones = business(container).querySelectorAll('[data-phone]');
    expect(phones).toHaveLength(2);
    fireEvent.mouseEnter(phones[0]!);
    tick(1150);
    tick(1200);
    expect(bar()).toBe(before);
    fireEvent.mouseLeave(phones[0]!);
    tick(1250);
    tick(1300);
    expect(bar()).toBeGreaterThan(before);
    vi.unstubAllGlobals();
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

describe('less template', () => {
  const css = readFileSync(join(import.meta.dirname, 'tanya.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.[\]]/g, (c) => `\\${c}`);
    return css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  it.each(LOCALES)('%s: no 01/02/03 watermark numbers in How it works', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    expect(container.querySelector('[class*="roomN"]')).toBeNull();
    expect(css).not.toMatch(/roomN/);
  });

  it.each(LOCALES)('%s: no curved marquee between the sections', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    expect(container.querySelector('[class*="loop"]')).toBeNull();
    expect(container.querySelector('textPath[href^="#loop"]')).toBeNull();
    expect(COPY[locale]).not.toHaveProperty('loop');
    expect(css).not.toMatch(/\.loop\b/);
  });

  it('has no blur-in, scroll-reveal or blur on the rotating words', () => {
    expect(css).not.toMatch(/reveal/);
    expect(css).not.toMatch(/filter:\s*blur\(3px\)/);
    expect(rule('.focusWord')).not.toMatch(/filter/);
    expect(rule('.focusWord')).not.toMatch(/transition:[^;]*filter/);
    expect(rule('.focusWord[data-on]')).not.toMatch(/filter/);
  });

  it('sets section labels in plain sentence case, Inter 15px semibold', () => {
    const eyebrow = rule('.eyebrow');
    expect(eyebrow).toMatch(/font-family:\s*var\(--font-inter\)/);
    expect(eyebrow).toMatch(/font-size:\s*15px/);
    expect(eyebrow).toMatch(/font-weight:\s*600/);
    expect(eyebrow).not.toMatch(/text-transform|letter-spacing|var\(--m\)/);
    for (const copy of [en, ms]) {
      for (const label of [copy.who.eyebrow, copy.how.eyebrow, copy.business.eyebrow, copy.pricing.eyebrow]) {
        expect(label).not.toBe(label.toUpperCase());
      }
    }
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
