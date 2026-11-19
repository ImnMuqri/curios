import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyPeek } from './empty-peek.js';

describe('EmptyPeek', () => {
  it('shows Peek 110px wide over the title, the line and the buttons', () => {
    const { container } = render(
      <EmptyPeek title="No orders yet" line="Share your shop and orders land here.">
        <a href="/app/store">Open your shop</a>
      </EmptyPeek>,
    );
    expect(container.querySelector('svg')).toHaveAttribute('width', '110');
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByText('Share your shop and orders land here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your shop' })).toBeInTheDocument();
  });

  it('gives each Peek its own clip id, so two on one page do not share a clip', () => {
    const { container } = render(
      <>
        <EmptyPeek title="One" line="a" />
        <EmptyPeek title="Two" line="b" />
      </>,
    );
    const clips = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(clips.length).toBeGreaterThanOrEqual(2);
    expect(new Set(clips).size).toBe(clips.length);
    // Each Peek's clipped parts point at its own clip.
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      const own = svg.querySelector('clipPath')!.id;
      for (const used of svg.querySelectorAll('[clip-path]')) expect(used.getAttribute('clip-path')).toBe(`url(#${own})`);
    }
  });
});
