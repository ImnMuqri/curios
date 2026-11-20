import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { TOAST_ERROR_MS, useToast } from './toast.js';

let sayIt: (text: string) => void = () => {};
let noteIt: (text: string) => void = () => {};
let failIt: (text: string) => void = () => {};

function Screen() {
  const { say, note, fail, toast } = useToast(2400);
  sayIt = say;
  noteIt = note;
  failIt = fail;
  return toast;
}

describe('useToast', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps its live region in the page, says one thing, then lets it go', () => {
    vi.useFakeTimers();
    render(<Screen />);
    // Present and empty before anything is said, so the first toast is heard.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    act(() => sayIt('Saved.'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => sayIt('Marked contacted.'));
    // A new toast replaces the old and gets its own full time.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Marked contacted.');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('has a neutral tone for news that is not a success: the same pill, no tick', () => {
    vi.useFakeTimers();
    render(<Screen />);
    act(() => noteIt('That order is no longer in this list.'));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('That order is no longer in this list.');
    expect(status.querySelector('svg')).toBeNull();
    act(() => sayIt('Saved.'));
    expect(screen.getByRole('status').querySelector('svg')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('has an error tone: no tick, its own alert region, and it stays until dismissed or the long timeout', () => {
    vi.useFakeTimers();
    render(<Screen />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => failIt('That did not save. Try again.'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('That did not save. Try again.');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    // No tick: the alert mark, not the success path.
    expect(alert.querySelector('path[d="M5 12.5l4.5 4.5L19 7.5"]')).toBeNull();
    expect(alert.querySelector('p')).toHaveAttribute('data-tone', 'error');
    // Past the success toast's time it is still there.
    act(() => {
      vi.advanceTimersByTime(TOAST_ERROR_MS - 1);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('That did not save.');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => failIt('Again.'));
    act(() => screen.getByRole('button', { name: 'Dismiss' }).click());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows one pill at a time: a success clears a failure', () => {
    render(<Screen />);
    act(() => failIt('Failed.'));
    act(() => sayIt('Saved.'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });
});

describe('failureText', () => {
  it('is the API’s words, else the one fallback sentence, else a page’s own', async () => {
    const { failureText, FAILED } = await import('./toast.js');
    expect(failureText(new Error('No such lead.'))).toBe('No such lead.');
    expect(failureText(new Error(''))).toBe(FAILED);
    expect(failureText('nope')).toBe('That did not go through. Try again.');
    expect(failureText(undefined, 'Could not send.')).toBe('Could not send.');
  });
});
