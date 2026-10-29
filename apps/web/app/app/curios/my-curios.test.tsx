import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyCuriosEditor, type EditorPage } from './my-curios.js';

const initial: EditorPage = {
  id: 'p1', handle: 'imnmuqri', displayName: 'Iman Muqri', bio: null, avatarUrl: null,
  style: 'SOFT', accentColor: '#2340c8', headingFont: 'JAKARTA', avatarKey: null,
  coverKey: null, coverUrl: null, background: 'PAPER', backgroundColor: null, language: 'en',
  socials: [], shop: null, shopTab: null, shopItems: [], previewQuestion: 'Do you deliver to Klang?',
  links: [{ id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null }],
};

const business: EditorPage = {
  ...initial,
  shopTab: { open: false, itemCount: 2, preview: [] },
  shopItems: [
    { name: 'Kek coklat', priceCents: 9500, photoUrl: null },
    { name: 'Kek batik', priceCents: null, photoUrl: null },
  ],
};

const api = () => ({
  addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', label: i.label, url: `https://${i.url}`, size: null })),
  updateLink: vi.fn(async (_id: string, p: object) => ({ ...initial.links[0]!, ...p })),
  removeLink: vi.fn(async () => undefined),
  reorder: vi.fn(async () => undefined),
  setShopOpen: vi.fn(async () => undefined),
  saveAppearance: vi.fn(async () => undefined),
  uploadAvatar: vi.fn(async () => null),
  removeAvatar: vi.fn(async () => undefined),
  chooseStockCover: vi.fn(async (name: string) => ({ coverKey: `stock/${name}`, coverUrl: `/covers/${name}.webp` })),
  uploadCover: vi.fn(async () => ({ coverKey: 'covers/p1/a.webp', coverUrl: null })),
  removeCover: vi.fn(async () => undefined),
  askPage: vi.fn(async (_q: string) => ({ reply: 'Yes, delivery to Klang is RM15.' })),
});

const show = (page: EditorPage = initial, calls = api()) => {
  const view = render(<MyCuriosEditor initial={page} api={calls} uploadsEnabled={false} publicUrl="https://curios.my/imnmuqri" />);
  return { ...view, calls };
};
const preview = () => screen.getByRole('region', { name: 'Live preview' });
/** The editor's own tabs; the preview has a Links tab of its own. */
const editTab = (name: string) => within(screen.getByRole('tablist', { name: 'Edit' })).getByRole('tab', { name });
/** The editor's header bar; the page in the phone has a header too. */
const header = () => screen.getByRole('heading', { name: 'My Curios' }).closest('header')!;

afterEach(() => {
  vi.useRealTimers();
});

describe('MyCuriosEditor', () => {
  // The preview updates from local state, before any save returns.
  it('shows a new link in the live preview as soon as it is added', async () => {
    show();
    await userEvent.click(editTab('Links'));
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    // The Profile panel's name field reads "Name" on screen too; the link's is the one in Links.
    const links = within(screen.getByRole('tabpanel', { name: 'Links' }));
    await userEvent.type(links.getByLabelText('Name'), 'Shop');
    await userEvent.type(links.getByLabelText('Address'), 'shopee.com.my/iman');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(within(preview()).getByText('Shop')).toBeInTheDocument();
  });

  it('shows the name in the preview while it is being typed', async () => {
    show();
    const name = screen.getByLabelText('Display name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Iman M.');

    expect(within(preview()).getByText('Iman M.')).toBeInTheDocument();
    // The ask bar is the Ask tab's.
    await userEvent.click(within(screen.getByRole('tablist', { name: 'Preview tab' })).getByRole('tab', { name: 'Ask' }));
    expect(within(preview()).getByText(/Ask Iman M\. anything/)).toBeInTheDocument();
  });

  // A link edit must reach the preview from local state, on every keystroke,
  // independent of whether the save behind it ever resolves. `updateLink`
  // never resolving is what proves that.
  it('shows a link label change in the live preview immediately, before the save resolves', async () => {
    const stuck = api();
    stuck.updateLink = vi.fn(() => new Promise<never>(() => {}));
    show(initial, stuck);

    await userEvent.click(editTab('Links'));
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Edit Portfolio' }));
    await userEvent.type(within(row).getByLabelText('Name'), '!');

    expect(within(preview()).getByText('Portfolio!')).toBeInTheDocument();
  });

  it('restyles the preview the moment a style is chosen', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: /^High contrast/ }));
    expect(preview().querySelector('[data-style]')).toHaveAttribute('data-style', 'CONTRAST');
  });
});

