import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { Lands } from './Lands.js';
import { COPY } from './copy.js';
import { nextSide, TIMING } from './lands-script.js';
import { LOCALES, advance, read, reduceMotion, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const zoneIn = (c: HTMLElement) => [0, 1, 2, 3].map((i) => c.querySelector(`[class*="z${i}"]`)!.hasAttribute('data-in'));
const chat = (c: HTMLElement) => c.querySelector('[aria-live="polite"]') as HTMLElement;

/** Records the order zones land in while time runs. */
async function landOrder(c: HTMLElement, ms: number) {
  const order: number[] = [];
  for (let t = 0; t < ms; t += 50) {
    await advance(50);
    zoneIn(c).forEach((on, i) => {
      if (on && !order.includes(i)) order.push(i);
    });
  }
  return order;
}

describe('what lands in your hands', () => {
  it.each(LOCALES)('%s: one chat, four zones, the service side first', (locale) => {
    const copy = COPY[locale].lands;
    const { container } = render(<Lands locale={locale} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(copy.title);
    expect(zoneIn(container)).toEqual([true, true, true, true]);
    for (const key of copy.service.keys) expect(container).toHaveTextContent(key);
    expect(screen.getByRole('tab', { name: copy.service.label })).toHaveAttribute('aria-selected', 'true');
    expect(chat(container)).toHaveTextContent(copy.service.chat[0]!.r === 'v' ? copy.service.chat[0]!.t : '');
  });

  it('says which side is on', () => {
    const copy = COPY.en.lands;
    render(<Lands locale="en" />);
    fireEvent.click(screen.getByRole('tab', { name: copy.products.label }));
    expect(screen.getByRole('tab', { name: copy.products.label })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: copy.service.label })).toHaveAttribute('aria-selected', 'false');
  });

  it('draws the finished frame with no timer under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    watchViews().show(true);
    const { container } = render(<Lands locale="en" />);
    await advance(0);
    expect(zoneIn(container)).toEqual([true, true, true, true]);
    expect(container.querySelectorAll('path[data-on]')).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws the finished frame on the server', () => {
    const html = renderToString(<Lands locale="en" />);
    expect(html).toContain('Farhan · new lead · 11:42 pm');
    expect(html).toContain('Hi, nak buat branding untuk kafe baru. Ada package?');
  });

  it('lands the suggestion when the page suggests, then the lead, the alert and the questions', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(0);
    expect(zoneIn(container)).toEqual([false, false, false, false]);
    expect(await landOrder(container, 18000)).toEqual([1, 0, 2, 3]);
  });

  it('the capture card types the number and says it was sent', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    let typed = false;
    for (let t = 0; t < 25000 && !(chat(container).textContent ?? '').includes('Got it.'); t += 50) {
      await advance(50);
      if ((chat(container).textContent ?? '').includes('012-554')) typed = true;
    }
    expect(typed).toBe(true);
    expect(chat(container)).toHaveTextContent(COPY.en.lands.capture.sent('Studio Hana'));
    expect(chat(container)).not.toHaveTextContent(COPY.en.lands.capture.send);
  });

  it('bumps your own question’s count once it lands', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    const me = () => container.querySelector('[data-me] em')!.textContent;
    expect(me()).toBe('22');
    for (let t = 0; t < 25000 && !zoneIn(container)[3]; t += 50) await advance(50);
    expect(me()).toBe('22');
    await advance(TIMING.bump);
    expect(me()).toBe('23');
  });

  it('switching side mid-run stops the old run: nothing from Studio Hana reaches the Kek Lina chat', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    // Into the service chat, while the visitor is typing.
    await advance(TIMING.start + 10 * TIMING.typeChar);
    expect(container.querySelector('[data-ty]')).not.toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: copy.products.label }));
    });
    await advance(20000);
    const text = chat(container).textContent ?? '';
    for (const m of copy.service.chat) if (m.r === 'v' || m.r === 'p') expect(text).not.toContain(m.t);
    expect(container).not.toHaveTextContent('Studio Hana');
  });

  it('alternates sides on its own, and stays on the side a visitor picked', () => {
    expect(nextSide('service', false)).toBe('products');
    expect(nextSide('products', false)).toBe('service');
    expect(nextSide('products', true)).toBe('products');
    expect(nextSide('service', true)).toBe('service');
  });

  it('wraps the steps on phones', () => {
    const css = read('lands.module.css');
    const block = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)![0];
    expect(block).toMatch(/\.lsteps \{[^}]*flex-wrap: wrap/);
  });
});
