import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { writeBasket } from '../../[handle]/shop/basket.js';
import { StoreEditor } from './store-editor.js';
import { SaveStatusProvider, SaveStatusSlot } from '../_ui/save-status.js';
import type { OwnerVoucher } from '@curios/core/vouchers';
import type { ItemStats } from '@curios/db-read';
import { PHYSICAL_ITEM, PHYSICAL_ROW, previewItem, type ChipApi, type ChipState, type EditorItem, type ItemRow, type ItemsApi, type PickupApi, type SettingsApi, type SettingsPatch, type ShopLook, type StoreSettings, type VouchersApi } from './store-types.js';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const ready: StoreSettings = {
  enabled: true, shopName: null, shopDescription: 'Homemade cakes.', shopHalal: false, pickupEnabled: true, pickupNote: 'Seksyen 7', deliveryMode: 'FLAT',
  deliveryFeeCents: 1000, minNoticeDays: 2, closedDays: [], deliveryNote: null, paymentQrKey: null, bankName: 'Maybank',
  bankAccountName: 'Lina', bankAccountNumber: '1234567890', tileSize: null,
};

const base = { ...PHYSICAL_ITEM, slug: 'x', category: null, tag: null, sku: null, description: null, photoKey: null, photoUrl: null, options: [] };
const items: EditorItem[] = [
  { ...base, id: 'a', name: 'Kek batik', priceCents: 4500, available: true },
  { ...base, id: 'b', name: 'Burnt cheesecake', priceCents: 8500, available: false },
];

const look: ShopLook = {
  handle: 'keklina', displayName: 'Kek Lina', bio: null, language: 'en', avatarUrl: null, coverUrl: null,
  style: 'SOFT', accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null, socials: [], whatsapp: '60123456789',
};

function apis(save?: (patch: SettingsPatch) => Promise<StoreSettings>) {
  const settingsApi: SettingsApi = {
    save: vi.fn(save ?? (async (patch: SettingsPatch) => ({ ...ready, ...patch }))),
    uploadQr: vi.fn(async () => 'https://files.example/qr.png'),
    removeQr: vi.fn(async () => undefined),
  };
  const itemsApi: ItemsApi = {
    add: vi.fn(),
    update: vi.fn(async (id, patch) => ({ ...PHYSICAL_ROW, id, name: 'Kek batik', slug: 'kek-batik', category: null, tag: null, sku: null, description: null, photoKey: null, priceCents: 4500, options: [], available: patch.available ?? true })),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    addPhoto: vi.fn(),
    recropPhoto: vi.fn(),
    replacePhoto: vi.fn(),
    removePhoto: vi.fn(),
    reorderPhotos: vi.fn(),
    photoUrl: vi.fn((key: string) => `https://files.example/${key}`),
    originalUrl: vi.fn(),
    uploadFile: vi.fn(),
    removeFile: vi.fn(),
    addCodes: vi.fn(),
    addSession: vi.fn(),
    updateSession: vi.fn(),
    removeSession: vi.fn(),
  };
  const chipApi: ChipApi = { connect: vi.fn(), disconnect: vi.fn(async () => undefined), test: vi.fn() };
  const vouchersApi: VouchersApi = { add: vi.fn(), update: vi.fn(), remove: vi.fn(async () => undefined) };
  const pickupApi: PickupApi = { list: vi.fn(), add: vi.fn(), save: vi.fn(), remove: vi.fn(), reorder: vi.fn() };
  return { settingsApi, itemsApi, chipApi, vouchersApi, pickupApi };
}


const noChip: ChipState = { connected: false, brandName: null, methods: [], checkedAt: null, isTest: false };
const chipOn: ChipState = { connected: true, brandName: 'Kek Lina Bakes', methods: ['fpx'], checkedAt: new Date('2026-10-16T01:00:00Z'), isTest: false };
const NOW = new Date('2026-10-16T02:00:00Z');

/** The owner's one pickup place, which the shop preview's sign names. */
const places = [{ id: 'p1', name: 'Seksyen 7', address: 'Seksyen 7, Shah Alam', mapUrl: null, note: null, anyTime: true, windows: [] }];

const TOP = (
  <div data-testid="top-bar"><SaveStatusSlot /></div>
);

/** The Store itself: its header, tabs, ready box and cards. */
function show(settings: StoreSettings = ready, list = items, calls = apis(), orders = { paused: null as string | null, nextNumber: 13 }, chip = noChip, stats: Record<string, ItemStats> = {}) {
  render(
    <SaveStatusProvider>
      {TOP}
      <StoreEditor initial={settings} items={list} stats={stats} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={chip} orders={orders} pickupPlaces={places} {...calls} />
    </SaveStatusProvider>,
  );
  return calls;
}

