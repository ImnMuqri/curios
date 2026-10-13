import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LandingPage, landingMetadata } from './LandingPage.js';
import { COPY, en, ms } from './copy.js';
import { DEMO_EN, DEMO_MS } from './demo.js';
import { BRAND } from './brand-colors.js';
import { LeadsStory } from './LeadsStory.js';
import { BusinessPrice } from './BusinessPrice.js';
import { ClaimField } from './ClaimField.js';
import { HeroDemo } from './HeroDemo.js';
import { askedAt } from './StormStage.js';

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

  it('sends section links through scrollToSection, so the smooth scroll lands on them', async () => {
    const smooth = await import('./SmoothScroll.js');
    const spy = vi.spyOn(smooth, 'scrollToSection').mockImplementation(() => {});
    render(<LandingPage locale="en" />);
    // fireEvent returns false when the click's default (a jump) was prevented.
    const proceeded = fireEvent.click(screen.getAllByRole('link', { name: 'Pricing' })[0]!);
    expect(proceeded).toBe(false);
    expect(spy).toHaveBeenCalledWith('#pricing');
    spy.mockRestore();
  });

  it('leaves new-tab clicks on a section link to the browser', async () => {
    const smooth = await import('./SmoothScroll.js');
    const spy = vi.spyOn(smooth, 'scrollToSection').mockImplementation(() => {});
    render(<LandingPage locale="en" />);
    const proceeded = fireEvent.click(screen.getAllByRole('link', { name: 'Pricing' })[0]!, { ctrlKey: true });
    expect(proceeded).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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

  it('has the new sections in both languages, with the counts the layout expects', () => {
    for (const copy of [en, ms]) {
      expect(copy.how.steps).toHaveLength(3);
      expect(copy.quiet.tiles).toHaveLength(3);
      expect(copy.shopSection.points).toHaveLength(3);
      expect(copy.heroScene.problem.length).toBeGreaterThan(0);
      expect(copy.paid.closing).toMatch(/RM39/);
    }
  });

  it('sells the shop only as it exists today: a basket sent to WhatsApp, nothing about paying', () => {
    for (const copy of [en, ms]) {
      const text = JSON.stringify(copy.shopSection);
      expect(text).toMatch(/WhatsApp/);
      expect(text).not.toMatch(/DuitNow|FPX|receipt|resit/i);
    }
  });

  it('gives the demo shop the three items the spec lists, priced in sen', () => {
    for (const demo of [DEMO_EN, DEMO_MS]) {
      expect(demo.items.map((i) => i.priceCents ?? i.options.map((o) => o.priceCents))).toEqual([[9500, 17000], 2500, 3850]);
    }
  });

  it('names the shop tile exactly as the shop does', () => {
    const shopTile = { en: 'Visit shop', ms: 'Lawati kedai' };
    for (const copy of [en, ms]) {
      expect(JSON.stringify(copy.faq)).toContain(shopTile[copy.locale]);
    }
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
    for (const shop of [DEMO_EN, DEMO_MS]) {
      expect(shop.storm).toHaveLength(40);
      expect(new Set(shop.storm).size).toBe(40);
    }
    expect(en.storm.body).toMatch(/forty/);
    expect(ms.storm.body).toMatch(/empat puluh/);
  });

  it('counts nobody until the messages fly in, then all forty, and never goes backwards', () => {
    expect(askedAt(0, 40)).toBe(0);
    expect(askedAt(0.45, 40)).toBe(0);
    expect(askedAt(0.8, 40)).toBe(40);
    expect(askedAt(1, 40)).toBe(40);
    const along = [0.5, 0.55, 0.6, 0.65, 0.7, 0.74].map((p) => askedAt(p, 40));
    expect(along).toEqual([...along].sort((a, b) => a - b));
    expect(along[2]).toBeGreaterThan(0);
    expect(along[2]).toBeLessThan(40);
  });

  // The finished scene, as the server renders it -- what a visitor without JavaScript, or with
  // reduced motion, sees. Scrolling counts up to it from nought.
  it('ends on one question, asked forty times, with the same answer the hero demo gives', () => {
    const html = renderToStaticMarkup(<LandingPage locale="en" />);
    expect(html).toContain(DEMO_EN.qa[0]!.a);
    expect(html).toContain('asked 40×');
  });
});

