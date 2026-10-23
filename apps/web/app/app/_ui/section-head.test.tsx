import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHead } from './section-head.js';

describe('SectionHead', () => {
  it('is the title and its note, with no tinted icon square before the title', () => {
    const { container } = render(<SectionHead id="links-title" title="Links" note="Top to bottom, as they appear" />);

    expect(screen.getByRole('heading', { name: 'Links' })).toHaveAttribute('id', 'links-title');
    expect(screen.getByText('Top to bottom, as they appear')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-tone]')).toBeNull();
  });
});
