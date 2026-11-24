import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { NoCut, keepAfter, lockFigures } from './NoCut.js';
import { COPY } from './copy.js';
import { LOCALES, advance, read, reduceMotion, rule, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const alerts = (c: HTMLElement) => [...c.querySelectorAll('[class*="ph"] [class*="list"] > div')];
const shown = (c: HTMLElement) => alerts(c).map((a) => a.hasAttribute('data-in'));
const amount = (c: HTMLElement, which: string) => c.querySelector(`[data-amount="${which}"]`)!.textContent;

describe('no cut, ever', () => {
  it('works out what is kept after each fee, to the sen', () => {
    expect(keepAfter(100, [5, 4, 2.16])).toEqual([95, 91, 88.84]);
    expect(keepAfter(100, [1])).toEqual([99]);
  });

  it('works the lock screen’s figures from the sample sale: RM88.84, RM99.00 and RM10.16 more', () => {
    expect(lockFigures(COPY.en.noCut.sample)).toEqual({ marketplace: 88.84, curios: 99, more: 10.16 });
  });

  it.each(LOCALES)('%s: a lock screen with the marketplace payout, the FPX payment and the difference', (locale) => {
    const copy = COPY[locale].noCut;
    const { container } = render(<NoCut locale={locale} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(copy.title);
    expect(container).toHaveTextContent(copy.sub);
    expect(container).toHaveTextContent('9:41');
    expect(container).toHaveTextContent(copy.lock.date);
    expect(container).toHaveTextContent(`${copy.lock.payout} RM88.84`);
    expect(container).toHaveTextContent(`${copy.lock.fpx} RM99.00`);
    expect(container).toHaveTextContent(copy.lock.more('RM10.16'));
    expect(alerts(container)).toHaveLength(3);
    for (const f of copy.incl) expect(container).toHaveTextContent(f.title);
    expect(COPY.en.noCut.incl.map((f) => f.kicker)).toEqual(['Your website', 'Your payments', 'Your Google listing']);
  });

  it('says it in the board’s words', () => {
    const copy = COPY.en.noCut;
    expect(copy.sub).toBe('The same RM100 cake, sold two ways. Here’s what reaches your bank.');
    expect(copy.lock.more('RM10.16')).toBe('RM10.16 more, and it came straight to you');
  });

  it('no receipts, stamp or fee rows are left', () => {
    const { container } = render(<NoCut locale="en" />);
    expect(container).not.toHaveTextContent('Platform fee');
    expect(container).not.toHaveTextContent('Curios commission');
    expect(container.querySelector('[data-receipt]')).toBeNull();
    expect(container.querySelector('[data-stamp]')).toBeNull();
  });

  it('draws all three alerts on the server', () => {
    const html = renderToString(<NoCut locale="en" />);
    expect(html).toContain('RM88.84');
    expect(html).toContain('RM99.00');
    expect(html).toContain('RM10.16 more, and it came straight to you');
    expect(html.match(/data-in=""/g)).toHaveLength(3);
  });

  it('drops the alerts in one by one: the payout, then the FPX payment, then the difference, and loops', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<NoCut locale="en" />);
    view.show(true);
    await advance(10);
    expect(shown(container)).toEqual([false, false, false]);
    await advance(900);
    expect(shown(container)).toEqual([true, false, false]);
    await advance(1600);
    expect(shown(container)).toEqual([true, true, false]);
    await advance(1200);
    expect(shown(container)).toEqual([true, true, true]);
    // It holds 9s, then clears and starts again.
    await advance(9000 + 10);
    expect(shown(container)).toEqual([false, false, false]);
    await advance(900);
    expect(shown(container)).toEqual([true, false, false]);
  });

  it('waits to start until the lock screen is in view, and clears when it leaves', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<NoCut locale="en" />);
    await advance(20000);
    expect(shown(container)).toEqual([false, false, false]);
    view.show(true);
    await advance(900 + 10);
    expect(shown(container)[0]).toBe(true);
    view.show(false);
    await advance(10);
    expect(shown(container)).toEqual([false, false, false]);
  });

  it('shows all three, with no timer, under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    watchViews().show(true);
    const { container } = render(<NoCut locale="en" />);
    await advance(0);
    expect(shown(container)).toEqual([true, true, true]);
    expect(amount(container, 'marketplace')).toBe('RM88.84');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lays the stage out as the board does', () => {
    const css = read('nocut.module.css');
    expect(rule(css, '.bk')).toMatch(/max-width:\s*1000px/);
    expect(rule(css, '.bk')).toMatch(/padding:\s*56px 24px 60px/);
    expect(rule(css, '.ph')).toMatch(/width:\s*360px/);
    expect(rule(css, '.t')).toMatch(/font-size:\s*64px/);
    expect(rule(css, '.list')).toMatch(/min-height:\s*236px/);
    expect(rule(css, '.pk')).toMatch(/left:\s*calc\(50% \+ 150px\)/);
    expect(rule(css, '.pk')).toMatch(/width:\s*104px/);
    expect(rule(css, '.n')).toMatch(/translateY\(-16px\) scale\(0\.97\)/);
    expect(rule(css, '.diff')).toMatch(/background:\s*var\(--pink-muda\)/);
  });

  it('the fine print keeps the fee assumptions', () => {
    for (const locale of LOCALES) {
      render(<NoCut locale={locale} />);
      expect(COPY[locale].noCut.fine).toMatch(/5%.*2–6%.*2\.16%.*1–2%/);
    }
    expect(screen.getAllByText(COPY.en.noCut.fine)).toHaveLength(1);
  });
});
