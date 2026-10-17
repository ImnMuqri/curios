import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { AuthFilm } from './AuthFilm.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AuthFilm', () => {
  it('is decoration: hidden from assistive tech', () => {
    const { container } = render(<AuthFilm film="signin" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('plays sign in from the night to the morning, scene by scene', async () => {
    vi.useFakeTimers();
    const { container } = render(<AuthFilm film="signin" />);
    expect(container).toHaveTextContent('11:42');
    expect(container).toHaveTextContent('Answered while Lina slept');
    await act(async () => {
      vi.advanceTimersByTime(4900);
    });
    expect(container).toHaveTextContent('Wake up to leads.');
    await act(async () => {
      vi.advanceTimersByTime(4900);
    });
    expect(container).toHaveTextContent('Reply before breakfast.');
    // Sign in shows only what the product does today: no paid orders.
    expect(container).not.toHaveTextContent(/order #|paid by qr/i);
  });

  it('holds the first scene for a visitor who asked for less motion', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    vi.useFakeTimers();
    const { container } = render(<AuthFilm film="signup" />);
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(container).toHaveTextContent('You’re deep in a project.');
  });
});
