import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { Hero } from './Hero.js';
import { Claim } from './Claim.js';
import { readWantedHandle } from '../../lib/wanted-handle.js';
import { COPY } from './copy.js';
import { DECK, PERSONAS } from './personas.js';
import { advance, reduceMotion, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const slot = (container: HTMLElement, key: string) => container.querySelector(`[data-k="${key}"]`)!.getAttribute('data-s');

describe('the hero', () => {
  it('reads the rolling name once, as the first page in the deck', () => {
    render(<Hero locale="en" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Don’t read the bio. Ask Aisyah.');
  });

  it('names what Curios is above the h1, in both languages', () => {
    for (const [locale, label] of [['en', 'One link. Every answer.'], ['ms', 'Satu link. Semua jawapan.']] as const) {
      const { container, unmount } = render(<Hero locale={locale} />);
      const h1 = container.querySelector('h1')!;
      expect(h1.previousElementSibling).toHaveTextContent(label);
      expect(h1.previousElementSibling!.tagName).toBe('P');
      unmount();
    }
  });

  it('shows three pages, Aisyah in front', () => {
    expect(DECK).toEqual(['aisyah', 'lina', 'hana']);
    const { container } = render(<Hero locale="en" />);
    expect(container.querySelectorAll('[data-s]')).toHaveLength(3);
    expect(slot(container, 'aisyah')).toBe('0');
    expect(slot(container, 'lina')).toBe('1');
    expect(slot(container, 'hana')).toBe('-1');
  });

  it('draws Kek Lina’s name in Outfit, as on the board', () => {
    expect(PERSONAS.lina.font).toBe('var(--font-outfit)');
  });

  it('server-renders the front page asked and fully answered', () => {
    const html = renderToString(<Hero locale="en" />);
    expect(html).toContain(COPY.en.personas.aisyah.q);
    expect(html).toContain(COPY.en.personas.aisyah.a);
  });

  it('starts on the server’s frame, holds it, then moves the deck on and types the next answer', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Hero locale="en" />);
    const front = () => container.querySelector('[data-s="0"]') as HTMLElement;
    const aisyah = COPY.en.personas.aisyah.a;
    // The first client frame is the server's (asked and answered): no flash to an empty page.
    expect(front()).toHaveTextContent(aisyah);
    view.show(true);
    await advance(0);
    expect(front()).toHaveTextContent(aisyah);
    await advance(2299);
    expect(front()).toHaveAttribute('data-k', 'aisyah');
    await advance(1);
    expect(front()).toHaveAttribute('data-k', 'lina');
    const lina = COPY.en.personas.lina.a;
    expect(front()).not.toHaveTextContent(lina);
    await advance(500 + 1700 + 450 + 650 + 900);
    await advance(22 * 10);
    expect(front().textContent).toContain(lina.slice(0, 8));
    expect(front()).not.toHaveTextContent(lina);
    await advance(22 * lina.length + 500);
    expect(front()).toHaveTextContent(lina);
  });

  it('a click on a side page brings it to the front, then asks it', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Hero locale="en" />);
    view.show(true);
    fireEvent.click(container.querySelector('[data-k="hana"]')!);
    await advance(10);
    expect(slot(container, 'hana')).toBe('0');
    expect(slot(container, 'aisyah')).toBe('1');
    const hana = COPY.en.personas.hana.a;
    const front = () => container.querySelector('[data-s="0"]') as HTMLElement;
    expect(front()).not.toHaveTextContent(hana);
    await advance(1700 + 450 + 650 + 900 + 22 * hana.length + 500);
    expect(front()).toHaveTextContent(hana);
  });

  it('a click on a side page brings it to the front, answered, under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    const { container } = render(<Hero locale="en" />);
    fireEvent.click(container.querySelector('[data-k="hana"]')!);
    await advance(0);
    expect(slot(container, 'hana')).toBe('0');
    expect(container.querySelector('[data-s="0"]')).toHaveTextContent(COPY.en.personas.hana.a);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer and no pointer listener once unmounted', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Hero locale="en" />);
    view.show(true);
    await advance(3000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove.mock.calls.map((c) => c[0])).toContain('pointermove');
  });

  it('holds the finished frame and starts no timer under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    watchViews().show(true);
    const { container } = render(<Hero locale="en" />);
    await advance(0);
    expect(container.querySelector('[data-s="0"]')).toHaveTextContent(COPY.en.personas.aisyah.a);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the claim field', () => {
  it('claims with a plain GET to /signup and remembers the handle', () => {
    const { container } = render(<Claim id="c1" label="The address you want for your page" placeholder="yourname" button="Claim it, free" />);
    const form = container.querySelector('form')!;
    expect(form).toHaveAttribute('action', '/signup');
    expect(form).toHaveAttribute('method', 'get');
    const input = screen.getByLabelText('The address you want for your page');
    expect(input).toHaveAttribute('name', 'handle');
    fireEvent.change(input, { target: { value: 'kakmira' } });
    fireEvent.submit(form);
    expect(readWantedHandle()).toBe('kakmira');
  });

  it('Peek stays up over the claim field and smiles while it holds a name, never ducking on focus', () => {
    const { container } = render(<Claim id="c2" label="Address" placeholder="yourname" button="Claim" />);
    const input = screen.getByLabelText('Address');
    const wrap = container.querySelector('[data-field]')!;
    const svg = () => wrap.querySelector('svg[viewBox="0 0 160 150"]')!.getAttribute('class') ?? '';
    fireEvent.focus(input);
    expect(wrap).not.toHaveAttribute('data-text');
    expect(svg()).not.toMatch(/happy/);
    fireEvent.input(input, { target: { value: 'kakmira' } });
    expect(wrap).toHaveAttribute('data-text');
    expect(svg()).toMatch(/happy/);
    fireEvent.input(input, { target: { value: '  ' } });
    expect(svg()).not.toMatch(/happy/);
  });

  it('the closing claim field has no Peek on it', () => {
    const { container } = render(<Claim id="c3" label="Address" placeholder="yourname" button="Claim" variant="end" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
