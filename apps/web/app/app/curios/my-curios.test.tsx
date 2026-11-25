import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyCuriosEditor, positionsAfterAdd, positionsAfterRemoval, type EditorPage } from './my-curios.js';
import { SaveStatusProvider, SaveStatusSlot } from '../_ui/save-status.js';

const initial: EditorPage = {
  id: 'p1', faqPosition: null, handle: 'imnmuqri', displayName: 'Iman Muqri', bio: null, avatarUrl: null,
  style: 'SOFT', secondaryColor: null, coverWash: true, layout: 'LIST' as const, accentColor: '#2340c8', headingFont: 'JAKARTA', avatarKey: null, avatarSize: 'MEDIUM', avatarBorder: true, coverLayout: 'TOP',
  coverKey: null, coverUrl: null, background: 'PAPER', backgroundColor: null, language: 'en',
  socials: [], shop: null, shopTab: null, shopItems: [], previewQuestion: 'Do you deliver to Klang?',
  links: [{ id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null, kind: 'LINK', provider: null, embedRef: null }],
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
  addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', label: i.label, url: `https://${i.url}`, size: null, kind: 'LINK' as const, provider: null, embedRef: null })),
  addWidget: vi.fn(async (i: { url: string; label: string | null }) => ({ id: 'w', label: i.label ?? 'Spotify', url: i.url, size: null, kind: 'WIDGET' as const, provider: 'SPOTIFY' as const, embedRef: 'track/x' })),
  updateLink: vi.fn(async (_id: string, p: object) => ({ ...initial.links[0]!, ...p })),
  removeLink: vi.fn(async () => undefined),
  reorder: vi.fn(async () => undefined),
  setShopOpen: vi.fn(async () => undefined),
  setShopSize: vi.fn(async () => undefined),
  saveAppearance: vi.fn(async () => undefined),
  uploadAvatar: vi.fn(async () => null),
  removeAvatar: vi.fn(async () => undefined),
  chooseStockCover: vi.fn(async (name: string) => ({ coverKey: `stock/${name}`, coverUrl: `/covers/${name}.webp` })),
  uploadCover: vi.fn(async () => ({ coverKey: 'covers/p1/a.webp', coverUrl: null })),
  removeCover: vi.fn(async () => undefined),
  askPage: vi.fn(async (_q: string) => ({ reply: 'Yes, delivery to Klang is RM15.' })),
});

const show = (page: EditorPage = initial, calls = api()) => {
  const view = render(
    <SaveStatusProvider>
      <div data-testid="top-bar"><SaveStatusSlot /></div>
      <MyCuriosEditor initial={page} api={calls} uploadsEnabled={false} publicUrl="https://curios.my/imnmuqri" />
    </SaveStatusProvider>,
  );
  return { ...view, calls };
};
const preview = () => screen.getByRole('region', { name: 'Live preview' });
/** The editor's own tabs; the preview has a Links tab of its own. */
const editTab = (name: string) => within(screen.getByRole('tablist', { name: 'Edit' })).getByRole('tab', { name });
/** The editor's header bar; the page in the phone has a header too. */
const header = () => screen.getByRole('heading', { name: 'My Curios' }).closest('header')!;
/** Where the frame draws "Saved": its top bar, not the page's header. */
const topBar = () => screen.getByTestId('top-bar');

afterEach(() => {
  vi.useRealTimers();
});

