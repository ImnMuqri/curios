import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { How } from './How.js';
import { COPY } from './copy.js';
import { LOCALES, advance, read, reduceMotion, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const cards = () => screen.getAllByRole('listitem');
const pastedLength = COPY.en.how.pastedText.map((s) => (typeof s === 'string' ? s : s.text)).join('').length;

describe('how it works', () => {
  it.each(LOCALES)('%s: three cards with the board’s titles and bodies', (locale) => {
    const copy = COPY[locale].how;
    render(<How locale={locale} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(copy.title);
    expect(cards()).toHaveLength(3);
    copy.steps.forEach((step, i) => {
      expect(within(cards()[i]!).getByRole('heading', { level: 3 })).toHaveTextContent(step.title);
      expect(cards()[i]).toHaveTextContent(step.body);
      expect(step.title).not.toMatch(/\.$/);
    });
    expect(COPY.en.how.title).toBe('Ten minutes from blank to answering');
  });

  it('shows every card on its finished frame, with no timer, under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    watchViews().show(true);
    const { container } = render(<How locale="en" />);
    await advance(0);
    const copy = COPY.en.how;
    expect(container.querySelectorAll('mark[data-on]')).toHaveLength(4);
    expect(cards()[0]).toHaveTextContent(copy.found(4));
    expect(cards()[1]).toHaveTextContent(copy.allApproved.title);
    expect(cards()[1]).toHaveTextContent(copy.approved(4));
    expect(cards()[2]).toHaveTextContent(copy.chat.a);
    expect(cards()[2]).toHaveTextContent(copy.chat.time);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws the finished frames on the server', () => {
    const html = renderToString(<How locale="en" />);
    expect(html).toContain(COPY.en.how.allApproved.title);
    expect(html).toContain(COPY.en.how.chat.a);
  });

  it('starts a card only once it is in view', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<How locale="en" />);
    await advance(0);
    // Held at the start, nothing typed or marked, until in view.
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    await advance(5000);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    view.show(true);
    await advance(Math.ceil(pastedLength / 2) * 16 + 20);
    expect(container.querySelectorAll('mark')).toHaveLength(4);
  });

  it('marks the four facts in what was pasted, then says 4 facts found', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<How locale="en" />);
    view.show(true);
    const found = () => container.querySelector('[data-tone="1"] span[data-in]');
    await advance(Math.ceil(pastedLength / 2) * 16 + 500 + 10);
    expect(container.querySelectorAll('mark[data-on]')).toHaveLength(1);
    expect(found()).toBeNull();
    await advance(420 * 3);
    expect(container.querySelectorAll('mark[data-on]')).toHaveLength(4);
    await advance(420);
    expect(found()).toHaveTextContent('4 facts found');
  });

  it('approves the four facts one by one, then says all four approved', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    render(<How locale="en" />);
    view.show(true);
    const copy = COPY.en.how;
    await advance(10);
    expect(cards()[1]).toHaveTextContent(copy.approved(0));
    await advance(1300 + 170);
    expect(cards()[1]).toHaveTextContent(copy.approved(1));
    await advance((1300 + 170) * 3);
    expect(cards()[1]).toHaveTextContent(copy.approved(4));
    expect(cards()[1]).not.toHaveTextContent(copy.allApproved.title);
    await advance(500);
    expect(cards()[1]).toHaveTextContent(copy.allApproved.title);
  });

  it('taps the link in the bio and the page answers', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<How locale="en" />);
    view.show(true);
    const copy = COPY.en.how;
    const bio = container.querySelector('[data-tone="3"]')!;
    await advance(10);
    expect(bio.querySelector('[data-go]')).toBeNull();
    await advance(900 + 60 + 980 + 180 + 260);
    expect(bio.querySelector('[data-go]')).not.toBeNull();
    await advance(850 + 30 * copy.chat.q.length + 250 + 150 + 500 + 850 + 16 * copy.chat.a.length + 20);
    expect(bio).toHaveTextContent(copy.chat.a);
    expect(bio).toHaveTextContent(copy.chat.time);
  });

  it('has no 01/02/03 watermark or scroll rooms', () => {
    const { container } = render(<How locale="en" />);
    expect(container.innerHTML).not.toMatch(/room\d/);
    expect(read('how.module.css')).not.toMatch(/\.room/);
  });
});
