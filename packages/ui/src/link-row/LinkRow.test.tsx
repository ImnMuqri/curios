import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LinkRow } from './LinkRow.js';

describe('LinkRow', () => {
  it('renders a real anchor with the label', () => {
    // A real <a href>. With JavaScript off this page is still a working link
    // list, which FRONTEND.md calls the product's reputation and the SEO
    // artifact -- a div with an onClick would break all three at once.
    render(<LinkRow href="https://wa.me/60123" label="WhatsApp" />);
    const link = screen.getByRole('link', { name: /whatsapp/i });
    expect(link).toHaveAttribute('href', 'https://wa.me/60123');
  });

  it('hides the decorative arrow from assistive technology', () => {
    // "Menu right arrow" read aloud on every single row is noise, and the
    // accessible name should be the label alone.
    render(<LinkRow href="https://example.com" label="Menu" />);
    expect(screen.getByRole('link', { name: 'Menu' })).toBeInTheDocument();
  });
});
