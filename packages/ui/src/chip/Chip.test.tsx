import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip.js';

describe('Chip', () => {
  it('renders its question', () => {
    render(<Chip>Berapa harga kek?</Chip>);
    expect(screen.getByText('Berapa harga kek?')).toBeInTheDocument();
  });

  it('marks the lead variant distinctly from the default', () => {
    const { container: plain } = render(<Chip>a</Chip>);
    const { container: lead } = render(<Chip variant="lead">b</Chip>);
    // Asserting the two differ rather than asserting a class name: the point
    // is that the variant reaches the DOM, not what CSS Modules hashed it to.
    expect(plain.firstElementChild?.className).not.toBe(lead.firstElementChild?.className);
  });
});