describe('the leads story', () => {
  it('jumps to any step, and shows the email only once the lead has been sent', async () => {
    render(<LeadsStory copy={en.leads} shop={DEMO_EN} />);
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
      render(<LeadsStory copy={en.leads} shop={DEMO_EN} />);
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

  it.each(LOCALES)('%s: How it works is three numbered steps, each with its snippet', (locale) => {
    const copy = COPY[locale];
    const { container } = render(<LandingPage locale={locale} />);
    const how = container.querySelector('#how')!;
    expect(container.querySelectorAll('#how')).toHaveLength(1);
    const steps = [...how.querySelectorAll('ol > li')];
    expect(steps).toHaveLength(3);
    steps.forEach((li, i) => expect(li).toHaveTextContent(copy.how.steps[i]!.title));
    expect(how.querySelectorAll('[data-snippet]')).toHaveLength(3);
    // The middle snippet: the first fact is ticked, the other two are not.
    const marks = [...how.querySelectorAll('li[data-ticked]')].map((li) => li.getAttribute('data-ticked'));
    expect(marks).toEqual(['yes', 'no', 'no']);
    // The last snippet is the shop's address, built from the demo's handle.
    expect(steps[2]!.querySelector('[data-snippet]')).toHaveTextContent(`curios.my/${copy.shop.page.handle}`);
  });

  it('shows the address being typed on the demo page beside it', async () => {
    render(
      <>
        <ClaimField id="claim-test" label="Address" placeholder="yourshop" button="Create" />
        <HeroDemo label="Demo" hint="Tap" shop={DEMO_EN} />
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

describe('the hero demo', () => {
  // Like the public page: tapping the input opens chat mode, which folds the
  // bio and the tiles away (Bento.module.css keys on data-mode), and the back
  // arrow returns to the page.
  it('opens chat mode when a question is sent, and the back arrow closes it', async () => {
    const { container } = render(<HeroDemo label="Demo" hint="Tap" shop={DEMO_EN} />);
    const page = container.querySelector('[data-bento-page]')!;
    expect(page).not.toHaveAttribute('data-mode');
    expect(screen.queryByRole('button', { name: 'Back to links' })).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Ask:/ })));
    expect(page).toHaveAttribute('data-mode', 'chat');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back to links' })));
    expect(page).not.toHaveAttribute('data-mode');
  });
});

describe("the demo shop speaks the page's language", () => {
  // English on /, Malay on /ms: the question, the answer, the bio and the storm all follow.
  it('is English on the English page and Malay on the Malay one', () => {
    const english = renderToStaticMarkup(<LandingPage locale="en" />);
    expect(english).toContain(DEMO_EN.qa[0]!.q);
    expect(english).toContain(DEMO_EN.page.bio!);
    expect(english).not.toContain(DEMO_MS.qa[0]!.q);
    expect(english).not.toContain(DEMO_MS.page.bio!);

    const malay = renderToStaticMarkup(<LandingPage locale="ms" />);
    expect(malay).toContain(DEMO_MS.qa[0]!.q);
    expect(malay).not.toContain(DEMO_EN.qa[0]!.q);
  });
});

describe('the hero', () => {
  it.each(LOCALES)('%s: reads as three captions in order, with the claim field in the first', (locale) => {
    const copy = COPY[locale];
    const { container } = render(<LandingPage locale={locale} />);
    const hero = container.querySelector('#hero')!;
    const text = hero.textContent;
    expect(text.indexOf(copy.hero.title)).toBeLessThan(text.indexOf(copy.heroScene.problem));
    expect(text.indexOf(copy.heroScene.problem)).toBeLessThan(text.indexOf(copy.heroScene.fix));
    expect(hero.querySelector('form[action="/signup"]')).not.toBeNull();
  });

  it('shows the finished phone without motion: one question, asked forty times, answered, and the shop tile', () => {
    const { container } = render(<LandingPage locale="en" />);
    const hero = container.querySelector('#hero')!;
    expect(hero).toHaveTextContent(en.storm.asked(40));
    expect(hero).toHaveTextContent(DEMO_EN.qa[0]!.a);
    expect(hero.querySelector('[data-shop]')).not.toBeNull();
    expect(hero.querySelector('[data-motion="on"]')).toBeNull();
  });

  it('draws twelve of the forty wordings round the phone, in the page language', () => {
    const { container } = render(<LandingPage locale="ms" />);
    const bubbles = [...container.querySelectorAll('#hero [data-bubble]')].map((b) => b.textContent);
    expect(bubbles).toHaveLength(12);
    expect(bubbles).toEqual(DEMO_MS.storm.slice(0, 12));
  });

  // jsdom does not evaluate CSS modules, so the stylesheet's rule is read as text: with motion, a
  // caption that is not showing must be visibility:hidden (out of the tab order), not just faded.
  it('takes hidden captions out of the tab order, not just out of sight', () => {
    const css = readFileSync(join(import.meta.dirname, 'hero.module.css'), 'utf8');
    const hidden = css.match(/\.stage\[data-motion='on'\] \.caption \{[^}]*\}/)![0];
    expect(hidden).toMatch(/visibility:\s*hidden/);
    expect(hidden).toMatch(/visibility 0s linear 0\.4s/);
    const shown = css.match(/\.caption\[data-caption='2'\] \{[^}]*\}/)![0];
    expect(shown).toMatch(/visibility:\s*visible/);
  });

  it('hides the text-only captions by fading, so a screen reader still reads them', () => {
    const css = readFileSync(join(import.meta.dirname, 'hero.module.css'), 'utf8');
    const textOnly = css.match(/\.caption:not\(\[data-caption='0'\]\) \{[^}]*\}/)![0];
    expect(textOnly).toMatch(/visibility:\s*visible/);
    expect(textOnly).not.toMatch(/clip-path|display:\s*none|transition:\s*none/);
    // The base rule they inherit fades them out, and caption 0 alone leaves the tab order.
    const base = css.match(/\.stage\[data-motion='on'\] \.caption \{[^}]*\}/)![0];
    expect(base).toMatch(/opacity:\s*0/);
    expect(base).toMatch(/transition:[^;]*opacity 0\.4s/);
    expect(css).not.toMatch(/clip-path/);
  });
});

