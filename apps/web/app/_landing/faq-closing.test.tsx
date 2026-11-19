import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { Faq } from './Faq.js';
import { Closing } from './Closing.js';
import { COPY, landingCopy } from './copy.js';
import { structuredData } from './structured-data.js';
import { LOCALES, TERMS, advance, read, reduceMotion, rule, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the FAQ', () => {
  it('opens the first answer, and one at a time', () => {
    const copy = COPY.en.faq;
    render(<Faq copy={copy} />);
    const qs = screen.getAllByRole('button');
    expect(qs).toHaveLength(copy.items.length);
    expect(qs.map((q) => q.getAttribute('aria-expanded'))).toEqual(copy.items.map((_, i) => String(i === 0)));
    fireEvent.click(qs[2]!);
    expect(qs.map((q) => q.getAttribute('aria-expanded'))).toEqual(copy.items.map((_, i) => String(i === 2)));
    fireEvent.click(qs[2]!);
    expect(qs.every((q) => q.getAttribute('aria-expanded') === 'false')).toBe(true);
  });

  it('renders every answer on the server for crawlers', () => {
    const html = renderToString(<Faq copy={COPY.en.faq} />);
    for (const item of COPY.en.faq.items) expect(html).toContain(item.a.replace(/’/g, '’'));
  });

  it('keeps FAQPage structured data equal to the questions shown', () => {
    const copy = landingCopy('en', TERMS);
    render(<Faq copy={copy.faq} />);
    const faq = structuredData(copy, 'https://curios.my', TERMS.prices)['@graph'].find((n) => n['@type'] === 'FAQPage') as { mainEntity: { name: string }[] };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(screen.getAllByRole('button').map((b) => b.textContent));
  });

  it.each([
    ['en', 'Before', 'you start'],
    ['ms', 'Sebelum', 'anda mula'],
  ] as const)('%s: the heading is the 19 Nov board’s two lines', (locale, a, b) => {
    const { container } = render(<Faq copy={COPY[locale].faq} />);
    const h2 = container.querySelector('h2')!;
    expect([...h2.childNodes].map((n) => (n.nodeName === 'BR' ? '|' : n.textContent))).toEqual([a, '|', b]);
  });

  it('splits the heading without a regex lookbehind, which Safari before 16.4 cannot parse', () => {
    expect(read('Faq.tsx')).not.toMatch(/\(\?<[=!]/);
  });

  it('hides a closed answer from screen readers once it has folded away', () => {
    const css = read('faq.module.css');
    expect(rule(css, '.a')).toMatch(/visibility:\s*hidden/);
    expect(rule(css, '.a')).toMatch(/visibility 0s[^;,]*0\.45s/);
    expect(rule(css, '.fq[data-open] .a')).toMatch(/visibility:\s*visible/);
  });
});

describe('the closing', () => {
  it.each(LOCALES)('%s: the closing reads Tanya je. and One page for, with the claim', (locale) => {
    const copy = COPY[locale].closing;
    const { container } = render(<Closing locale={locale} />);
    expect(copy.label).toBe('Tanya je.');
    expect(container).toHaveTextContent('Tanya je.');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(copy.onePageFor);
    expect(screen.getByRole('heading', { level: 2 })).toHaveAccessibleName(`${copy.onePageFor} ${copy.words[0]}`);
    expect(container.querySelector('form')).toHaveAttribute('action', '/signup');
    expect(container).toHaveTextContent(copy.note);
  });

  it('rolls the word every 2s while in view, and not under reduced motion', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Closing locale="en" />);
    const on = () => container.querySelector('[data-word]')!.getAttribute('data-word');
    expect(on()).toBe('0');
    await advance(2000);
    expect(on()).toBe('0');
    view.show(true);
    await advance(2000);
    expect(on()).toBe('1');
    await advance(2000);
    expect(on()).toBe('2');
    view.show(false);
    await advance(4000);
    expect(on()).toBe('2');
  });

  it('holds the first word under reduced motion, with no timer', async () => {
    vi.useFakeTimers();
    reduceMotion();
    watchViews().show(true);
    const { container } = render(<Closing locale="en" />);
    await advance(6000);
    expect(container.querySelector('[data-word]')!.getAttribute('data-word')).toBe('0');
    expect(vi.getTimerCount()).toBe(0);
  });
});
