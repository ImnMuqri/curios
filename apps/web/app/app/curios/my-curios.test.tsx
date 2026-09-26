import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyCuriosEditor } from './my-curios.js';

const initial = {
  id: 'p1', handle: 'imnmuqri', displayName: 'Iman Muqri', bio: null, avatarUrl: null,
  style: 'SOFT' as const, accentColor: '#0c7a62', headingFont: 'JAKARTA' as const, avatarKey: null,
  links: [{ id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null }],
};

const api = () => ({
  addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', label: i.label, url: `https://${i.url}`, size: null })),
  updateLink: vi.fn(async (id: string, p: object) => ({ ...initial.links[0]!, ...p })),
  removeLink: vi.fn(async () => undefined),
  reorder: vi.fn(async () => undefined),
  saveAppearance: vi.fn(async () => undefined),
  uploadAvatar: vi.fn(async () => null),
  removeAvatar: vi.fn(async () => undefined),
});

describe('MyCuriosEditor', () => {
  // The preview updates from local state, before any save returns.
  it('shows a new link in the live preview as soon as it is added', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shopee.com.my/iman');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    const preview = screen.getByRole('region', { name: 'Live preview' });
    expect(within(preview).getByText('Shop')).toBeInTheDocument();
  });

  it('shows the name in the preview while it is being typed', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    const name = screen.getByLabelText('Display name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Iman M.');

    expect(within(screen.getByRole('region', { name: 'Live preview' })).getByRole('heading', { name: 'Iman M.' })).toBeInTheDocument();
  });
});
