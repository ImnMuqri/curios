import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskStrip, ASK_WORD_MS } from './AskStrip.js';
import { COPY } from './copy.js';
import { LOCALES, advance, reduceMotion } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const lit = (c: HTMLElement) => [...c.querySelectorAll('h2 [data-on]')].map((e) => e.textContent);

describe('the ask strip', () => {
  it('lights one word at a time, every 1.7s', async () => {
    vi.useFakeTimers();
    expect(ASK_WORD_MS).toBe(1700);
    const { container } = render(<AskStrip locale="en" />);
    expect(lit(container)).toEqual(['rates,']);
    await advance(1699);
    expect(lit(container)).toEqual(['rates,']);
    await advance(1);
    expect(lit(container)).toEqual(['services,']);
  });

  it('lights only the first word, with no timer, under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    const { container } = render(<AskStrip locale="en" />);
    await advance(5000);
    expect(lit(container)).toEqual(['rates,']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(LOCALES)('%s: the heading reads the lead and the five words', (locale) => {
    const copy = COPY[locale].askStrip;
    render(<AskStrip locale={locale} />);
    const words = copy.words.map((w, i) => (i === copy.words.length - 1 ? `${w}.` : `${w},`));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(`${copy.lead} ${words.join(' ')}`);
    expect(screen.getByRole('region', { name: copy.eyebrow })).toBeInTheDocument();
  });
});
