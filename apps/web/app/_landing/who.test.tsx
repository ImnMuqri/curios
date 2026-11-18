import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Who, SQ_HOLD_MS, SQ_USER_HOLD_MS } from './Who.js';
import { COPY } from './copy.js';
import { WHO } from './personas.js';
import { LOCALES, advance, reduceMotion, watchViews } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const card = (c: HTMLElement, key: string) => c.querySelector(`[data-k="${key}"]`) as HTMLElement;
/** Typing, the press, the dots, and five answers 260ms apart. */
const RUN = (q: string) => 38 * q.length + 250 + 150 + 700 + 260 * 5;

describe('who it’s for', () => {
  it.each(LOCALES)('%s: one question, five pages, each with its own answer', (locale) => {
    const copy = COPY[locale].who;
    const { container } = render(<Who locale={locale} />);
    expect(WHO).toEqual(['aisyah', 'daniel', 'farah', 'lina', 'hana']);
    expect(container.querySelectorAll('article')).toHaveLength(5);
    for (const key of WHO) expect(card(container, key)).toHaveTextContent(copy.answers[key][0]);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('highlights only "Their own"', () => {
    const { container } = render(<Who locale="en" />);
    const hl = container.querySelectorAll('h2 span');
    expect(hl).toHaveLength(1);
    expect(hl[0]).toHaveTextContent('Their own');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Same question. Their own answer.');
  });

  it('types the question, then reveals the answers 260ms apart', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.who;
    const { container } = render(<Who locale="en" />);
    view.show(true);
    const q = copy.questions[0];
    await advance(38 * 5);
    expect(container.querySelector('[aria-hidden="true"] span')!.textContent).toBe(q.slice(0, 6)); // the first letter lands at once
    await advance(38 * q.length + 250 + 150 + 10);
    // Thinking: no answers, dots on every card.
    for (const key of WHO) expect(card(container, key)).not.toHaveTextContent(copy.answers[key][0]);
    await advance(700);
    expect(card(container, 'aisyah')).toHaveTextContent(copy.answers.aisyah[0]);
    expect(card(container, 'daniel')).not.toHaveTextContent(copy.answers.daniel[0]);
    await advance(260);
    expect(card(container, 'daniel')).toHaveTextContent(copy.answers.daniel[0]);
  });

  it('a question chip shows every page’s answer to it', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const copy = COPY.en.who;
    const { container } = render(<Who locale="en" />);
    view.show(true);
    fireEvent.click(screen.getByRole('tab', { name: copy.questions[2] }));
    await advance(RUN(copy.questions[2]) + 50);
    expect(screen.getByRole('tab', { name: copy.questions[2] })).toHaveAttribute('aria-selected', 'true');
    for (const key of WHO) expect(card(container, key)).toHaveTextContent(copy.answers[key][2]);
  });

  it('holds 15s after a visitor picks a question', async () => {
    vi.useFakeTimers();
    expect([SQ_HOLD_MS, SQ_USER_HOLD_MS]).toEqual([4600, 15000]);
    const view = watchViews();
    const copy = COPY.en.who;
    render(<Who locale="en" />);
    view.show(true);
    fireEvent.click(screen.getByRole('tab', { name: copy.questions[1] }));
    await advance(RUN(copy.questions[1]) + SQ_HOLD_MS + 500);
    expect(screen.getByRole('tab', { name: copy.questions[1] })).toHaveAttribute('aria-selected', 'true');
    await advance(SQ_USER_HOLD_MS - SQ_HOLD_MS);
    expect(screen.getByRole('tab', { name: copy.questions[2] })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows all five answers to the first question, with no timer, under reduced motion', async () => {
    vi.useFakeTimers();
    reduceMotion();
    watchViews().show(true);
    const copy = COPY.en.who;
    const { container } = render(<Who locale="en" />);
    await advance(0);
    for (const key of WHO) expect(card(container, key)).toHaveTextContent(copy.answers[key][0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
