import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StoreEditor } from './store-editor.js';
import type { EditorItem, ItemsApi, SettingsApi, SettingsPatch, ShopLook, StoreSettings } from './store-types.js';

const ready: StoreSettings = {
  enabled: true, shopDescription: 'Homemade cakes.', shopHalal: false, pickupEnabled: true, pickupNote: 'Seksyen 7', deliveryMode: 'FLAT',
  deliveryFeeCents: 1000, minNoticeDays: 2, closedDays: [], deliveryNote: null, paymentQrKey: null, bankName: 'Maybank',
  bankAccountName: 'Lina', bankAccountNumber: '1234567890', tileSize: null,
};

const base = { slug: 'x', category: null, tag: null, description: null, photoKey: null, photoUrl: null, options: [] };
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
    update: vi.fn(async (id, patch) => ({ id, name: 'Kek batik', slug: 'kek-batik', category: null, tag: null, description: null, photoKey: null, priceCents: 4500, options: [], available: patch.available ?? true })),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    uploadPhoto: vi.fn(),
    removePhoto: vi.fn(),
  };
  return { settingsApi, itemsApi };
}

function show(settings: StoreSettings = ready, list = items, calls = apis(), orders = { paused: null as string | null, nextNumber: 13 }) {
  render(<StoreEditor initial={settings} items={list} look={look} qrUrl={null} uploadsEnabled today="2026-10-16" orders={orders} {...calls} />);
  return calls;
}

