import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CountUp } from './count-up.js';

const motion = window.matchMedia.bind(window);

describe('CountUp', () => {
  afterEach(() => {
    window.matchMedia = motion;
    vi.useRealTimers();
  });

  it('counts up from nothing to the figure, as the boards open', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
    render(
      <b data-testid="n">
        <CountUp value={2000} />
      </b>,
    );
    expect(screen.getByTestId('n')).toHaveTextContent('0');

    await act(async () => { vi.advanceTimersByTime(300); });
    const midway = Number(screen.getByTestId('n').textContent?.replace(/,/g, ''));
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(2000);

    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(screen.getByTestId('n')).toHaveTextContent('2,000');
  });

  it('shows the figure at once for anyone who asked for less motion', () => {
    window.matchMedia = (query: string) => ({ ...motion(query), matches: query.includes('reduce') });
    render(<CountUp value={412} />);
    expect(screen.getByText('412')).toBeInTheDocument();
  });
});
