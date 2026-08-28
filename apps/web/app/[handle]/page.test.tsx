import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PublicPage } from '@curios/db-read';

vi.mock('@curios/db-read', () => ({ getPublicPage: vi.fn() }));

const { getPublicPage } = await import('@curios/db-read');
const HandlePage = (await import('./page.js')).default;

const page: PublicPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  bio: 'Kek butter, Shah Alam',
  language: 'ms',
  mode: 'BUSINESS',
  links: [
    { id: 'l1', label: 'WhatsApp', url: 'https://wa.me/60123456789', icon: null, position: 0 },
    { id: 'l2', label: 'Instagram', url: 'https://instagram.com/nadia', icon: null, position: 1 },
  ],
  facts: [
    { id: 'f1', category: 'PRICE', claim: 'Kek 1kg butter starts at RM95' },
    { id: 'f2', category: 'HOURS', claim: 'Open Monday to Saturday' },
  ],
};

describe('public page', () => {
  it('renders the owner name and every link as a real anchor', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(page);
    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(screen.getByText('Nadia Bakes')).toBeDefined();

    const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
    expect(whatsapp.getAttribute('href')).toBe('https://wa.me/60123456789');
    expect(screen.getByRole('link', { name: /instagram/i })).toBeDefined();
  });

  it('renders facts into the DOM so the page works without JavaScript', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(page);
    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));
    expect(screen.getByText(/Kek 1kg butter starts at RM95/)).toBeDefined();
  });

  it('calls notFound for an unknown handle', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(null);
    await expect(HandlePage({ params: Promise.resolve({ handle: 'nobody' }) })).rejects.toThrow();
  });
});
