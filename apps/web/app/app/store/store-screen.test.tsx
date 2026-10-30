import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PHYSICAL_ITEM, PHYSICAL_ROW, type EditorItem, type ShopLook, type StoreSettings } from './store-types.js';

const apiFetch = vi.fn();
vi.mock('../../../lib/api.js', () => ({ apiFetch, ApiError: class extends Error {} }));
const sendFile = vi.fn();
vi.mock('../../../lib/send-file.js', () => ({ sendFile }));
vi.mock('../curios/resize-image.js', () => ({
  prepareOriginal: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/webp' }), width: 1000, height: 750 })),
  resizeImage: vi.fn(async () => ({ contentType: 'image/webp', data: 'AAAA' })),
  // The QR goes through the uncropped, lossless path, so its bytes differ from an item photo's.
  resizeContained: vi.fn(async () => ({ contentType: 'image/png', data: 'QQQQ' })),
}));

URL.createObjectURL = vi.fn(() => 'blob:x');
URL.revokeObjectURL = vi.fn();

const { StoreScreen } = await import('./store-screen.js');

const settings: StoreSettings = {
  enabled: false, shopDescription: null, shopHalal: false, pickupEnabled: false, pickupNote: null, deliveryMode: 'NONE',
  deliveryFeeCents: null, minNoticeDays: 0, closedDays: [], deliveryNote: null, paymentQrKey: null, bankName: null,
  bankAccountName: null, bankAccountNumber: null, tileSize: null,
};

const items: EditorItem[] = [
  { ...PHYSICAL_ITEM, id: 'a', name: 'Kek Batik', slug: 'a', category: null, tag: null, sku: null, description: null, photoKey: null, priceCents: 2500, options: [], available: true, photoUrl: null },
];

const look: ShopLook = {
  handle: 'nadia', displayName: 'Nadia Bakes', bio: null, language: 'en', avatarUrl: null, coverUrl: null,
  style: 'SOFT', accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null, socials: [], whatsapp: '60123456789',
};

const screenWith = (over: Partial<StoreSettings> = {}, list: EditorItem[] = items) =>
  render(
    <StoreScreen
      initial={{ ...settings, ...over }}
      items={list}
      look={look}
      uploadsEnabled
      publicBase="https://files.example/"
      qrUrl={null}
      today="2026-10-16"
      now={new Date('2026-10-16T02:00:00Z')}
      chip={{ connected: false, brandName: null, methods: [], checkedAt: null, isTest: false }}
      orders={{ paused: null, nextNumber: 1 }}
    />,
  );

const tab = (name: string) => within(screen.getByRole('tablist', { name: 'Store' })).getByRole('tab', { name });

