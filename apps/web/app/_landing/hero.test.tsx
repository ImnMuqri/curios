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

  it('types the answer out on the front page, then moves the deck on', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Hero locale="en" />);
    view.show(true);
    const front = () => container.querySelector('[data-s="0"]') as HTMLElement;
    const answer = COPY.en.personas.aisyah.a;
    // The run starts on the links, then asks.
    expect(front()).not.toHaveTextContent(answer);
    await advance(1700 + 450 + 650 + 900);
    await advance(22 * 10);
    expect(front().textContent).toContain(answer.slice(0, 8));
    expect(front()).not.toHaveTextContent(answer);
    await advance(22 * answer.length + 500);
    expect(front()).toHaveTextContent(answer);
    await advance(2300 + 500);
    expect(front()).toHaveAttribute('data-k', 'lina');
  });

  it('a click on a side page brings it to the front', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Hero locale="en" />);
    view.show(true);
    fireEvent.click(container.querySelector('[data-k="hana"]')!);
    await advance(10);
    expect(slot(container, 'hana')).toBe('0');
    expect(slot(container, 'aisyah')).toBe('1');
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

  it('Peek ducks while the claim field has focus', () => {
    const { container } = render(<Claim id="c2" label="Address" placeholder="yourname" button="Claim" />);
    const input = screen.getByLabelText('Address');
    const wrap = container.querySelector('[data-field]')!;
    expect(wrap).not.toHaveAttribute('data-typing');
    fireEvent.focus(input);
    expect(wrap).toHaveAttribute('data-typing');
    fireEvent.blur(input);
    expect(wrap).not.toHaveAttribute('data-typing');
    expect(wrap.querySelector('svg')).not.toBeNull();
  });

  it('the closing claim field has no Peek on it', () => {
    const { container } = render(<Claim id="c3" label="Address" placeholder="yourname" button="Claim" variant="end" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
