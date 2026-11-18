import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { NoCut, keepAfter } from './NoCut.js';
import { COPY } from './copy.js';
import { LOCALES, advance, reduceMotion, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const keep = (c: HTMLElement, i: number) => c.querySelectorAll('[data-keep]')[i]!.textContent;

describe('no cut, ever', () => {
  it('works out what is kept after each fee, to the sen', () => {
    expect(keepAfter(100, [5, 4, 2.16])).toEqual([95, 91, 88.84]);
    expect(keepAfter(100, [1])).toEqual([99]);
  });

  it.each(LOCALES)('%s: two receipts, the marketplace keeping RM88.84 and Curios RM99.00', (locale) => {
    const copy = COPY[locale].noCut;
    const { container } = render(<NoCut locale={locale} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(copy.title);
    expect(container).toHaveTextContent(copy.market.title);
    expect(container).toHaveTextContent(copy.curios.title);
    expect(keep(container, 0)).toBe('RM88.84');
    expect(keep(container, 1)).toBe('RM99.00');
    expect(container).toHaveTextContent('0%');
    for (const f of copy.incl) expect(container).toHaveTextContent(f.title);
  });

  it('draws the finished receipts on the server', () => {
    const html = renderToString(<NoCut locale="en" />);
    expect(html).toContain('RM88.84');
    expect(html).toContain('RM99.00');
  });

  it('prints the receipts in turn and stamps 0%', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<NoCut locale="en" />);
    view.show(true);
    await advance(10);
    const [mk, cu] = [...container.querySelectorAll('[data-receipt]')];
    expect(mk).not.toHaveAttribute('data-in');
    expect(keep(container, 0)).toBe('RM100.00');
    await advance(500);
    expect(mk).toHaveAttribute('data-in');
    expect(cu).not.toHaveAttribute('data-in');
    await advance(900 + 3 * (250 + 380 + 250) + 50);
    expect(keep(container, 0)).toBe('RM88.84');
    expect(mk).toHaveAttribute('data-dim');
    await advance(500);
    expect(cu).toHaveAttribute('data-in');
    expect(container.querySelector('[data-stamp][data-in]')).toBeNull();
    await advance(900 + 700);
    expect(container.querySelector('[data-stamp][data-in]')).not.toBeNull();
    await advance(600 + 250 + 380 + 50);
    expect(keep(container, 1)).toBe('RM99.00');
  });

  it('no motion and no timer under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    watchViews().show(true);
    const { container } = render(<NoCut locale="en" />);
    await advance(0);
    expect(keep(container, 0)).toBe('RM88.84');
    expect(container.querySelector('[data-stamp][data-in]')).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the fine print keeps the fee assumptions', () => {
    for (const locale of LOCALES) {
      render(<NoCut locale={locale} />);
      expect(COPY[locale].noCut.fine).toMatch(/5%.*2–6%.*2\.16%.*1–2%/);
    }
    expect(screen.getAllByText(COPY.en.noCut.fine)).toHaveLength(1);
  });
});
