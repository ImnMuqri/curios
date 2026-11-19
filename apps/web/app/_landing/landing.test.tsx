import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { defaultSettings } from '@curios/core/settings';
import { LandingPage, landingMetadata } from './LandingPage.js';
import { COPY, landingCopy } from './copy.js';
import { BRAND } from './brand-colors.js';

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
    // The closing reads its first word, with nothing held for a reveal.
    expect(screen.getByRole('heading', { name: 'One page for freelancers' })).toBeInTheDocument();
    expect(container.querySelector('[data-rv="wait"]')).toBeNull();
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
  const css = readdirSync(import.meta.dirname)
    .filter((f) => f.endsWith('.module.css'))
    .map((f) => readFileSync(join(import.meta.dirname, f), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it.each(LOCALES)('%s: no curved marquee between the sections', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    expect(container.querySelector('[class*="loop"]')).toBeNull();
    expect(container.querySelector('textPath[href^="#loop"]')).toBeNull();
    expect(COPY[locale]).not.toHaveProperty('loop');
    expect(css).not.toMatch(/\.loop\b/);
  });

  // The 23 Oct pass dropped the hero's label; the 19 Nov board brings one back, so the first screen
  // names what Curios is. One plain label, nothing more.
  it.each(LOCALES)('%s: one label above the hero headline, naming what Curios is', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    const hero = container.querySelector('section')!;
    const h1 = hero.querySelector('h1')!;
    expect(h1.previousElementSibling).toHaveTextContent(COPY[locale].hero.eyebrow);
    expect(h1.previousElementSibling!.previousElementSibling).toBeNull();
  });

  it.each(LOCALES)('%s: only the hero keeps the two-sentence "X. Y." headline', (locale) => {
    render(<LandingPage locale={locale} terms={TERMS} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/\.\s*\S.*\./);
    // The ask strip's one sentence ends in a full stop; no section heading has a second sentence.
    for (const h2 of screen.getAllByRole('heading', { level: 2 })) expect(h2.textContent, h2.textContent!).not.toMatch(/[.!?]\s*\S/);
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

describe('the old landing, gone', () => {
  it('no landing module imports tanya.module.css', () => {
    const files = readdirSync(import.meta.dirname).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.tsx'));
    for (const f of files) expect(readFileSync(join(import.meta.dirname, f), 'utf8'), f).not.toMatch(/tanya\.module\.css/);
    expect(existsSync(join(import.meta.dirname, 'tanya.module.css'))).toBe(false);
  });

  it('landing-tokens.css declares only tokens something reads', () => {
    const app = join(import.meta.dirname, '..');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : /\.(css|tsx?)$/.test(d.name) && !d.name.endsWith('.test.tsx') && d.name !== 'landing-tokens.css' ? [join(dir, d.name)] : [],
      );
    const source = walk(app).map((f) => readFileSync(f, 'utf8')).join('\n');
    const own = readFileSync(join(import.meta.dirname, 'landing-tokens.css'), 'utf8');
    const declared = [...own.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!);
    const unread = declared.filter((t) => !source.includes(`var(${t}`) && !own.includes(`var(${t}`));
    expect(unread).toEqual([]);
  });
});

describe('the Malay landing', () => {
  /** Every string in a copy object with its path, functions called with sample arguments. */
  function strings(value: unknown, path = ''): [string, string][] {
    if (typeof value === 'string') return [[path, value]];
    if (typeof value === 'function') return strings((value as (...a: unknown[]) => unknown)('Kek Lina', 2, 3), path);
    if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}.${i}`));
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
    return [];
  }
  /** Lines a visitor or a page types, which are Malay or mixed on both landings, as on the board. */
  const SPOKEN = [/^lands\.(service|products)\.(chat|asked)\./, /^who\.answers\.\w+\.3$/, /^who\.questions\.3$/, /^personas\./];

  it('carries no English sentence on /ms outside the chat lines and brand words', () => {
    // The walk reaches every section, and the check bites: the English copy fails it.
    expect(strings(ms).length).toBeGreaterThan(300);
    expect(strings(en).filter(([p, t]) => !SPOKEN.some((re) => re.test(p)) && /\b(the|your|and|with|you)\b/i.test(t)).length).toBeGreaterThan(20);
    const english = strings(ms)
      .filter(([path]) => !SPOKEN.some((re) => re.test(path)))
      .filter(([, text]) => /\b(the|your|and|with|you)\b/i.test(text));
    expect(english).toEqual([]);
  });

  it('every new Malay heading matches the appendix', () => {
    expect(ms.who.title).toEqual(['Satu soalan, ', 'lima jawapan berbeza', '']);
    expect(ms.how.title).toBe('Sepuluh minit dari kosong ke link bio');
    expect(ms.how.steps.map((s) => s.title)).toEqual(['Beritahu tentang anda', 'Luluskan yang betul', 'Letak link dalam bio']);
    expect([ms.lands.title, ms.lands.lede]).toEqual(['Apa yang anda dapat', 'Satu chat di halaman anda. Empat perkara yang anda boleh guna.']);
    expect([ms.noCut.title, ms.noCut.sub]).toEqual(['Setiap jualan milik anda', 'Kek RM100 yang sama, dijual dua cara. Baca resitnya.']);
    expect(ms.pricing.title).toEqual(['Percuma untuk anda,', 'RM49 sebulan untuk bisnes']);
    expect(ms.faq.title).toEqual(['Sebelum', 'anda mula']);
    expect(ms.hero.eyebrow).toBe('Link bio, untuk Malaysia');
    expect(ms.noCut.incl.map((i) => i.kicker)).toEqual(['Laman web anda', 'Bayaran anda', 'Listing Google anda']);
    expect(ms.closing.label).toBe('Tanya je.');
  });
});
