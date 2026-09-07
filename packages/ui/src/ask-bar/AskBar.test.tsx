import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskBar } from './AskBar.js';

function withReducedMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => withReducedMotion(false));
afterEach(() => vi.useRealTimers());

describe('AskBar', () => {
  it('shows a question from this page, not an empty prompt', () => {
    render(<AskBar questions={['Berapa harga kek?', 'Buka hari Ahad?']} onOpen={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Berapa harga kek?');
  });

  it('never presents an empty prompt when the page has no questions', () => {
    // FRONTEND.md calls this the founding constraint: the visitor should never
    // have to invent the question. A page whose facts all predate the question
    // column still has to offer something to tap.
    render(<AskBar questions={[]} onOpen={vi.fn()} />);
    expect(screen.getByRole('button').textContent?.trim()).not.toBe('');
  });

  it('cycles to the next question every four seconds', () => {
    vi.useFakeTimers();
    render(<AskBar questions={['first one', 'second one']} onOpen={vi.fn()} />);

    expect(screen.getByRole('button')).toHaveTextContent('first one');
    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.getByRole('button')).toHaveTextContent('second one');
  });

  it('shows one question and stops when reduced motion is requested', () => {
    withReducedMotion(true);
    vi.useFakeTimers();
    render(<AskBar questions={['first one', 'second one']} onOpen={vi.fn()} />);

    act(() => void vi.advanceTimersByTime(12_000));
    expect(screen.getByRole('button')).toHaveTextContent('first one');
  });

  it('opens with the question on show, so tapping answers what was offered', async () => {
    const onOpen = vi.fn();
    render(<AskBar questions={['Berapa harga kek?']} onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith('Berapa harga kek?');
  });

  it('is reachable and operable from the keyboard', async () => {
    // The accessibility floor, and the reason this is a <button>: a styled div
    // with an onClick is not tabbable and does not fire on Enter.
    const onOpen = vi.fn();
    render(<AskBar questions={['a question']} onOpen={onOpen} />);

    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalled();
  });

  it('carries an accessible name that survives the question changing', () => {
    // The visible text rotates every four seconds. Without a stable label, a
    // screen-reader user's idea of what this control is changes with it.
    render(<AskBar questions={['a', 'b']} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /ask/i })).toBeInTheDocument();
  });
});