describe('StoreScreen, against the API', () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(() => vi.useRealTimers());

  it('saves a setting with PATCH /store/settings and unwraps the settings', async () => {
    apiFetch.mockResolvedValue({ settings: { ...settings, pickupEnabled: true } });
    screenWith();
    await userEvent.click(tab('Pickup & delivery'));
    await userEvent.click(screen.getByRole('switch', { name: 'Allow pickup' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/settings', { method: 'PATCH', body: JSON.stringify({ pickupEnabled: true }) });
    // This tab turns the preview to the Pay screen; the shop's terms are on Shop.
    await userEvent.click(within(screen.getByRole('tablist', { name: 'Preview screen' })).getByRole('tab', { name: 'Shop' }));
    expect(await screen.findByText(/Pickup/, { selector: 'li' })).toBeInTheDocument();
  });

  it('uploads a QR to /store/payment-qr and shows it from the public base', async () => {
    apiFetch.mockResolvedValue({ paymentQrKey: 'qr/abc.webp' });
    screenWith();
    await userEvent.click(tab('Payment'));
    await userEvent.upload(screen.getByLabelText('QR file'), new File(['x'], 'qr.png', { type: 'image/png' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/payment-qr', { method: 'POST', body: JSON.stringify({ contentType: 'image/png', data: 'QQQQ' }) });
    expect(await screen.findByAltText('Your DuitNow QR')).toHaveAttribute('src', 'https://files.example/qr/abc.webp');
  });

  it('removes the QR with DELETE /store/payment-qr', async () => {
    apiFetch.mockResolvedValue({ paymentQrKey: null });
    screenWith({ paymentQrKey: 'k' });
    await userEvent.click(tab('Payment'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/payment-qr', { method: 'DELETE' });
  });

  it('removes an item with DELETE /store/items/:id, from its editor', async () => {
    apiFetch.mockResolvedValue({ status: 'removed' });
    screenWith();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove item' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/items/a', { method: 'DELETE' });
    expect(screen.queryByRole('listitem', { name: 'Kek Batik' })).toBeNull();
  });

  it('adds with POST /store/items once the new item has a name and a price', async () => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValue({ item: { ...PHYSICAL_ROW, id: 'n', name: 'Tart', slug: 'n', category: null, tag: null, sku: null, description: null, photoKey: null, available: true, priceCents: 900, options: [] } });
    screenWith();
    fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tart' } });
    fireEvent.change(screen.getByLabelText('Price in ringgit'), { target: { value: '9' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(apiFetch).toHaveBeenCalledWith('/store/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Tart', description: null, category: null, tag: null, sku: null, pricing: { kind: 'single', priceCents: 900 } }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'All items' }));
    expect(screen.getByRole('listitem', { name: 'Tart' })).toBeInTheDocument();
  });

  it('uploads an item picture to /store/items/:id/photos with its frame and shows the cover from the public base', async () => {
    sendFile.mockResolvedValue({ photos: [{ id: 'p1', squareKey: 'items/a/p1.webp', width: 1000, height: 800, frame: { x: 0.125, y: 0, size: 1 } }], photoKey: 'items/a.webp' });
    const { container } = screenWith();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
    await userEvent.upload(screen.getByLabelText('Picture file'), new File(['x'], 'k.png', { type: 'image/png' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(sendFile).toHaveBeenCalledWith('/store/items/a/photos', expect.any(Blob), expect.any(Function), { 'x-photo-frame': '0.125,0,1' });
    await screen.findByRole('button', { name: 'Crop cover photo' });
    expect(container.querySelector('img[src="https://files.example/items/a.webp"]')).not.toBeNull();
  });

  it('reorders with PUT /store/items/order', async () => {
    apiFetch.mockResolvedValue({ status: 'ok' });
    screenWith({}, [...items, { ...items[0]!, id: 'b', name: 'Tart' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Move Kek Batik down' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/items/order', { method: 'PUT', body: JSON.stringify({ ids: ['b', 'a'] }) });
  });

  it('connects CHIP with POST /store/chip, sending the key once and reading back only the connection', async () => {
    apiFetch.mockResolvedValue({ connected: true, brandName: null, methods: ['fpx'], checkedAt: '2026-10-16T02:00:00.000Z', isTest: false });
    screenWith();
    await userEvent.click(tab('Payment'));
    await userEvent.click(screen.getByRole('button', { name: 'Connect CHIP' }));
    fireEvent.change(screen.getByLabelText('Brand ID'), { target: { value: 'brand-uuid' } });
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'the-secret-key' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check and connect' })); });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/store/chip', { method: 'POST', body: JSON.stringify({ brandId: 'brand-uuid', secretKey: 'the-secret-key' }) });
    expect(screen.getByText('Connected to CHIP')).toBeInTheDocument();
    expect(screen.getByText(/^Brand “Nadia Bakes” · checked just now\./)).toBeInTheDocument();
  });

  it('disconnects with DELETE /store/chip and starts the test with POST /store/chip/test', async () => {
    apiFetch.mockResolvedValue({ connected: false });
    render(
      <StoreScreen
        initial={settings}
        items={items}
        look={look}
        uploadsEnabled
        publicBase="https://files.example/"
        qrUrl={null}
        today="2026-10-16"
        now={new Date('2026-10-16T02:00:00Z')}
        chip={{ connected: true, brandName: 'Nadia Bakes', methods: ['fpx'], checkedAt: new Date('2026-10-16T01:00:00Z'), isTest: false }}
        orders={{ paused: null, nextNumber: 1 }}
      />,
    );
    await userEvent.click(tab('Payment'));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' })); });
    expect(apiFetch).toHaveBeenCalledWith('/store/chip', { method: 'DELETE' });
    expect(screen.getByText('Let customers pay online')).toBeInTheDocument();
  });
});