/** One item on its own screen (`editingId` an id, or 'new'), with the phone beside it. */
function showItem(settings: StoreSettings = ready, list = items, calls = apis(), orders = { paused: null as string | null, nextNumber: 13 }, chip = noChip, editingId = 'a', vouchers: OwnerVoucher[] = [], lookOver: Partial<ShopLook> = {}) {
  render(
    <SaveStatusProvider>
      {TOP}
      <StoreEditor initial={settings} items={list} look={{ ...look, ...lookOver }} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={chip} orders={orders} pickupPlaces={places} vouchers={vouchers} editingId={editingId} {...calls} />
    </SaveStatusProvider>,
  );
  return calls;
}

const header = () => screen.getByRole('heading', { name: 'Store' }).closest('header')!;
const preview = () => screen.getByRole('region', { name: 'Live preview of your shop' });
const editTab = (name: string | RegExp) => within(screen.getByRole('tablist', { name: 'Store' })).getByRole('tab', { name });
const screenTab = (name: string) => within(screen.getByRole('tablist', { name: 'Preview screen' })).getByRole('tab', { name });
const readyBox = () => screen.getByRole('switch', { name: 'Shop open' }).closest('div')!.parentElement!;

beforeEach(() => {
  window.sessionStorage.clear();
  nav.push.mockClear();
  nav.refresh.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('opening on a tab', () => {
  it('opens on the discounts tab when the link says vouchers, and has no phone', () => {
    render(<StoreEditor initial={ready} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} initialTab="vouchers" {...apis()} />);
    expect(editTab(/^Discounts/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Vouchers' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Live preview of your shop' })).toBeNull();
  });

  it('opens on Payment when the link says so, and on Items otherwise', () => {
    const calls = apis();
    const { unmount } = render(<StoreEditor initial={ready} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} initialTab="payment" {...calls} />);
    expect(editTab('Payment')).toHaveAttribute('aria-selected', 'true');
    unmount();
    show();
    expect(editTab(/^Items/)).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the header', () => {
  it('says "Your shop" over the title, and links to the shop and to a new item', () => {
    show();
    expect(within(header()).getByText('Your shop')).toBeInTheDocument();
    expect(within(header()).getByText('What you sell, how people pay, and how it reaches them.')).toBeInTheDocument();
    expect(within(header()).getByRole('link', { name: 'See your shop' })).toHaveAttribute('href', '/keklina/shop');
    expect(within(header()).getByRole('link', { name: '+ Add item' })).toHaveAttribute('href', '/app/store/items/new');
    // The address is gone from the header (v3 board hides it): See your shop opens it.
    expect(within(header()).queryByText('curios.my/keklina/shop')).toBeNull();
  });

  it('has no Shop open switch in it: that lives in the ready box', () => {
    show();
    expect(within(header()).queryByRole('switch')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Shop open' })).toBeInTheDocument();
  });

  it('puts the tabs under the title, with how many items and discounts there are', () => {
    const live: OwnerVoucher = { id: 'v1', mode: 'AUTO', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, label: 'Raya sale', code: null, name: 'Raya sale', endsAt: null, maxUses: null, active: true, uses: 0, state: 'on', itemName: null };
    render(<StoreEditor initial={ready} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} vouchers={[live]} {...apis()} />);
    expect(within(header()).getByRole('tablist', { name: 'Store' })).toBeInTheDocument();
    expect(editTab('Items 2')).toBeInTheDocument();
    expect(editTab('Payment')).toBeInTheDocument();
    expect(editTab('Pickup & delivery')).toBeInTheDocument();
    expect(editTab('Discounts 1')).toBeInTheDocument();
  });

  it('shows no count on a tab with nothing in it', () => {
    show(ready, []);
    expect(editTab('Items')).toBeInTheDocument();
    expect(editTab('Discounts')).toBeInTheDocument();
  });

  it('offers no link to a shop that is shut', () => {
    show({ ...ready, enabled: false });
    expect(within(header()).queryByRole('link', { name: 'See your shop' })).toBeNull();
  });

  it('cannot add past the most a shop holds', () => {
    show(ready, Array.from({ length: 60 }, (_u, i) => ({ ...items[0]!, id: `i${i}`, name: `Item ${i}` })));
    expect(within(header()).queryByRole('link', { name: '+ Add item' })).toBeNull();
    expect(within(header()).getByRole('button', { name: '+ Add item' })).toBeDisabled();
  });
});

describe('the shop open switch, in the ready box', () => {
  it('says the shop is open, with the board’s words', () => {
    show();
    expect(screen.getByText('Shop open')).toBeInTheDocument();
    expect(within(readyBox()).getByText('Customers can order from your shop now.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Shop open' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps a shop that cannot open shut, saying what it needs, in the amber blocked state', () => {
    show({ ...ready, enabled: false, bankName: null });
    expect(within(readyBox()).getByText('Add a way to pay to open')).toBeInTheDocument();
    const open = screen.getByRole('switch', { name: 'Shop open' });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute('title', expect.stringMatching(/add a way to pay/));
    expect(readyBox().closest('[data-state]')).toHaveAttribute('data-state', 'blocked');
  });

  it('counts a CHIP connection as a way to pay', async () => {
    const calls = show({ ...ready, enabled: false, bankName: null, bankAccountName: null, bankAccountNumber: null }, items, apis(), undefined, chipOn);
    expect(within(readyBox()).getByText('Closed. Switch on to take orders.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A way to pay\s*Online through CHIP/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Shop open' })); });
    expect(calls.settingsApi.save).toHaveBeenCalledWith({ enabled: true });
  });

  it('opens a ready shop, and the link appears', async () => {
    const calls = show({ ...ready, enabled: false });
    expect(within(header()).queryByRole('link', { name: 'See your shop' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Shop open' })); });
    expect(calls.settingsApi.save).toHaveBeenCalledWith({ enabled: true });
    expect(within(readyBox()).getByText('Customers can order from your shop now.')).toBeInTheDocument();
    expect(within(header()).getByRole('link', { name: 'See your shop' })).toBeInTheDocument();
  });

  it('says why an open shop takes no orders while they are paused', () => {
    show(ready, items, apis(), { paused: 'Paused: your 3 free orders are used.', nextNumber: 4 });
    expect(within(readyBox()).getByText('Paused: your 3 free orders are used.')).toBeInTheDocument();
    expect(screen.queryByText('Customers can order from your shop now.')).toBeNull();
    // Still open: customers see the shop, and their basket goes on WhatsApp.
    expect(screen.getByRole('switch', { name: 'Shop open' })).toHaveAttribute('aria-checked', 'true');
    expect(readyBox().closest('[data-state]')).toHaveAttribute('data-state', 'blocked');
  });

  it('says why when the API will not open it', async () => {
    show({ ...ready, enabled: false }, items, apis(async () => { throw new Error('Before your shop can open, turn on pickup or delivery.'); }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Shop open' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('turn on pickup or delivery');
  });

  it('is on the Items tab only, as the board draws it', () => {
    show();
    fireEvent.click(editTab('Payment'));
    expect(screen.getByRole('switch', { name: 'Shop open', hidden: true }).closest('[role="tabpanel"]')).toHaveAttribute('hidden');
  });
});

describe('saving', () => {
  it('says nothing about saving on the Store screen itself: no Saved in its header or in the top bar', async () => {
    let finish!: (s: StoreSettings) => void;
    show({ ...ready, enabled: false }, items, apis(() => new Promise((resolve) => { finish = resolve; })));
    expect(screen.queryByText('Saved')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Shop open' }));
    expect(screen.queryByText('Saving…')).toBeNull();
    await act(async () => finish({ ...ready }));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('says Saved in the top bar while an item is open, Saving… as it saves, and nothing once the screen is left', async () => {
    vi.useFakeTimers();
    let finish!: (saved: ItemRow) => void;
    const row = (): ItemRow => ({ ...PHYSICAL_ROW, id: 'a', name: 'Kek batik Raya', slug: 'kek-batik', category: null, tag: null, sku: null, description: null, photoKey: null, priceCents: 4500, options: [], available: true });
    const calls = apis();
    calls.itemsApi.update = vi.fn(() => new Promise<ItemRow>((resolve) => { finish = resolve; }));
    const { unmount } = render(
      <SaveStatusProvider>
        {TOP}
        <StoreEditor initial={ready} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} editingId="a" {...calls} />
      </SaveStatusProvider>,
    );
    expect(within(screen.getByTestId('top-bar')).getByText('Saved')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kek batik Raya' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(within(screen.getByTestId('top-bar')).getByText('Saving…')).toBeInTheDocument();
    await act(async () => finish(row()));
    expect(within(screen.getByTestId('top-bar')).getByText('Saved')).toBeInTheDocument();
    unmount();
    expect(screen.queryByText('Saved')).toBeNull();
  });
});

describe('a failed save on the main screen', () => {
  it('does not read "Not saved" once an item is opened: each item opens on a fresh screen', async () => {
    const calls = apis();
    vi.mocked(calls.itemsApi.update).mockRejectedValueOnce(new Error('Nope.'));
    const { unmount } = render(
      <SaveStatusProvider>
        {TOP}
        <StoreEditor initial={ready} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} {...calls} />
      </SaveStatusProvider>,
    );
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show Kek batik in your shop' })); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    unmount();
    showItem(ready, items, calls);
    expect(screen.queryByText('Not saved')).toBeNull();
    expect(within(screen.getByTestId('top-bar')).getByText('Saved')).toBeInTheDocument();
  });

  it('says so beside the Halal row when that save fails', async () => {
    show(ready, items, apis(async () => { throw new Error('Could not save.'); }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Halal shop' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
  });
});

describe('ready to take orders', () => {
  const steps = () => within(screen.getByRole('list', { name: 'Ready to take orders' }));

  it('says what the shop has', () => {
    show();
    expect(steps().getByRole('button', { name: /Switch an item on\s*1 item in your shop/ })).toHaveAttribute('data-ok', 'true');
    expect(steps().getByRole('button', { name: /A way to pay Bank account/ })).toBeInTheDocument();
    expect(steps().getByRole('button', { name: /Getting it to them Pickup and delivery RM10/ })).toBeInTheDocument();
  });

  it('counts the items in the shop, in the plural', () => {
    show(ready, [{ ...items[0]!, id: 'x1' }, { ...items[0]!, id: 'x2' }, { ...items[0]!, id: 'x3' }]);
    expect(steps().getByRole('button', { name: /Switch an item on\s*3 items in your shop/ })).toBeInTheDocument();
  });

  it('says what it still needs, and takes the owner there', () => {
    show({ ...ready, enabled: false, bankName: null, pickupEnabled: false, deliveryMode: 'NONE' }, items.map((i) => ({ ...i, available: false })));
    expect(steps().getByRole('button', { name: /Switch an item on\s*No item is in your shop yet/ })).toHaveAttribute('data-ok', 'false');
    expect(steps().getByRole('button', { name: /Getting it to them Turn on pickup or delivery/ })).toBeInTheDocument();
    fireEvent.click(steps().getByRole('button', { name: /A way to pay Connect CHIP or add your QR/ }));
    expect(editTab('Payment')).toHaveAttribute('aria-selected', 'true');
  });

  it('asks a new shop for its first item', () => {
    show({ ...ready, enabled: false }, []);
    expect(steps().getByRole('button', { name: /Switch an item on\s*Add your first item/ })).toBeInTheDocument();
  });

  it('names CHIP beside the QR and bank account', () => {
    show({ ...ready, paymentQrKey: null }, items, apis(), undefined, chipOn);
    expect(screen.getByRole('button', { name: /A way to pay\s*CHIP and bank account/ })).toBeInTheDocument();
  });

  it('names CHIP beside DuitNow QR when there is a QR and no bank account', () => {
    show({ ...ready, paymentQrKey: 'qr.png', bankName: null, bankAccountName: null, bankAccountNumber: null }, items, apis(), undefined, chipOn);
    expect(screen.getByRole('button', { name: /A way to pay\s*CHIP and DuitNow QR/ })).toBeInTheDocument();
  });

  it('reads Bank account for a shop with only a bank account, with no connect note', () => {
    show(ready);
    expect(screen.getByRole('button', { name: /A way to pay\s*Bank account/ })).toBeInTheDocument();
    expect(screen.queryByText(/Connect CHIP or add your QR/)).toBeNull();
  });

  it('asks a shop of digital items alone for no pickup or delivery', () => {
    show({ ...ready, enabled: false, pickupEnabled: false, deliveryMode: 'NONE' }, items.map((i) => ({ ...i, kind: 'DIGITAL' as const, delivery: 'CODES' as const })));
    expect(steps().queryByRole('button', { name: /Turn on pickup or delivery/ })).toBeNull();
    // And says how they do reach the customer, rather than nothing.
    expect(steps().getByRole('button', { name: /Getting it to them Sent by email/ })).toHaveAttribute('data-ok', 'true');
  });

  it('names free delivery, which has no fee to show', () => {
    show({ ...ready, pickupEnabled: false, deliveryMode: 'FLAT', deliveryFeeCents: 0 });
    expect(steps().getByRole('button', { name: /Getting it to them Free delivery/ })).toBeInTheDocument();
  });
});

describe('the halal switch', () => {
  it('the halal switch saves', async () => {
    const calls = show();
    const toggle = screen.getByRole('switch', { name: 'Halal shop' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await act(async () => {});
    expect(calls.settingsApi.save).toHaveBeenCalledWith({ shopHalal: true });
    expect(screen.getByRole('switch', { name: 'Halal shop' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('the items', () => {
  const names = () => screen.getAllByRole('link', { name: /^Edit / }).map((a) => a.getAttribute('aria-label'));

  it('saves the shop description, labelled About, once the owner pauses', async () => {
    vi.useFakeTimers();
    const calls = show();
    fireEvent.change(screen.getByLabelText('About'), { target: { value: 'Raya orders are open.' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(calls.settingsApi.save).toHaveBeenCalledWith({ shopDescription: 'Raya orders are open.' });
  });

  it('draws the items as cards under the ready box, and the description before them', () => {
    show();
    const cards = screen.getByRole('list', { name: 'Your items' });
    const ready = screen.getByRole('list', { name: 'Ready to take orders' });
    const about = screen.getByLabelText('About');
    expect(ready.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(about.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the numbers the store read gave each card', () => {
    show(ready, items, apis(), undefined, noChip, { a: { sold: 12, enquiries: 0, seats: null }, b: { sold: 0, enquiries: 0, seats: null } });
    expect(screen.getByRole('link', { name: 'Edit Kek batik' }).closest('li')).toHaveTextContent('12 sold in 30 days');
    expect(screen.getByRole('link', { name: 'Edit Burnt cheesecake' }).closest('li')).not.toHaveTextContent('sold');
  });

  it('puts an item in the shop from its switch, and the count follows', async () => {
    const calls = show();
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show Burnt cheesecake in your shop' })); });
    expect(calls.itemsApi.update).toHaveBeenCalledWith('b', { available: true });
    expect(screen.getByRole('button', { name: /Switch an item on\s*2 items in your shop/ })).toBeInTheDocument();
  });

  it('puts the switch back, and says why, when that fails', async () => {
    const calls = apis();
    calls.itemsApi.update = vi.fn(async () => { throw new Error('Could not reach the server.'); });
    show(ready, items, calls);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show Kek batik in your shop' })); });
    expect(screen.getByRole('switch', { name: 'Show Kek batik in your shop' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.');
  });

  it('keeps the shop’s order: Move later from a card’s menu saves the new order', async () => {
    const calls = show();
    fireEvent.click(screen.getByRole('button', { name: 'More for Kek batik' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move later' })); });
    expect(calls.itemsApi.reorder).toHaveBeenCalledWith(['b', 'a']);
    expect(names()).toEqual(['Edit Burnt cheesecake', 'Edit Kek batik']);
  });

  it('restores the order, and says why, when a move is refused', async () => {
    const calls = apis();
    calls.itemsApi.reorder = vi.fn(async () => { throw new Error('Your items changed somewhere else.'); });
    show(ready, items, calls);
    fireEvent.click(screen.getByRole('button', { name: 'More for Kek batik' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move later' })); });
    expect(names()).toEqual(['Edit Kek batik', 'Edit Burnt cheesecake']);
    expect(screen.getByRole('alert')).toHaveTextContent('changed somewhere else');
  });

  it('opens an item on its own address', () => {
    show();
    expect(screen.getByRole('link', { name: 'Edit Kek batik' })).toHaveAttribute('href', '/app/store/items/a');
  });

  it('has no phone on the Store itself', () => {
    show();
    expect(screen.queryByRole('region', { name: 'Live preview of your shop' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Preview screen' })).toBeNull();
  });
});

describe('an item on its own screen', () => {
  it('opens the item with a back link, the board’s header, and the phone showing it as a customer opens it', () => {
    showItem();
    expect(screen.getByRole('group', { name: 'Edit Kek batik' })).toBeInTheDocument();
    expect(screen.getByText('Store · Item')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Edit Kek batik' })).getByRole('heading', { level: 1, name: 'Kek batik' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All items/ })).toHaveAttribute('href', '/app/store');
    expect(screen.queryByLabelText('About', { selector: 'textarea' })?.closest('[role="tabpanel"]')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Store' })).toBeNull();
    expect(screenTab('Item')).toHaveAttribute('aria-selected', 'true');
    expect(preview().querySelector('[data-inline]')).not.toBeNull();
    expect(within(preview()).getByRole('heading', { level: 1, name: 'Kek batik' })).toBeInTheDocument();
    expect(within(preview()).queryByRole('dialog')).toBeNull();
    expect(within(preview()).getByText('How it looks in your shop.')).toBeInTheDocument();
  });

  it('follows the name as it is typed, in the title and the phone', () => {
    showItem();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kek batik Raya' } });
    expect(within(screen.getByRole('group', { name: 'Edit Kek batik' })).getByRole('heading', { level: 1, name: 'Kek batik Raya' })).toBeInTheDocument();
    expect(within(preview()).getByRole('heading', { level: 1, name: 'Kek batik Raya' })).toBeInTheDocument();
  });

  it('goes back to the Store from All items', async () => {
    showItem();
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /All items/ })); });
    expect(nav.push).toHaveBeenCalledWith('/app/store');
  });

  it('links to the item in the shop only while both it and the shop are open to visitors', () => {
    const { unmount } = render(<StoreEditor initial={ready} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} editingId="a" {...apis()} />);
    expect(screen.getByRole('link', { name: 'See it in your shop' })).toHaveAttribute('href', '/keklina/shop/x');
    unmount();
    // The hidden item, and a shop that is shut: neither has a page to see.
    const second = render(<StoreEditor initial={ready} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} editingId="b" {...apis()} />);
    expect(screen.queryByRole('link', { name: 'See it in your shop' })).toBeNull();
    second.unmount();
    render(<StoreEditor initial={{ ...ready, enabled: false }} items={items} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" now={NOW} chip={noChip} orders={{ paused: null, nextNumber: 13 }} editingId="a" {...apis()} />);
    expect(screen.queryByRole('link', { name: 'See it in your shop' })).toBeNull();
  });

  it('a new item: its own title, and the address follows the first save', async () => {
    vi.useFakeTimers();
    window.history.replaceState({ __NA: true }, '', '/app/store/items/new');
    const calls = apis();
    calls.itemsApi.add = vi.fn(async () => ({ ...PHYSICAL_ROW, id: 'z9', name: 'Tart', slug: 'tart', category: null, tag: null, sku: null, description: null, photoKey: null, priceCents: 900, options: [], available: true }));
    showItem(ready, items, calls, undefined, noChip, 'new');
    expect(screen.getByRole('group', { name: 'New item' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'New item' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tart' } });
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '9' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(calls.itemsApi.add).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/app/store/items/z9');
    // Next's own marker is not carried over, or Next would ignore the new address and Back would reopen a blank new item.
    expect(window.history.state).toBeNull();
    expect(screen.getByRole('group', { name: 'Edit Tart' })).toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });

  it('goes back to the Store after removing the item', async () => {
    const calls = showItem();
    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' })); });
    expect(calls.itemsApi.remove).toHaveBeenCalledWith('a');
    expect(nav.push).toHaveBeenCalledWith('/app/store');
  });

  it('asks for the current screen when the browser brings back one older than a change made since', () => {
    window.sessionStorage.setItem('curios-store-changed', String(NOW.getTime() + 60_000));
    showItem();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('marks a change with the server clock, not the browser one, so a browser clock that is off cannot cause or hide a refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const calls = apis();
    calls.itemsApi.update = vi.fn(async (id, patch) => ({ ...PHYSICAL_ROW, id, name: 'Kek batik Raya', slug: 'x', category: null, tag: null, sku: null, description: null, photoKey: null, priceCents: 4500, options: [], available: patch.available ?? true }));
    showItem(ready, items, calls);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kek batik Raya' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    const stored = Number(window.sessionStorage.getItem('curios-store-changed'));
    expect(stored).toBeGreaterThanOrEqual(NOW.getTime());
    expect(stored).toBeLessThan(NOW.getTime() + 10_000);
  });

  it('does not, when nothing has changed since it was read', () => {
    window.sessionStorage.setItem('curios-store-changed', String(NOW.getTime() - 60_000));
    show();
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe('the preview', () => {
  it('offers no Item or Pay screen while there is nothing to open or buy, and says why', () => {
    showItem(ready, [], apis(), undefined, noChip, 'new');
    const item = screenTab('Item');
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('title', 'Add an item to see its page here');
    const pay = screenTab('Pay');
    expect(pay).toBeDisabled();
    expect(pay).toHaveAttribute('title', 'Add an item to see how paying looks');
    // Opened on Item, with nothing to open, the phone shows the shop, and never an order of nothing.
    expect(screenTab('Shop')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('RM0')).toBeNull();
  });

  it('says orders are paused on the phone when the shop is off, and open when it is on', () => {
    showItem({ ...ready, enabled: false });
    fireEvent.click(screenTab('Shop'));
    const phone = within(preview());
    expect(phone.getByText('Orders paused')).toBeInTheDocument();
    expect(phone.queryByText('Open for orders')).toBeNull();
  });

  // The previews are the customer pages themselves, so each carries a landmark only the real page has.
  it('the Shop screen is the real shop page: its facts list and category chips, and no link leaves the editor', () => {
    const list: EditorItem[] = [
      { ...base, id: 'a', name: 'Kek batik', priceCents: 4500, available: true, category: 'Cakes' },
      { ...base, id: 'c', name: 'Online class', priceCents: 6000, available: true, ...{ kind: 'DIGITAL' as const, delivery: 'FILES' as const } },
    ];
    showItem(ready, list);
    fireEvent.click(screenTab('Shop'));
    const shop = within(preview());
    expect(shop.getByText('Open for orders')).toBeInTheDocument();
    expect(shop.getByText('Seksyen 7 · Pickup or delivery')).toBeInTheDocument();
    expect(shop.getByRole('group', { name: 'Categories' })).toBeInTheDocument();
    expect(shop.getByRole('button', { name: /^Cakes/ })).toBeInTheDocument();
    expect(shop.getByRole('button', { name: /^Digital/ })).toBeInTheDocument();
    const click = fireEvent.click(shop.getByRole('link', { name: `Back to ${look.displayName}` }));
    // A prevented click: the editor stays where it is.
    expect(click).toBe(false);
  });

  it('shows the shop with only what is in it, and the shop description as it is typed in the item’s own copy', () => {
    showItem();
    fireEvent.click(screenTab('Shop'));
    expect(within(preview()).getByText('Kek batik')).toBeInTheDocument();
    expect(within(preview()).queryByText('Burnt cheesecake')).toBeNull();
  });

  it('opens the product screen in the preview from a tapped row, and returns to the shop after an add', () => {
    showItem();
    fireEvent.click(screenTab('Shop'));
    fireEvent.click(within(preview()).getByRole('link', { name: 'Kek batik' }));
    expect(within(preview()).getByRole('heading', { level: 1, name: 'Kek batik' })).toBeInTheDocument();
    fireEvent.click(within(preview()).getByRole('button', { name: /^Add ·/ }));
    expect(within(preview()).getByText('1 item · RM45')).toBeInTheDocument();
  });

  it('the Item screen is the real item page: Size boxes for options', () => {
    const list: EditorItem[] = [
      { ...base, id: 'a', name: 'Kek coklat', priceCents: null, available: true, options: [{ id: 'o1', label: '1kg', priceCents: 9500 }, { id: 'o2', label: '2kg', priceCents: 17000 }] },
    ];
    showItem(ready, list);
    expect(within(preview()).getByRole('radiogroup', { name: 'Size' })).toBeInTheDocument();
    expect(within(preview()).getByRole('radio', { name: /1kg/ })).toBeInTheDocument();
    expect(within(preview()).getByRole('radio', { name: /2kg/ })).toBeInTheDocument();
  });

  it('the Pay screen has no link and copies nothing: its QR and Copy are pictures', () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    showItem();
    fireEvent.click(screenTab('Pay'));
    expect(preview().querySelector('a[download], a[href*="/qr"]')).toBeNull();
    fireEvent.click(within(preview()).getByRole('button', { name: 'Copy' }));
    fireEvent.click(within(preview()).getByRole('button', { name: 'Copy code' }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('the Pay screen is the real order page: its code and timeline', () => {
    showItem();
    fireEvent.click(screenTab('Pay'));
    const pay = within(preview());
    expect(pay.getAllByText('7Q4M', { exact: false }).length).toBeGreaterThan(0);
    const steps = pay.getByRole('list', { name: 'Order progress' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Placed, done', 'Paid', 'Ready', 'Done']);
  });

  it('ends the shop in the board’s basket bar, empty, with Checkout', () => {
    showItem();
    fireEvent.click(screenTab('Shop'));
    expect(within(preview()).getByText('Basket is empty')).toBeInTheDocument();
    fireEvent.click(within(preview()).getByRole('button', { name: 'Checkout' }));
    expect(screenTab('Pay')).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the order page’s Pay screen: the total, the bank account, and the receipt upload', () => {
    showItem();
    fireEvent.click(screenTab('Pay'));
    const pay = within(preview());
    expect(pay.getByRole('heading', { name: 'Your order' })).toBeInTheDocument();
    expect(pay.getByText('Order #13', { exact: false })).toBeInTheDocument();
    expect(pay.getByText('Waiting for payment')).toBeInTheDocument();
    // Kek batik RM45 and the RM10 flat fee: the board's delivery, on the earliest day.
    expect(pay.getByRole('heading', { name: 'Pay RM55' })).toBeInTheDocument();
    expect(pay.getByText('Maybank · Lina')).toBeInTheDocument();
    expect(pay.getByText('1234567890')).toBeInTheDocument();
    expect(pay.getByText('Upload your receipt')).toBeInTheDocument();
    expect(pay.getByText('Kek batik')).toBeInTheDocument();
    expect(pay.getByText('Delivery · Sun 18 Oct')).toBeInTheDocument();
    // A preview: nothing in it uploads.
    expect(preview().querySelector('input[type="file"]')).toBeNull();
  });

  it('leaves an Ask item out of the Pay screen’s sample order: it never goes in the basket', () => {
    const cake: EditorItem = { ...base, id: 'k', name: 'Custom birthday cake', priceCents: 18000, askForPrice: true, available: true };
    showItem(ready, [cake, ...items]);
    fireEvent.click(screenTab('Pay'));
    const pay = within(preview());
    expect(pay.getByText('Kek batik')).toBeInTheDocument();
    expect(pay.queryByText(/Custom birthday cake/)).toBeNull();
    expect(pay.getByRole('heading', { name: 'Pay RM55' })).toBeInTheDocument();
  });

  it('hands the shop and item pages whether an item asks for a price', () => {
    const cake: EditorItem = { ...base, id: 'k', name: 'Custom birthday cake', priceCents: null, askForPrice: true, available: true };
    expect(previewItem(cake)).toMatchObject({ askForPrice: true, priceCents: null });
    expect(previewItem({ ...cake, askForPrice: false, priceCents: 4500 })).toMatchObject({ askForPrice: false });
  });

  it('says a rider’s fee is paid separately on the Pay screen, as the order page does', () => {
    showItem({ ...ready, deliveryMode: 'RIDER', deliveryFeeCents: null });
    fireEvent.click(screenTab('Pay'));
    expect(within(preview()).getByText('Delivery · Sun 18 Oct · Rider fee paid separately')).toBeInTheDocument();
  });

  it('says so on the Pay screen when there is no way to pay yet', () => {
    showItem({ ...ready, bankName: null, bankAccountName: null, bankAccountNumber: null });
    fireEvent.click(screenTab('Pay'));
    expect(within(preview()).getByText('No way to pay yet. Add a QR or your bank account.')).toBeInTheDocument();
  });

  it('counts a saved QR with nothing to show it from as no way to pay, in the page’s language', () => {
    const noBank = { ...ready, paymentQrKey: 'qr/k.webp', bankName: null, bankAccountName: null, bankAccountNumber: null };
    showItem(noBank, items, apis(), { paused: null, nextNumber: 1 }, noChip, 'a', [], { language: 'ms' });
    fireEvent.click(screenTab('Pay'));
    expect(within(preview()).getByText('Belum ada cara untuk bayar. Tambah QR atau akaun bank anda.')).toBeInTheDocument();
  });
});

describe('the tabs', () => {
  it('moves between Items, Payment and Pickup & delivery', () => {
    show();
    fireEvent.click(editTab('Payment'));
    expect(screen.getByRole('heading', { name: 'DuitNow QR' })).toBeVisible();
    fireEvent.click(editTab('Pickup & delivery'));
    expect(screen.getByRole('heading', { name: 'Notice' })).toBeVisible();
    // Hidden, not unmounted: a description typed a moment ago still saves.
    expect(screen.getByLabelText('About')).not.toBeVisible();
  });
});

describe('without the template look', () => {
  it('has no gradient blobs in the preview panel', () => {
    showItem();
    expect(preview().parentElement!.querySelector('[class*="blob"]')).toBeNull();
    expect(document.querySelector('[class*="blobs"]')).toBeNull();
  });

  it('titles its sections with text only, and the delivery choices too', () => {
    show();
    fireEvent.click(editTab('Pickup & delivery'));
    for (const name of ['Pickup', 'Delivery', 'Notice']) {
      expect(screen.getByRole('heading', { name }).querySelector('svg')).toBeNull();
    }
    expect(document.querySelector('[class*="deliveryIcon"]')).toBeNull();
    expect(document.querySelector('[class*="chip"][data-tone]')).toBeNull();
  });
});

describe('vouchers in the phone', () => {
  const live: OwnerVoucher = {
    id: 'v1', mode: 'AUTO', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, label: 'Raya sale',
    code: null, name: 'Raya sale', endsAt: null, maxUses: null, active: true, uses: 0, state: 'on', itemName: null,
  };
  const withVouchers = (vouchers: OwnerVoucher[], paused: string | null = null) => {
    showItem(ready, items, apis(), { paused, nextNumber: 13 }, noChip, 'a', vouchers);
    fireEvent.click(screenTab('Shop'));
  };

  it('shows a live automatic voucher on the shop as customers see it', () => {
    withVouchers([live]);
    expect(within(preview()).getAllByText(/10% off/).length).toBeGreaterThan(0);
  });

  it('shows no voucher that is off, ended or a code', () => {
    withVouchers([{ ...live, id: 'o', active: false, state: 'off' }, { ...live, id: 'c', mode: 'CODE', code: 'RAYA', label: 'RAYA' }]);
    expect(within(preview()).queryByText(/10% off/)).toBeNull();
  });

  it('takes a live automatic voucher off the basket bar total, as the shop’s bar does', () => {
    writeBasket('curios-store-preview', [{ itemId: 'a', optionId: null, quantity: 2 }]);
    withVouchers([live]);
    expect(within(preview()).getByText('2 items · RM81')).toBeInTheDocument();
  });

  it('shows no voucher, on the sign or the bar, while orders are paused', () => {
    writeBasket('curios-store-preview', [{ itemId: 'a', optionId: null, quantity: 2 }]);
    withVouchers([live], 'Paused: your 3 free orders are used.');
    expect(within(preview()).queryByText(/10% off/)).toBeNull();
    expect(within(preview()).getByText('2 items · RM90')).toBeInTheDocument();
  });
});
