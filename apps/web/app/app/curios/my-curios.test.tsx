import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyCuriosEditor } from './my-curios.js';

const initial = {
  id: 'p1', handle: 'imnmuqri', displayName: 'Iman Muqri', bio: null, avatarUrl: null,
  style: 'SOFT' as const, accentColor: '#2340c8', headingFont: 'JAKARTA' as const, avatarKey: null,
  coverKey: null, coverUrl: null, background: 'PAPER' as const, backgroundColor: null, language: 'en', shop: null, shopPhotoUrl: null,
  links: [{ id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null }],
};

const api = () => ({
  addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', label: i.label, url: `https://${i.url}`, size: null })),
  updateLink: vi.fn(async (id: string, p: object) => ({ ...initial.links[0]!, ...p })),
  removeLink: vi.fn(async () => undefined),
  reorder: vi.fn(async () => undefined),
  saveShopSize: vi.fn(async () => undefined),
  saveAppearance: vi.fn(async () => undefined),
  uploadAvatar: vi.fn(async () => null),
  removeAvatar: vi.fn(async () => undefined),
  chooseStockCover: vi.fn(async (name: string) => ({ coverKey: `stock/${name}`, coverUrl: `/covers/${name}.webp` })),
  uploadCover: vi.fn(async () => ({ coverKey: "covers/p1/a.webp", coverUrl: null })),
  removeCover: vi.fn(async () => undefined),
});

describe('MyCuriosEditor', () => {
  // The preview updates from local state, before any save returns.
  it('shows a new link in the live preview as soon as it is added', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));
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

    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));

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

    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));

    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Big tile' }));

    const preview = screen.getByRole('region', { name: 'Live preview' });
    const tile = within(preview).getByText('Portfolio').closest('[data-size]');
    expect(tile).toHaveAttribute('data-size', 'BIG');
  });

  it('restyles the preview the moment a style is chosen', async () => {
    const { container } = render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(container.querySelector('[aria-label="Live preview"] [data-style]')).toHaveAttribute('data-style', 'CONTRAST');
  });
});

// The preview reuses BentoPage, which fills the screen on the public page
// (min-height: 100vh). Inside the preview box that forced a scrollbar even for
// three links; the owner asked for none. jsdom has no layout, so this pins the
// two halves that make it fit: BentoPage's root is the box's direct child, and
// the stylesheet undoes the full-screen height for exactly that child.
describe('the live preview fits its box', () => {
  it("renders BentoPage inside the same phone the landing page shows, at the page's own address", () => {
    const { container } = render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    const preview = container.querySelector('[aria-label="Live preview"]');
    expect(preview?.querySelector('[data-tone] [data-bento-page]')).not.toBeNull();
    expect(preview?.textContent).toContain(`curios.my/${initial.handle}`);
  });

  // The phone is as tall as the window allows below the top bar (its width
  // follows from 9:19); the page fills the phone's screen rather than forcing
  // a full screen of its own inside it.
  it('fills a full-height frame without forcing its own screen height', () => {
    const css = readFileSync(join(import.meta.dirname, 'curios.module.css'), 'utf8');
    expect(css).toMatch(/\.device\s*\{[^}]*width:\s*min\(100%, calc\(\(100vh/);
    expect(css).toMatch(/\.phone\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/\.phone > \[data-bento-page\]\s*\{[^}]*min-height:\s*100%/);
  });

  // The public page's column gets a margin and rounded corners on wide
  // screens (Bento.module.css); inside the preview's own phone frame both
  // would show as a gap and a second set of corners, so the preview turns
  // them back off.
  it('turns off the public page column’s margin and rounding inside the preview frame', () => {
    const css = readFileSync(join(import.meta.dirname, 'curios.module.css'), 'utf8');
    expect(css).toMatch(/\.phone > \[data-bento-page\]\s*\{[^}]*margin:\s*0;/);
    expect(css).toMatch(/\.phone > \[data-bento-page\]\s*\{[^}]*border-radius:\s*0;/);
  });
});


describe('the icon rail', () => {
  it('shows one part at a time, Profile first, and the rail says which', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Display name')).toBeVisible();
    expect(screen.queryByRole('button', { name: '+ Add a link' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    expect(screen.getByRole('radio', { name: 'High contrast' })).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).not.toBeVisible();
  });

  it('moves between parts with the arrow keys, as a tab list does', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    screen.getByRole('tab', { name: 'Profile' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Links' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Links' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
  });

  // A hidden part keeps its state, so a name typed a moment ago still saves after switching away.
  it('keeps a part mounted while another is shown', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    await userEvent.type(screen.getByLabelText('Display name'), '!');
    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    expect(screen.getByLabelText('Display name')).toHaveValue(`${initial.displayName}!`);
  });

  it('previews the shop tile, as a box not a link', () => {
    const shop = { position: 0, size: null, itemCount: 2, photoKey: null };
    render(<MyCuriosEditor initial={{ ...initial, shop }} api={api()} uploadsEnabled={false} />);
    const preview = screen.getByRole('region', { name: 'Live preview' });
    expect(within(preview).getByText('Visit shop')).toBeInTheDocument();
    expect(within(preview).getByText('2 items')).toBeInTheDocument();
    expect(within(preview).queryByRole('link')).toBeNull();
  });
});
