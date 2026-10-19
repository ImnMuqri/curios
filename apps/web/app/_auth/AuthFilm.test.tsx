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
    // The SignIn board's morning: the paid order first, then the lead and the questions.
    expect(container).toHaveTextContent('Wake up to orders.');
    expect(container).toHaveTextContent('New order #1042 · RM235');
    expect(container).toHaveTextContent('Paid by QR, proof attached');
    expect(container).toHaveTextContent('New lead · 012-345 6789');
    await act(async () => {
      vi.advanceTimersByTime(4900);
    });
    // Then confirming it in Orders.
    expect(container).toHaveTextContent('Confirm it before breakfast.');
    expect(container).toHaveTextContent('Orders');
    expect(container).toHaveTextContent('Mira');
    expect(container).toHaveTextContent('#1042 · 7:12 am');
    expect(container).toHaveTextContent('2× Kek coklat 1kg · 1× Kek batik');
    expect(container).toHaveTextContent('Pickup · Saturday · Paid by QR');
    expect(container).toHaveTextContent('Confirmed ✓');
    expect(container).toHaveTextContent('Hakim · #1041');
    expect(container).not.toHaveTextContent('Reply before breakfast.');
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