describe('the header', () => {
  it('says Saved, then Saving… while a save is out, then Saved again', async () => {
    let finish!: () => void;
    const calls = api();
    calls.chooseStockCover = vi.fn(
      (name: string) => new Promise((resolve) => { finish = () => resolve({ coverKey: `stock/${name}`, coverUrl: `/covers/${name}.webp` }); }),
    );
    show(initial, calls);
    expect(within(header()).getByText('Saved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    expect(within(header()).getByText('Saving…')).toBeInTheDocument();

    await act(async () => finish());
    expect(within(header()).getByText('Saved')).toBeInTheDocument();
  });

  it('says Not saved after a save fails, until the next one lands', async () => {
    const calls = api();
    calls.chooseStockCover = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ coverKey: 'stock/teh', coverUrl: '/covers/teh.webp' });
    show(initial, calls);

    await userEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    expect(await within(header()).findByText('Not saved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Tea and flowers' }));
    expect(await within(header()).findByText('Saved')).toBeInTheDocument();
  });

  it("copies the page's full address", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe('https://curios.my/imnmuqri');
    expect(screen.getByText('Link copied')).toBeInTheDocument();
  });

  it('opens the page itself from View page', () => {
    show();
    expect(screen.getByRole('link', { name: 'View page' })).toHaveAttribute('href', '/imnmuqri');
  });
});

