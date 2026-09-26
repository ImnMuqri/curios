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

  // Fix round 1, Important #1: a link edit (label or size) must reach the
  // preview from local state, on every keystroke/click, independent of
  // whether the save behind it ever resolves. `updateLink` never resolving
  // is what proves that -- if the preview waited on the save, it would never
  // update at all here.
  it('shows a link label change in the live preview immediately, before the save resolves', async () => {
    const stuck = api();
    stuck.updateLink = vi.fn(() => new Promise<never>(() => {}));
    render(<MyCuriosEditor initial={initial} api={stuck} uploadsEnabled={false} />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    await userEvent.type(within(row).getByLabelText('Name'), '!');

    const preview = screen.getByRole('region', { name: 'Live preview' });
    expect(within(preview).getByText('Portfolio!')).toBeInTheDocument();
  });

  it('shows a chosen tile size in the live preview immediately, before the save resolves', async () => {
    const stuck = api();
    stuck.updateLink = vi.fn(() => new Promise<never>(() => {}));
    render(<MyCuriosEditor initial={initial} api={stuck} uploadsEnabled={false} />);

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Big tile' }));

    const preview = screen.getByRole('region', { name: 'Live preview' });
    const tile = within(preview).getByText('Portfolio').closest('[data-size]');
    expect(tile).toHaveAttribute('data-size', 'BIG');
  });

  it('restyles the preview the moment a style is chosen', async () => {
    const { container } = render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(container.querySelector('[aria-label="Live preview"] [data-style]')).toHaveAttribute('data-style', 'CONTRAST');
  });
});