describe('MyCuriosEditor', () => {
  it('sends a pasted widget link through the editor to the API and lists it', async () => {
    const { calls } = show();
    await userEvent.click(editTab('Links'));
    const panel = within(screen.getByRole('tabpanel', { name: 'Links' }));
    await userEvent.click(panel.getByRole('button', { name: '+ Add a widget' }));
    await userEvent.type(panel.getByLabelText('Widget link'), 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    await userEvent.click(panel.getByRole('button', { name: 'Add' }));
    expect(calls.addWidget).toHaveBeenCalledWith({ url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', label: null });
    expect(await panel.findByRole('listitem', { name: 'Spotify' })).toBeInTheDocument();
  });

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

describe('the header and preview note', () => {
  it('shows the kicker, the sentence, the address and the Profile / Links tabs under the header', () => {
    show();
    expect(within(header()).getByText('Your page')).toBeInTheDocument();
    expect(within(header()).getByText('How your page looks to everyone who taps your link.')).toBeInTheDocument();
    expect(within(header()).getByRole('link', { name: 'View page' })).toBeInTheDocument();
    expect(within(header()).getByRole('tablist', { name: 'Edit' })).toBeInTheDocument();
  });

  it('says what the phone shows', () => {
    show();
    expect(within(preview()).getByText('This is what people see. It changes as you edit.')).toBeInTheDocument();
  });
});

describe('the save status', () => {
  it('leaves the page header to the title, the tabs and the address: Saved is in the top bar', () => {
    show();
    expect(within(topBar()).getByText('Saved')).toBeInTheDocument();
    expect(within(header()).queryByText('Saved')).toBeNull();
  });

  it('says Saved, then Saving… while a save is out, then Saved again', async () => {
    let finish!: () => void;
    const calls = api();
    calls.chooseStockCover = vi.fn(
      (name: string) => new Promise((resolve) => { finish = () => resolve({ coverKey: `stock/${name}`, coverUrl: `/covers/${name}.webp` }); }),
    );
    show(initial, calls);
    expect(within(topBar()).getByText('Saved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Flowers' }));
    expect(within(topBar()).getByText('Saving…')).toBeInTheDocument();

    await act(async () => finish());
    expect(within(topBar()).getByText('Saved')).toBeInTheDocument();
  });

  it('says Not saved after a save fails, until the next one lands', async () => {
    const calls = api();
    calls.chooseStockCover = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ coverKey: 'stock/bunga', coverUrl: '/covers/bunga.webp' });
    show(initial, calls);

    await userEvent.click(screen.getByRole('button', { name: 'Flowers' }));
    expect(await within(topBar()).findByText('Not saved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Flowers' }));
    expect(await within(topBar()).findByText('Saved')).toBeInTheDocument();
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

  it('has the tabs Profile, Links and Layout', () => {
    show();
    expect(within(screen.getByRole('tablist', { name: 'Edit' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Profile', 'Links', 'Layout']);
  });

  it('moves between parts with the arrow keys, Home and End, as a tab list does', async () => {
    show();
    editTab('Profile').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(editTab('Links')).toHaveFocus();
    expect(editTab('Links')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(editTab('Layout')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(editTab('Profile')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(editTab('Layout')).toHaveFocus();
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

  it('draws no shop pill without the shop tile, as on the public page', async () => {
    show({ ...business, shopTab: { open: true, itemCount: 2, preview: [] }, shop: null });
    expect(within(preview()).queryByText('2 items')).toBeNull();
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
    show({ ...business, links: [...initial.links, { id: 'w', label: 'WhatsApp', url: 'https://wa.me/60123456789', size: null, kind: 'LINK', provider: null, embedRef: null }] });
    await userEvent.click(editTab('Links'));
    const kinds = [...document.querySelectorAll('#panel-links [data-kind]')].filter((el) => el.tagName === 'SPAN');
    expect(kinds.map((el) => el.getAttribute('data-kind'))).toEqual(['shop', 'link', 'whatsapp']);
    // The shop row sits above the list, in the same box.
    const shop = screen.getByRole('group', { name: 'Shop link' });
    expect(shop.nextElementSibling?.tagName).toBe('UL');
  });
});

describe('the Layout tab', () => {
  const two: EditorPage = {
    ...business,
    shopTab: { open: true, itemCount: 2, preview: [] },
    shop: { position: 1, size: null, itemCount: 2, photoKey: null, photos: [] },
    faqPosition: null,
    links: [
      { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null, kind: 'LINK', provider: null, embedRef: null },
      { id: 'b', label: 'Cafe menu', url: 'https://cafe.dev', size: null, kind: 'LINK', provider: null, embedRef: null },
    ],
  };
  const layout = () => within(screen.getByRole('tabpanel', { name: 'Layout' }));
  const before = (first: string, second: string) =>
    Boolean(within(preview()).getByText(first).compareDocumentPosition(within(preview()).getByText(second)) & Node.DOCUMENT_POSITION_FOLLOWING);

  async function liftDown(name: string) {
    await userEvent.click(editTab('Layout'));
    const row = layout().getByRole('listitem', { name });
    row.focus();
    fireEvent.keyDown(row, { key: ' ' });
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(row, { key: ' ' });
    });
  }

  it('lists the links, the shop and People often ask, and sends them all, reordered, in one save', async () => {
    const { calls } = show(two);
    await userEvent.click(editTab('Layout'));
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Portfolio', 'Shop', 'Cafe menu', 'People often ask']);
    await liftDown('Portfolio');
    expect(calls.reorder).toHaveBeenCalledTimes(1);
    expect(calls.reorder).toHaveBeenCalledWith(['shop', 'a', 'b', 'faq']);
  });

  it('moves the preview as soon as a row is dropped', async () => {
    show(two);
    expect(before('Portfolio', 'Cafe menu')).toBe(true);
    await userEvent.click(editTab('Layout'));
    const row = layout().getByRole('listitem', { name: 'Portfolio' });
    row.focus();
    fireEvent.keyDown(row, { key: ' ' });
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(row, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(row, { key: ' ' });
    });
    expect(before('Cafe menu', 'Portfolio')).toBe(true);
  });

  it('puts the preview back and shows the error when the save fails', async () => {
    const calls = api();
    calls.reorder = vi.fn(async () => {
      throw new Error('Your links changed somewhere else.');
    });
    show(two, calls);
    await userEvent.click(editTab('Layout'));
    const row = layout().getByRole('listitem', { name: 'Portfolio' });
    row.focus();
    fireEvent.keyDown(row, { key: ' ' });
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(row, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(row, { key: ' ' });
    });
    expect(before('Portfolio', 'Cafe menu')).toBe(true);
    expect(layout().getByRole('alert')).toHaveTextContent('changed somewhere else');
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Portfolio', 'Shop', 'Cafe menu', 'People often ask']);
  });

  it('moves the shop up when a link above it is removed, in the preview and in Layout', async () => {
    const calls = api();
    show(two, calls);
    await userEvent.click(editTab('Links'));
    const row = within(screen.getByRole('tabpanel', { name: 'Links' })).getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove Portfolio' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    expect(calls.removeLink).toHaveBeenCalledWith('a');
    await userEvent.click(editTab('Layout'));
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Shop', 'Cafe menu', 'People often ask']);
    const shopPill = within(preview()).getByText('Shop');
    expect(Boolean(shopPill.compareDocumentPosition(within(preview()).getByText('Cafe menu')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('keeps People often ask last, and the shop where it was, when a link after them is removed', async () => {
    show({ ...two, shop: { ...two.shop!, position: 0 } }, api());
    await userEvent.click(editTab('Links'));
    const row = within(screen.getByRole('tabpanel', { name: 'Links' })).getByRole('listitem', { name: 'Cafe menu' });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove Cafe menu' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    await userEvent.click(editTab('Layout'));
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Shop', 'Portfolio', 'People often ask']);
  });

  it('adds a link at the end of the links, leaving a shop between two links where it is', async () => {
    show(two, api());
    await userEvent.click(editTab('Layout'));
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Portfolio', 'Shop', 'Cafe menu', 'People often ask']);
    await userEvent.click(editTab('Links'));
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    const panel = within(screen.getByRole('tabpanel', { name: 'Links' }));
    await userEvent.type(panel.getByLabelText('Name'), 'Newest');
    await userEvent.type(panel.getByLabelText('Address'), 'new.dev');
    await userEvent.click(panel.getByRole('button', { name: 'Add' }));
    await userEvent.click(editTab('Layout'));
    // The shop sat between the two links, so it stays there; the new link joins the end.
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Portfolio', 'Shop', 'Cafe menu', 'Newest', 'People often ask']);
  });

  it('puts the shop first when it opens', async () => {
    show({ ...business, links: two.links }, api());
    await userEvent.click(editTab('Links'));
    await userEvent.click(screen.getByRole('switch', { name: 'Show the Shop link' }));
    await userEvent.click(editTab('Layout'));
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))[0]).toBe('Shop');
  });

  it('works out where the tiles go after an add, the way the API does', () => {
    expect(positionsAfterAdd(2, 2, null)).toEqual({ shop: 3, faq: null });
    expect(positionsAfterAdd(2, 1, null)).toEqual({ shop: 1, faq: null });
    expect(positionsAfterAdd(0, 0, null)).toEqual({ shop: 0, faq: null });
    expect(positionsAfterAdd(0, 0, 1)).toEqual({ shop: 0, faq: 1 });
    expect(positionsAfterAdd(2, null, 2)).toEqual({ faq: 3, shop: null });
    expect(positionsAfterAdd(2, 2, 3)).toEqual({ shop: 3, faq: 4 });
    expect(positionsAfterAdd(1, 0, null)).toEqual({ shop: 0, faq: null });
    expect(positionsAfterAdd(3, null, null)).toEqual({ shop: null, faq: null });
  });

  it('works out the positions the way the API does', () => {
    expect(positionsAfterRemoval(0, 1, null)).toEqual({ shop: 0, faq: null });
    expect(positionsAfterRemoval(0, 1, 2)).toEqual({ shop: 0, faq: 1 });
    expect(positionsAfterRemoval(1, 0, 2)).toEqual({ shop: 0, faq: 2 });
    expect(positionsAfterRemoval(2, 0, 2)).toEqual({ shop: 0, faq: 2 });
    expect(positionsAfterRemoval(0, 0, 3)).toEqual({ shop: 0, faq: 2 });
  });

  it('stores the FAQ as last when it is dragged last, so a link added afterwards lands above it', async () => {
    const calls = api();
    show({ ...two, shop: { ...two.shop!, position: 0 }, faqPosition: 1 }, calls);
    await userEvent.click(editTab('Layout'));
    const row = layout().getByRole('listitem', { name: 'People often ask' });
    row.focus();
    fireEvent.keyDown(row, { key: ' ' });
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(row, { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(row, { key: ' ' });
    });
    expect(calls.reorder).toHaveBeenCalledWith(['shop', 'a', 'b', 'faq']);
    await userEvent.click(editTab('Links'));
    await userEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    const links = within(screen.getByRole('tabpanel', { name: 'Links' }));
    await userEvent.type(links.getByLabelText('Name'), 'Newest');
    await userEvent.type(links.getByLabelText('Address'), 'new.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(editTab('Layout'));
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Shop', 'Portfolio', 'Cafe menu', 'Newest', 'People often ask']);
  });

  it('has no People often ask or Shop row on a personal page', async () => {
    show();
    await userEvent.click(editTab('Layout'));
    expect(layout().getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Portfolio']);
  });

  it('dims People often ask on a business page without answers', async () => {
    show(two);
    await userEvent.click(editTab('Layout'));
    expect(layout().getByRole('listitem', { name: 'People often ask' })).toHaveTextContent('Shows once you answer questions');
  });
});

describe('the address row', () => {
  it('uses the My Curios modifiers so the pill stays on a phone and both are 44px', async () => {
    show();
    const link = within(header()).getByRole('link', { name: 'View page' });
    const pill = within(header()).getByText(/curios\.my\//);
    expect(pill.className).toMatch(/addrPill/);
    expect(link.className).toMatch(/viewLink/);
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(join(import.meta.dirname, 'curios.module.css'), 'utf8');
    expect(css).toMatch(/\.addr \.addrPill\s*{[^}]*display:\s*flex;[^}]*height:\s*44px/);
    expect(css).toMatch(/\.addr \.viewLink\s*{[^}]*height:\s*44px/);
  });
});

describe('the preview follows the page cover layout', () => {
  it('anchors a Full-page cover to the page inside the phone', () => {
    const css = readFileSync(join(import.meta.dirname, '../_ui/editor.module.css'), 'utf8');
    expect(css).toMatch(/\.scroll > \[data-bento-page\]\[data-cover-layout='FULL'\]\s*\{\s*position:\s*relative;/);
  });
});

describe('the Layout tab, List or Bento', () => {
  const layoutPanel = () => within(screen.getByRole('tabpanel', { name: 'Layout' }));
  const grid = () => preview().querySelector('[data-bento-grid]');

  it('switches the preview to Bento at once and saves the layout', async () => {
    const { calls } = show();
    await userEvent.click(editTab('Layout'));
    expect(grid()).toBeNull();
    await userEvent.click(layoutPanel().getByRole('radio', { name: 'Bento' }));
    expect(calls.saveAppearance).toHaveBeenCalledWith({ layout: 'BENTO' });
    expect(grid()).not.toBeNull();
  });

  it('puts the layout back when the save is refused', async () => {
    const calls = api();
    calls.saveAppearance.mockRejectedValueOnce(new Error('Nope'));
    show(initial, calls);
    await userEvent.click(editTab('Layout'));
    await userEvent.click(layoutPanel().getByRole('radio', { name: 'Bento' }));
    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(grid()).toBeNull();
  });

  it('saves a link size through the link API, shows it, and reverts on failure', async () => {
    const calls = api();
    show({ ...initial, layout: 'BENTO' }, calls);
    await userEvent.click(editTab('Layout'));
    await userEvent.click(within(layoutPanel().getByRole('radiogroup', { name: 'Size of Portfolio' })).getByRole('radio', { name: 'Big' }));
    expect(calls.updateLink).toHaveBeenCalledWith('a', { size: 'BIG' });
    expect(grid()!.firstElementChild).toHaveAttribute('data-size', 'BIG');

    calls.updateLink.mockRejectedValueOnce(new Error('Nope'));
    await userEvent.click(within(layoutPanel().getByRole('radiogroup', { name: 'Size of Portfolio' })).getByRole('radio', { name: 'Wide' }));
    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(grid()!.firstElementChild).toHaveAttribute('data-size', 'BIG');
  });

  it('saves the shop button size to the store settings', async () => {
    const calls = api();
    show({ ...business, layout: 'BENTO', shop: { position: 0, size: null, itemCount: 2, photoKey: null, photos: [] }, shopTab: { ...business.shopTab!, open: true } }, calls);
    await userEvent.click(editTab('Layout'));
    await userEvent.click(within(layoutPanel().getByRole('radiogroup', { name: 'Size of Shop' })).getByRole('radio', { name: 'Wide' }));
    expect(calls.setShopSize).toHaveBeenCalledWith('WIDE');
  });
});