describe('the tabs', () => {
  it('shows one part at a time, Profile first, with the look in it', async () => {
    show();
    expect(editTab('Profile')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Display name')).toBeVisible();
    // Profile and Appearance are one tab now (Dashboard v2): the look sits under You and the cover.
    expect(screen.getByRole('button', { name: /^High contrast/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fraunces' })).toBeVisible();
    // The Links panel is hidden, so its controls are out of the accessibility tree.
    expect(screen.queryByRole('button', { name: '+ Add link' })).toBeNull();

    await userEvent.click(editTab('Links'));
    expect(screen.getByRole('button', { name: '+ Add link' })).toBeVisible();
    expect(screen.getByLabelText('Display name')).not.toBeVisible();
  });

  it('has just the two tabs, Profile and Links', () => {
    show();
    expect(within(screen.getByRole('tablist', { name: 'Edit' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Profile', 'Links']);
  });

  it('moves between parts with the arrow keys, Home and End, as a tab list does', async () => {
    show();
    editTab('Profile').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(editTab('Links')).toHaveFocus();
    expect(editTab('Links')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(editTab('Links')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(editTab('Profile')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(editTab('Links')).toHaveFocus();
  });

  // A hidden part keeps its state, so a name typed a moment ago still saves after switching away.
  it('keeps a part mounted while another is shown', async () => {
    show();
    await userEvent.type(screen.getByLabelText('Display name'), '!');
    await userEvent.click(editTab('Links'));
    await userEvent.click(editTab('Profile'));
    expect(screen.getByLabelText('Display name')).toHaveValue(`${initial.displayName}!`);
  });
});

describe('the preview tabs', () => {
  const previewTabs = () => within(screen.getByRole('tablist', { name: 'Preview tab' }));

  it('ends the Links tab with People often ask, from the page’s real questions, and has no ask bar there', async () => {
    const faq = {
      total: 5,
      entries: [
        { slug: 'klang', question: 'Do you deliver to Klang?', answer: 'Yes, RM15.' },
        { slug: 'halal', question: 'Is it halal?', answer: 'Yes.' },
      ],
    };
    show({ ...business, faq });
    expect(within(preview()).getByText('People often ask')).toBeInTheDocument();
    expect(within(preview()).getByText('See all 5')).toBeInTheDocument();
    expect(within(preview()).getByText('Do you deliver to Klang?')).toBeInTheDocument();
    expect(within(preview()).queryByText(/Ask .* anything/)).toBeNull();
    await userEvent.click(previewTabs().getByRole('tab', { name: 'Ask' }));
    expect(within(preview()).getByText(/Ask Iman Muqri anything/)).toBeInTheDocument();
    // The page folds the FAQ away on Ask, as it does for visitors.
    expect(preview().querySelector('[data-bento-page]')).toHaveAttribute('data-mode', 'chat');
  });

  it('has no People often ask while the page has no answered questions', () => {
    show(business);
    expect(within(preview()).queryByText('People often ask')).toBeNull();
  });

  it('offers Links and Ask only, the shop open or not', () => {
    show(business);
    expect(previewTabs().getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Links', 'Ask']);
  });

  it('the preview switch has no Shop tab while the shop is open', () => {
    show({ ...business, shopTab: { open: true, itemCount: 2, preview: [] }, shop: { position: 1, size: null, itemCount: 2, photoKey: null, photos: [] } });
    expect(previewTabs().getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Links', 'Ask']);
    expect(previewTabs().queryByRole('tab', { name: 'Shop' })).toBeNull();
  });

  it('draws no shop pill while the shop is open with nothing for sale', () => {
    show({ ...business, shopTab: { open: true, itemCount: 0, preview: [] }, shop: { position: 1, size: null, itemCount: 0, photoKey: null, photos: [] } });
    expect(within(preview()).queryByText('0 items')).toBeNull();
  });

  it('shows the shop pill on the Links preview while the shop is open', () => {
    show({ ...business, shopTab: { open: true, itemCount: 2, preview: [] }, shop: { position: 1, size: null, itemCount: 2, photoKey: null, photos: [] } });
    expect(within(preview()).getByText('2 items')).toBeInTheDocument();
    expect(within(preview()).queryByRole('link')).toBeNull();
  });

  it('shows a real question on the Ask tab, and the page’s real answer only when tapped', async () => {
    const { calls } = show();
    await userEvent.click(previewTabs().getByRole('tab', { name: 'Ask' }));

    expect(within(preview()).getByText('Do you deliver to Klang?')).toBeInTheDocument();
    expect(calls.askPage).not.toHaveBeenCalled();

    await userEvent.click(within(preview()).getByRole('button', { name: 'Tap to hear what your page says' }));
    expect(calls.askPage).toHaveBeenCalledWith('Do you deliver to Klang?');
    expect(await within(preview()).findByText('Yes, delivery to Klang is RM15.')).toBeInTheDocument();
  });

  it('shows the page’s answer as plain text under "{Name}’s page"', async () => {
    show();
    await userEvent.click(previewTabs().getByRole('tab', { name: 'Ask' }));
    await userEvent.click(within(preview()).getByRole('button', { name: 'Tap to hear what your page says' }));
    const answer = await within(preview()).findByText('Yes, delivery to Klang is RM15.');
    expect(answer.previousElementSibling).toHaveTextContent(`${initial.displayName}’s page`);
  });

  it('draws the page on the tab chosen, as boxes not links', async () => {
    show({ ...business, shopTab: { open: true, itemCount: 2, preview: [] }, shop: { position: 1, size: null, itemCount: 2, photoKey: null, photos: [] } });
    const page = preview().querySelector('[data-bento-page]');
    expect(page).not.toHaveAttribute('data-mode');

    await userEvent.click(previewTabs().getByRole('tab', { name: 'Ask' }));
    expect(page).toHaveAttribute('data-mode', 'chat');
    expect(within(preview()).getByText('Do you deliver to Klang?')).toBeInTheDocument();

    await userEvent.click(previewTabs().getByRole('tab', { name: 'Links' }));
    expect(page).not.toHaveAttribute('data-mode');
    expect(within(preview()).queryByRole('link')).toBeNull();
  });

  it('says where links will show on a page with none', () => {
    show({ ...initial, links: [] });
    expect(within(preview()).getByText('Your links show here')).toBeInTheDocument();
  });
});

describe('the Shop link switch', () => {
  it('is not offered on a personal page', async () => {
    show();
    await userEvent.click(editTab('Links'));
    expect(screen.queryByRole('switch', { name: 'Show the Shop link' })).toBeNull();
  });

  it('opens the shop, and the preview gains the shop pill, not a tab', async () => {
    const { calls } = show(business);
    await userEvent.click(editTab('Links'));
    expect(screen.getByText(/Always first in your links, 2 items/)).toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: 'Show the Shop link' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);

    expect(calls.setShopOpen).toHaveBeenCalledWith(true);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(within(screen.getByRole('tablist', { name: 'Preview tab' })).queryByRole('tab', { name: 'Shop' })).toBeNull();
    expect(within(preview()).getByText('2 items')).toBeInTheDocument();
  });

  it('stays off and says why when the shop cannot open', async () => {
    const calls = api();
    calls.setShopOpen = vi.fn(async () => { throw new Error('Add a way to be paid before opening your shop.'); });
    show(business, calls);
    await userEvent.click(editTab('Links'));
    await userEvent.click(screen.getByRole('switch', { name: 'Show the Shop link' }));

    expect(screen.getByRole('switch', { name: 'Show the Shop link' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('alert')).toHaveTextContent('Add a way to be paid before opening your shop.');
  });

  it('closing the shop takes the pill off the preview', async () => {
    show({ ...business, shopTab: { open: true, itemCount: 2, preview: [] }, shop: { position: 1, size: null, itemCount: 2, photoKey: null, photos: [] } });
    expect(within(preview()).getByText('2 items')).toBeInTheDocument();
    await userEvent.click(editTab('Links'));
    await userEvent.click(screen.getByRole('switch', { name: 'Show the Shop link' }));

    expect(within(preview()).queryByText('2 items')).toBeNull();
  });
});

describe('social profiles', () => {
  it('saves a profile once typing stops, and the preview shows its icon', async () => {
    vi.useFakeTimers();
    const { calls } = show();
    fireEvent.click(editTab('Links'));
    fireEvent.change(screen.getByLabelText('Instagram'), { target: { value: '@KekLina' } });

    expect(within(preview()).getByLabelText('Instagram')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(calls.saveAppearance).toHaveBeenCalledWith({ socials: { instagram: 'keklina' } });
  });

  it('settles a pasted profile link into its handle', () => {
    show();
    fireEvent.click(editTab('Links'));
    const field = screen.getByLabelText('TikTok');
    fireEvent.change(field, { target: { value: 'https://www.tiktok.com/@keklina.bakes' } });
    fireEvent.blur(field);
    expect(field).toHaveValue('keklina.bakes');
  });

  it('says so, on leaving the field, when it cannot be read, and sends nothing', async () => {
    vi.useFakeTimers();
    const { calls } = show();
    fireEvent.click(editTab('Links'));
    const field = screen.getByLabelText('WhatsApp');
    fireEvent.change(field, { target: { value: '12345' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.blur(field);
    expect(screen.getByRole('alert')).toHaveTextContent('That doesn’t look like a WhatsApp number.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(calls.saveAppearance).not.toHaveBeenCalled();
  });

  it('clears a profile when its field is emptied', async () => {
    vi.useFakeTimers();
    const { calls } = show({ ...initial, socials: [{ kind: 'email', value: 'iman@example.com' }] });
    fireEvent.click(editTab('Links'));
    expect(within(preview()).getByLabelText('Email')).toBeInTheDocument();

    // The preview's icon is labelled Email too; the field is the one in the Links panel.
    fireEvent.change(within(screen.getByRole('tabpanel', { name: 'Links' })).getByLabelText('Email'), { target: { value: '' } });
    expect(within(preview()).queryByLabelText('Email')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(calls.saveAppearance).toHaveBeenCalledWith({ socials: { email: '' } });
  });
});

// The preview reuses BentoPage, which fills the screen on the public page
// (min-height: 100vh). jsdom has no layout, so this pins what makes it fit
// the phone: BentoPage's root is the scroller's direct child, and the
// stylesheet undoes the full-screen height, margin and rounding for it.
describe('the live preview fits its phone', () => {
  it('renders BentoPage inside the phone, at the page’s own address', () => {
    show();
    expect(preview().querySelector('[data-bento-page]')).not.toBeNull();
    expect(preview().textContent).toContain(`curios.my/${initial.handle}`);
  });

  it('fills the phone without forcing its own screen height, margin or rounding', () => {
    const css = readFileSync(join(import.meta.dirname, '../_ui/editor.module.css'), 'utf8');
    expect(css).toMatch(/\.scroll > \[data-bento-page\]\s*\{[^}]*min-height:\s*100%/);
    expect(css).toMatch(/\.scroll > \[data-bento-page\]\s*\{[^}]*margin:\s*0;/);
    expect(css).toMatch(/\.scroll > \[data-bento-page\]\s*\{[^}]*border-radius:\s*0;/);
  });
});

describe('without the template look', () => {
  it('has no gradient blobs in the preview panel', () => {
    show();
    expect(document.querySelector('[class*="blob"]')).toBeNull();
  });

  it('titles its sections with text only', async () => {
    show();
    await userEvent.click(editTab('Links'));
    expect(screen.getByRole('heading', { name: 'Links' }).querySelector('svg')).toBeNull();
  });

  // The v3 board brings the kind tile back on link rows and the Shop link row (.ri .ki, .shoprow .ki).
  it('marks each link row with its kind, read off the address, and the Shop link as the first row', async () => {
    show({ ...business, links: [...initial.links, { id: 'w', label: 'WhatsApp', url: 'https://wa.me/60123456789', size: null }] });
    await userEvent.click(editTab('Links'));
    const kinds = [...document.querySelectorAll('[data-kind]')].filter((el) => el.tagName === 'SPAN' && el.closest('[role="tabpanel"]'));
    expect(kinds.map((el) => el.getAttribute('data-kind'))).toEqual(['shop', 'link', 'whatsapp']);
    // The shop row sits above the list, in the same box.
    const shop = screen.getByRole('group', { name: 'Shop link' });
    expect(shop.nextElementSibling?.tagName).toBe('UL');
  });
});