describe('the paid moment', () => {
  it.each(LOCALES)('%s: lists all five steps in order, then the closing line', (locale) => {
    const copy = COPY[locale];
    const { container } = render(<LandingPage locale={locale} />);
    const paid = container.querySelector('#paid')!;
    const steps = [...paid.querySelectorAll('ol > li')].map((li) => li.textContent);
    expect(steps).toHaveLength(5);
    copy.leads.steps.forEach((s, i) => expect(steps[i]).toContain(s.title));
    expect(paid).toHaveTextContent(copy.paid.closing);
  });

  it('shows the last step without motion: the email and the WhatsApp reply', () => {
    const { container } = render(<LandingPage locale="en" />);
    const paid = container.querySelector('#paid')!;
    const stage = paid.querySelector('[data-paid-stage]')!;
    expect(stage.getAttribute('data-step')).toBe('5');
    expect(stage.hasAttribute('data-motion')).toBe(false);
    const reply = within(paid as HTMLElement).getByText(DEMO_EN.lead.reply);
    expect(reply.closest('[data-shown]')).toHaveAttribute('data-shown', 'yes');
  });

  // jsdom does not evaluate CSS modules, so the stylesheet is read as text.
  it('keeps hidden panels readable, and moves the track with the step', () => {
    const css = readFileSync(join(import.meta.dirname, 'paid.module.css'), 'utf8');
    const hidden = css.match(/\.stage\[data-motion='on'\] \.panel \{[^}]*clip-path[^}]*\}/)![0];
    expect(hidden).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(css).not.toMatch(/\.panel \{\s*display:\s*none/);
    expect(css).toMatch(/\[data-step='5'\] \.track \{\s*transform: translateX\(-80%\)/);
    expect(css).not.toMatch(/translateX\(calc\(var\(--p\)/);
  });
});

describe('the shop section', () => {
  // Review Focus 5.
  it('runs the real shelf as a demo that never leaves the page', async () => {
    render(<LandingPage locale="en" />);
    const shop = document.querySelector('#shop') as HTMLElement;
    await userEvent.click(within(shop).getByRole('button', { name: /Cookies balang/ }));
    await userEvent.click(within(shop).getByRole('button', { name: /add to basket/i }));
    expect(shop.querySelector('a[href^="https://wa.me"]')).toBeNull();
    await userEvent.click(within(shop).getByRole('button', { name: en.shopSection.orderButton }));
    const panel = within(shop).getByRole('region', { name: en.shopSection.messageTitle });
    expect(panel).toHaveTextContent('Cookies balang');
    expect(document.activeElement).toBe(panel);
  });
});

describe('trust, quiet parts, pricing, FAQ and closing', () => {
  it.each(LOCALES)('%s: the quiet parts are three tiles', (locale) => {
    const { container } = render(<LandingPage locale={locale} />);
    expect(container.querySelectorAll('#quiet li')).toHaveLength(3);
  });

  it.each(LOCALES)('%s: the Business plan includes the shop, and the FAQ answers selling', (locale) => {
    const copy = COPY[locale];
    const { container } = render(<LandingPage locale={locale} />);
    expect(container.querySelector('#pricing')).toHaveTextContent(copy.pricing.business.points[2]!);
    expect(container.querySelector('#faq')).toHaveTextContent(copy.faq.items.find((i) => /sell|jual/i.test(i.q))!.q);
  });

  it('closes on the ink band', () => {
    const { container } = render(<LandingPage locale="en" />);
    expect(container.querySelector('#final-title')!.closest('[class*="bandInk"]')).not.toBeNull();
  });
});