const header = () => screen.getByRole('heading', { name: 'Store' }).closest('header')!;
const preview = () => screen.getByRole('region', { name: 'Live preview of your shop' });
const editTab = (name: string) => within(screen.getByRole('tablist', { name: 'Store' })).getByRole('tab', { name });

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe('the header', () => {
  it('says the shop is open, and links to it', () => {
    show();
    expect(within(header()).getByText('Open for orders')).toBeInTheDocument();
    expect(within(header()).getByRole('switch', { name: 'Shop open' })).toHaveAttribute('aria-checked', 'true');
    expect(within(header()).getByRole('link', { name: 'See your shop' })).toHaveAttribute('href', '/keklina/shop');
    expect(within(header()).getByText('curios.my/keklina/shop')).toBeInTheDocument();
  });

  it('keeps a shop that cannot open shut, saying what it needs, and offers no link to it', () => {
    show({ ...ready, enabled: false, bankName: null });
    expect(within(header()).getByText('Add a way to pay to open')).toBeInTheDocument();
    const open = within(header()).getByRole('switch', { name: 'Shop open' });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute('title', expect.stringMatching(/add a way to pay/));
    expect(within(header()).queryByRole('link', { name: 'See your shop' })).toBeNull();
  });

  it('opens a ready shop, and the link appears', async () => {
    const calls = show({ ...ready, enabled: false });
    expect(within(header()).getByText('Closed')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(header()).getByRole('switch', { name: 'Shop open' })); });
    expect(calls.settingsApi.save).toHaveBeenCalledWith({ enabled: true });
    expect(within(header()).getByText('Open for orders')).toBeInTheDocument();
    expect(within(header()).getByRole('link', { name: 'See your shop' })).toBeInTheDocument();
  });

  it('says why an open shop takes no orders while they are paused', () => {
    show(ready, items, apis(), { paused: 'Paused: your 3 free orders are used.', nextNumber: 4 });
    expect(within(header()).getByText('Paused: your 3 free orders are used.')).toBeInTheDocument();
    expect(within(header()).queryByText('Open for orders')).toBeNull();
    // Still open: customers see the shop, and their basket goes on WhatsApp.
    expect(within(header()).getByRole('switch', { name: 'Shop open' })).toHaveAttribute('aria-checked', 'true');
  });

  it('says why when the API will not open it', async () => {
    show({ ...ready, enabled: false }, items, apis(async () => { throw new Error('Before your shop can open, turn on pickup or delivery.'); }));
    await act(async () => { fireEvent.click(within(header()).getByRole('switch', { name: 'Shop open' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('turn on pickup or delivery');
  });

  it('says Saving… while a save is out, then Saved', async () => {
    let finish!: (s: StoreSettings) => void;
    show({ ...ready, enabled: false }, items, apis(() => new Promise((resolve) => { finish = resolve; })));
    fireEvent.click(within(header()).getByRole('switch', { name: 'Shop open' }));
    expect(within(header()).getByText('Saving…')).toBeInTheDocument();
    await act(async () => finish({ ...ready }));
    expect(within(header()).getByText('Saved')).toBeInTheDocument();
  });
});

describe('ready to take orders', () => {
  const steps = () => within(screen.getByRole('list', { name: 'Ready to take orders' }));

  it('says what the shop has', () => {
    show();
    expect(steps().getByRole('button', { name: /Items 1 in your shop/ })).toHaveAttribute('data-ok', 'true');
    expect(steps().getByRole('button', { name: /A way to pay Bank account/ })).toBeInTheDocument();
    expect(steps().getByRole('button', { name: /Getting it to them Pickup and delivery RM10/ })).toBeInTheDocument();
  });

  it('says what it still needs, and takes the owner there', () => {
    show({ ...ready, enabled: false, bankName: null, pickupEnabled: false, deliveryMode: 'NONE' }, items.map((i) => ({ ...i, available: false })));
    expect(steps().getByRole('button', { name: /Items Switch an item on/ })).toHaveAttribute('data-ok', 'false');
    expect(steps().getByRole('button', { name: /Getting it to them Turn on pickup or delivery/ })).toBeInTheDocument();
    fireEvent.click(steps().getByRole('button', { name: /A way to pay Add a QR or bank account/ }));
    expect(editTab('Payment')).toHaveAttribute('aria-selected', 'true');
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
  it('saves the shop description once the owner pauses, and the preview shows it at once', async () => {
    vi.useFakeTimers();
    const calls = show();
    fireEvent.change(screen.getByLabelText('Shop description'), { target: { value: 'Raya orders are open.' } });
    expect(within(preview()).getByText('Raya orders are open.')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(calls.settingsApi.save).toHaveBeenCalledWith({ shopDescription: 'Raya orders are open.' });
  });

  it('shows the shop with only what is in it', () => {
    show();
    expect(within(preview()).getByText('Kek batik')).toBeInTheDocument();
    expect(within(preview()).queryByText('Burnt cheesecake')).toBeNull();
  });

  it('puts an item in the shop from its switch, and the preview follows', async () => {
    const calls = show();
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In your shop: Burnt cheesecake' })); });
    expect(calls.itemsApi.update).toHaveBeenCalledWith('b', { available: true });
    expect(within(preview()).getByText('Burnt cheesecake')).toBeInTheDocument();
  });

  it('puts the switch back, and says why, when that fails', async () => {
    const calls = apis();
    calls.itemsApi.update = vi.fn(async () => { throw new Error('Could not reach the server.'); });
    show(ready, items, calls);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In your shop: Kek batik' })); });
    expect(screen.getByRole('switch', { name: 'In your shop: Kek batik' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.');
  });

  it('restores the order, and says why, when a move is refused', async () => {
    const calls = apis();
    calls.itemsApi.reorder = vi.fn(async () => { throw new Error('Your items changed somewhere else.'); });
    show(ready, items, calls);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move Kek batik down' })); });
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label')).filter(Boolean)).toEqual(['Kek batik', 'Burnt cheesecake']);
    expect(screen.getByRole('alert')).toHaveTextContent('changed somewhere else');
  });

  it('opens an item on its own, and the preview shows it as a customer opens it', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kek batik' }));
    expect(screen.getByRole('group', { name: 'Edit Kek batik' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Shop description')).toBeNull();
    expect(within(screen.getByRole('tablist', { name: 'Preview screen' })).getByRole('tab', { name: 'Item' })).toHaveAttribute('aria-selected', 'true');
    const sheet = within(preview()).getByRole('dialog');
    expect(sheet).toHaveAttribute('data-inline');
    expect(within(sheet).getByRole('heading', { name: 'Kek batik' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kek batik Raya' } });
    expect(within(within(preview()).getByRole('dialog')).getByRole('heading', { name: 'Kek batik Raya' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All items' }));
    expect(screen.getByLabelText('Shop description')).toBeInTheDocument();
    expect(within(preview()).queryByRole('dialog')).toBeNull();
  });
});

describe('the preview', () => {
  const screenTab = (name: string) => within(screen.getByRole('tablist', { name: 'Preview screen' })).getByRole('tab', { name });

  it('ends the shop in the board’s basket bar, empty, with Checkout', () => {
    show();
    expect(within(preview()).getByText('Basket is empty')).toBeInTheDocument();
    fireEvent.click(within(preview()).getByRole('button', { name: 'Checkout' }));
    expect(screenTab('Pay')).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the order page’s Pay screen: the total, the bank account, and the receipt upload', () => {
    show();
    fireEvent.click(screenTab('Pay'));
    const pay = within(preview());
    expect(pay.getByRole('heading', { name: 'Order #13' })).toBeInTheDocument();
    expect(pay.getByText('Waiting for payment')).toBeInTheDocument();
    // Kek batik RM45 and the RM10 flat fee: the board's delivery, on the earliest day.
    expect(pay.getByRole('heading', { name: 'Pay RM55' })).toBeInTheDocument();
    expect(pay.getByText('Maybank · Lina')).toBeInTheDocument();
    expect(pay.getByText('1234567890')).toBeInTheDocument();
    expect(pay.getByText('Upload your receipt')).toBeInTheDocument();
    expect(pay.getByText('1× Kek batik')).toBeInTheDocument();
    expect(pay.getByText('Delivery · Sun 18 Oct')).toBeInTheDocument();
    // A preview: nothing in it uploads.
    expect(preview().querySelector('input[type="file"]')).toBeNull();
  });

  it('says a rider’s fee is paid separately on the Pay screen, as the order page does', () => {
    show({ ...ready, deliveryMode: 'RIDER', deliveryFeeCents: null });
    fireEvent.click(screenTab('Pay'));
    expect(within(preview()).getByText('Delivery · Sun 18 Oct · Rider fee paid separately')).toBeInTheDocument();
  });

  it('says so on the Pay screen when there is no way to pay yet', () => {
    show({ ...ready, bankName: null, bankAccountName: null, bankAccountNumber: null });
    fireEvent.click(screenTab('Pay'));
    expect(within(preview()).getByText('No way to pay yet. Add a QR or your bank account.')).toBeInTheDocument();
  });

  it('counts a saved QR with nothing to show it from as no way to pay, in the page’s language', () => {
    const noBank = { ...ready, paymentQrKey: 'qr/k.webp', bankName: null, bankAccountName: null, bankAccountNumber: null };
    render(
      <StoreEditor initial={noBank} items={items} look={{ ...look, language: 'ms' }} qrUrl={null} uploadsEnabled today="2026-10-16" orders={{ paused: null, nextNumber: 1 }} {...apis()} />,
    );
    fireEvent.click(screenTab('Pay'));
    expect(within(preview()).getByText('Belum ada cara untuk bayar. Tambah QR atau akaun bank anda.')).toBeInTheDocument();
  });

  it('turns to the Pay screen with the Payment and delivery tabs, and back to the shop with Items', () => {
    show();
    fireEvent.click(editTab('Payment'));
    expect(screenTab('Pay')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(editTab('Items'));
    expect(screenTab('Shop')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(editTab('Pickup & delivery'));
    expect(screenTab('Pay')).toHaveAttribute('aria-selected', 'true');
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
    expect(screen.getByLabelText('Shop description')).not.toBeVisible();
  });
});
