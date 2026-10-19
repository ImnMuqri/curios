import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useToast } from './toast.js';

let sayIt: (text: string) => void = () => {};

function Screen() {
  const { say, toast } = useToast(2400);
  sayIt = say;
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
});
