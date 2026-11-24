import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { Lands, TIMING, type Side } from './Lands.js';
import { COPY } from './copy.js';
import { LOCALES, advance, read, reduceMotion, rule, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const stage = (c: HTMLElement) => c.querySelector('[data-side]') as HTMLElement;
const sideOf = (c: HTMLElement) => stage(c).dataset.side as Side;
const boxes = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-bx]')];
/** Which of the four cards have flown in (the run gives each an inline opacity of 1). */
const landed = (c: HTMLElement) => boxes(c).flatMap((b, i) => (b.style.opacity === '1' ? [i] : []));
const counts = (c: HTMLElement) => [...c.querySelectorAll('em')].map((e) => e.textContent);
const whoIn = (c: HTMLElement) => c.querySelector('[class*="who"]')!.hasAttribute('data-in');

/** Runs fake time in 50ms steps, noting every change of side and of cards landed. */
async function watch(c: HTMLElement, ms: number) {
  const sides: Side[] = [sideOf(c)];
  const order: number[] = [];
  for (let t = 0; t < ms; t += 50) {
    await advance(50);
    if (sideOf(c) !== sides.at(-1)) sides.push(sideOf(c));
    for (const i of landed(c)) if (!order.includes(i)) order.push(i);
  }
  return { sides, order };
}

/** One side's whole run, from a click to the next side's fade: fade, wait, who, bubble, typing, said, four cards, counts, hold. */
const RUN =
  TIMING.fade +
  TIMING.who +
  TIMING.bubble +
  TIMING.typing +
  TIMING.said +
  4 * (TIMING.land + TIMING.between) +
  TIMING.countWait +
  (TIMING.countSteps + 1) * TIMING.countStep +
  TIMING.hold;

describe('what lands in your hands', () => {
  it.each(LOCALES)('%s: a question, then four cards, the service side first', (locale) => {
    const copy = COPY[locale].lands;
    const { container } = render(<Lands locale={locale} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(copy.title);
    expect(container).toHaveTextContent(copy.lede);
    expect(container).toHaveTextContent(copy.service.question);
    expect(container).toHaveTextContent(copy.service.who);
    expect(boxes(container)).toHaveLength(4);
    expect(container).toHaveTextContent(copy.service.lead.name);
    expect(container).toHaveTextContent(copy.service.lead.phone);
    expect(container).toHaveTextContent(copy.service.lead.action);
    expect(container).toHaveTextContent(copy.service.notice.text);
    expect(container).toHaveTextContent(copy.suggested);
    expect(container).toHaveTextContent(copy.service.pick.name);
    expect(container).toHaveTextContent(copy.countsTitle);
    expect(container).toHaveTextContent(copy.service.missTag);
    expect(screen.getByRole('button', { name: copy.service.label })).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks in Malay on both landings, and counts what people asked', () => {
    for (const locale of LOCALES) expect(COPY[locale].lands.service.question).toBe('Ada package branding untuk kafe baru? Budget saya dalam RM4k.');
    for (const locale of LOCALES) expect(COPY[locale].lands.products.question).toBe('Kek birthday budak bawah RM100 ada? Nak ambil Sabtu.');
    const { container } = render(<Lands locale="en" />);
    expect(counts(container)).toEqual(['22', '14', '9']);
  });

  it('keeps the products side’s number as the owner decided: Aida, 012-345 6789', () => {
    for (const locale of LOCALES) expect(COPY[locale].lands.products.order.phone).toBe('012-345 6789');
  });

  it('switches side with pressed buttons in a named group', () => {
    const copy = COPY.en.lands;
    render(<Lands locale="en" />);
    expect(screen.getByRole('group', { name: copy.switchLabel })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: copy.products.label }));
    expect(screen.getByRole('button', { name: copy.products.label })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: copy.service.label })).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws the finished frame on the server, with nothing hidden', () => {
    const html = renderToString(<Lands locale="en" />);
    expect(html).toContain('Farhan, on Studio Hana’s page');
    expect(html).toContain('Ada package branding untuk kafe baru?');
    expect(html).toContain('012-554 8190');
    expect(html).not.toContain('data-play');
  });

  it('no chat phone, checkout or four numbered zones are left', () => {
    const { container } = render(<Lands locale="en" />);
    expect(container).not.toHaveTextContent('Waiting for a chat');
    expect(container).not.toHaveTextContent('Maybank2u');
    expect(container).not.toHaveTextContent('Hot');
    expect(container.querySelector('svg path[d^="M"][data-on]')).toBeNull();
  });

  it('plays: the question arrives, then each card flies out of it in turn, and the counts run', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(0);
    // The old frame fades out first.
    expect(container.querySelector('[class*="fd"]')).toHaveAttribute('data-out');
    await advance(TIMING.fade);
    expect(stage(container)).toHaveAttribute('data-play');
    expect(whoIn(container)).toBe(false);
    expect(landed(container)).toEqual([]);
    await advance(TIMING.who);
    expect(whoIn(container)).toBe(true);
    expect(container.querySelector('[class*="bub"]')).not.toHaveAttribute('data-in');
    await advance(TIMING.bubble);
    expect(container.querySelector('[class*="bub"]')).toHaveAttribute('data-in');
    expect(container.querySelector('[class*="bub"]')).not.toHaveAttribute('data-said');
    await advance(TIMING.typing);
    expect(container.querySelector('[class*="bub"]')).toHaveAttribute('data-said');
    expect(landed(container)).toEqual([]);
    await advance(TIMING.said);
    // The first card leaves the bubble, whose ring lights.
    expect(landed(container)).toEqual([0]);
    expect(container.querySelector('[class*="bub"]')).toHaveAttribute('data-pulse');
    expect(boxes(container)[0]!.style.transform).toBe('none');
    expect(counts(container)).toEqual(['0', '0', '0']);
    await advance(TIMING.land);
    expect(container.querySelector('[class*="bub"]')).not.toHaveAttribute('data-pulse');
    await advance(TIMING.between);
    expect(landed(container)).toEqual([0, 1]);
    await advance(TIMING.land + TIMING.between);
    expect(landed(container)).toEqual([0, 1, 2]);
    await advance(TIMING.land + TIMING.between);
    expect(landed(container)).toEqual([0, 1, 2, 3]);
    // The counts wait, then run to the sample figures.
    expect(counts(container)).toEqual(['0', '0', '0']);
    await advance(TIMING.land + TIMING.countWait + 10 * TIMING.countStep);
    expect(counts(container).map(Number).every((n, i) => n > 0 && n < [22, 14, 9][i]!)).toBe(true);
    await advance(12 * TIMING.countStep);
    expect(counts(container)).toEqual(['22', '14', '9']);
  });

  it('waits until the stage is in view before it starts', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Lands locale="en" />);
    await advance(TIMING.fade + 5000);
    expect(whoIn(container)).toBe(false);
    view.show(true);
    await advance(TIMING.poll + TIMING.who);
    expect(whoIn(container)).toBe(true);
  });

  it('takes turns on its own: service, products, then service again, the cards in order each time', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    const { sides, order } = await watch(container, 2.2 * RUN);
    expect(sides).toEqual(['service', 'products', 'service']);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('shows the products side’s paid order and moves the toggle with it', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(RUN + TIMING.fade);
    expect(sideOf(container)).toBe('products');
    expect(container).toHaveTextContent(copy.products.order.amount);
    expect(container).toHaveTextContent('from Aida · 012-345 6789');
    expect(container).toHaveTextContent(copy.products.order.foot);
    expect(container).toHaveTextContent(copy.products.who);
    expect(screen.getByRole('button', { name: copy.products.label })).toHaveAttribute('aria-pressed', 'true');
    expect(counts(container)).toEqual(['0', '0', '0']);
  });

  it('keeps taking turns after a visitor picks a side: the pick plays first, then the other side', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(TIMING.fade + 3000);
    fireEvent.click(screen.getByRole('button', { name: copy.products.label }));
    expect(screen.getByRole('button', { name: copy.products.label })).toHaveAttribute('aria-pressed', 'true');
    const { sides } = await watch(container, 2.2 * RUN);
    expect(sides).toEqual(['service', 'products', 'service', 'products']);
  });

  it('a click while the other side plays stops that run: nothing of it lands on the new side', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(TIMING.fade + TIMING.who + TIMING.bubble + TIMING.typing + TIMING.said + 100);
    expect(landed(container)).toEqual([0]);
    fireEvent.click(screen.getByRole('button', { name: copy.products.label }));
    await advance(TIMING.fade);
    expect(sideOf(container)).toBe('products');
    expect(landed(container)).toEqual([]);
    expect(container).not.toHaveTextContent(copy.service.lead.name);
    expect(whoIn(container)).toBe(false);
  });

  it('Play again reruns the side that is showing, then carries on taking turns', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(TIMING.fade + TIMING.who + TIMING.bubble + TIMING.typing + TIMING.said + 2 * (TIMING.land + TIMING.between) + 100);
    expect(landed(container).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: copy.replay }));
    await advance(TIMING.fade);
    expect(sideOf(container)).toBe('service');
    expect(landed(container)).toEqual([]);
    expect(whoIn(container)).toBe(false);
    const { sides, order } = await watch(container, 1.2 * RUN);
    expect(sides).toEqual(['service', 'products']);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('a double click on Play again during the fade starts one run, not two', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(TIMING.fade + 3000);
    fireEvent.click(screen.getByRole('button', { name: copy.replay }));
    await advance(100);
    fireEvent.click(screen.getByRole('button', { name: copy.replay }));
    await advance(TIMING.fade);
    const { sides, order } = await watch(container, 1.2 * RUN);
    expect(sides).toEqual(['service', 'products']);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('a click clears the previous run’s timers: it never holds more than before', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    render(<Lands locale="en" />);
    view.show(true);
    await advance(TIMING.fade + 3000);
    const before = vi.getTimerCount();
    fireEvent.click(screen.getByRole('button', { name: copy.products.label }));
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before);
  });

  it('pauses in a hidden tab and starts the side again when the tab is shown', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    await advance(TIMING.fade + TIMING.who + TIMING.bubble + TIMING.typing + TIMING.said + 100);
    expect(landed(container)).toEqual([0]);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    const paused = vi.getTimerCount();
    await advance(60000);
    expect(landed(container)).toEqual([0]);
    expect(sideOf(container)).toBe('service');
    expect(vi.getTimerCount()).toBeLessThanOrEqual(paused);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(TIMING.fade);
    expect(landed(container)).toEqual([]);
    const { order } = await watch(container, RUN);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('does not move to the other side while keyboard focus is inside the section', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.lands;
    const { container } = render(<Lands locale="en" />);
    view.show(true);
    const button = screen.getByRole('button', { name: copy.replay });
    button.focus();
    expect(container.contains(document.activeElement)).toBe(true);
    await advance(2 * RUN);
    expect(sideOf(container)).toBe('service');
    button.blur();
    await advance(TIMING.poll + TIMING.fade + 100);
    expect(sideOf(container)).toBe('products');
  });

  it('reads the question once, out loud, from the first moment', () => {
    const { container } = render(<Lands locale="en" />);
    const copy = COPY.en.lands;
    const speakable = [...container.querySelectorAll('[class*="bub"] > *')].filter((e) => e.getAttribute('aria-hidden') !== 'true');
    expect(speakable.map((e) => e.textContent)).toEqual([copy.service.question]);
  });

  describe('when the motion preference changes', () => {
    it('turning reduced motion on mid-run clears every timer and shows the still frame', async () => {
      vi.useFakeTimers();
      const view = watchViews();
      let reduced = false;
      const listeners = new Set<() => void>();
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
          ({
            get matches() {
              return reduced && query.includes('reduce');
            },
            media: query,
            addEventListener: (_: string, cb: () => void) => listeners.add(cb),
            removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
          }) as unknown as MediaQueryList,
      );
      const { container } = render(<Lands locale="en" />);
      view.show(true);
      await advance(TIMING.fade + 3000);
      expect(stage(container)).toHaveAttribute('data-play');
      reduced = true;
      await advance(0);
      listeners.forEach((cb) => cb());
      await advance(0);
      expect(stage(container)).not.toHaveAttribute('data-play');
      expect(counts(container)).toEqual(['22', '14', '9']);
      expect(screen.queryByRole('button', { name: COPY.en.lands.replay })).toBeNull();
      await advance(60000);
      expect(sideOf(container)).toBe('service');
    });
  });

  it('stops every timer when it leaves the page', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { unmount } = render(<Lands locale="en" />);
    view.show(true);
    await advance(3000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('under reduced motion', () => {
    it('shows every card at once, with no timer, no Play again and no flying', async () => {
      vi.useFakeTimers();
      reduceMotion();
      watchViews().show(true);
      const { container } = render(<Lands locale="en" />);
      await advance(0);
      expect(boxes(container)).toHaveLength(4);
      expect(stage(container)).not.toHaveAttribute('data-play');
      expect(container.querySelector('[class*="bub"]')).toHaveAttribute('data-said');
      expect(whoIn(container)).toBe(true);
      expect(counts(container)).toEqual(['22', '14', '9']);
      for (const b of boxes(container)) expect(b.style.opacity).toBe('');
      expect(screen.queryByRole('button', { name: COPY.en.lands.replay })).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stays on the side picked: no alternation', async () => {
      vi.useFakeTimers();
      reduceMotion();
      const copy = COPY.en.lands;
      const { container } = render(<Lands locale="en" />);
      fireEvent.click(screen.getByRole('button', { name: copy.products.label }));
      await advance(0);
      expect(sideOf(container)).toBe('products');
      expect(container).toHaveTextContent(copy.products.order.kicker);
      expect(counts(container)).toEqual(['14', '12', '8']);
      await advance(120000);
      expect(sideOf(container)).toBe('products');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('lays the cards out as the board does: a, b, c, d; the stage is tinted sky then pink', () => {
    const css = read('lands.module.css');
    expect(rule(css, '.bt')).toMatch(/grid-template-columns:\s*1\.08fr 1fr/);
    expect(rule(css, '.bt')).toMatch(/'a b'\s*'a c'\s*'d d'/);
    expect(rule(css, '.bt')).toMatch(/max-width:\s*760px/);
    expect(rule(css, '.st')).toMatch(/max-width:\s*1000px/);
    expect(rule(css, '.st')).toMatch(/padding:\s*48px 44px 52px/);
    expect(rule(css, '.st')).toMatch(/background:\s*var\(--cl-wl-svc\)/);
    expect(rule(css, ".st[data-side='products']")).toMatch(/background:\s*var\(--cl-wl-prod\)/);
    expect(rule(css, '.pk')).toMatch(/width:\s*96px/);
  });
});
