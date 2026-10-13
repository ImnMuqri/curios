import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerStore } from '@curios/db-read';
import type { EditorItem } from './items-editor.js';
import userEvent from '@testing-library/user-event';

const apiFetch = vi.fn();
vi.mock('../../../lib/api.js', () => ({ apiFetch }));
vi.mock('../curios/resize-image.js', () => ({ resizeImage: vi.fn(async () => ({ contentType: 'image/webp', data: 'AAAA' })) }));

const { StoreScreen } = await import('./store-screen.js');

const settings: OwnerStore['settings'] = {
  enabled: false, pickupEnabled: false, pickupNote: null, deliveryMode: 'NONE',
  deliveryFeeCents: null, minNoticeDays: 0, paymentQrKey: null, bankName: null,
  bankAccountName: null, bankAccountNumber: null, tileSize: 'WIDE',
};

const items: EditorItem[] = [
  { id: 'a', name: 'Kek Batik', description: null, photoKey: null, priceCents: 2500, options: [], available: true, photoUrl: null },
];

const screenWith = (over: Partial<OwnerStore['settings']> = {}, list: EditorItem[] = items) =>
  render(<StoreScreen initial={{ ...settings, ...over }} handle="nadia" uploadsEnabled publicBase="https://files.example/" qrUrl={null} items={list} />);

describe('StoreScreen', () => {
  beforeEach(() => apiFetch.mockReset());

  it('links to the shop only when it is open', () => {
    screenWith({ enabled: true, paymentQrKey: 'k', pickupEnabled: true });
    expect(screen.getByRole('link', { name: /see your shop/i })).toHaveAttribute('href', '/nadia/shop');
  });

  it('offers no link to a closed shop', () => {
    screenWith();
    expect(screen.queryByRole('link', { name: /see your shop/i })).toBeNull();
  });

  it('shows the link once a save opens the shop', async () => {
    apiFetch.mockResolvedValue({ settings: { ...settings, pickupEnabled: true, paymentQrKey: 'k', enabled: true } });
    screenWith({ pickupEnabled: true, paymentQrKey: 'k' });
    expect(screen.queryByRole('link', { name: /see your shop/i })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: /open shop/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(await screen.findByRole('link', { name: /see your shop/i })).toHaveAttribute('href', '/nadia/shop');
  });

  it('drops the link once a save closes the shop', async () => {
    apiFetch.mockResolvedValue({ settings: { ...settings, pickupEnabled: true, paymentQrKey: 'k', enabled: false } });
    screenWith({ enabled: true, pickupEnabled: true, paymentQrKey: 'k' });
    await userEvent.click(screen.getByRole('checkbox', { name: /open shop/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    await screen.findByText(/^saved/i);
    expect(screen.queryByRole('link', { name: /see your shop/i })).toBeNull();
  });

  it('saves with PATCH /store/settings and unwraps the settings', async () => {
    apiFetch.mockResolvedValue({ settings: { ...settings, pickupEnabled: true } });
    screenWith();
    await userEvent.click(screen.getByRole('checkbox', { name: /offer pickup/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(apiFetch).toHaveBeenCalledWith('/store/settings', { method: 'PATCH', body: JSON.stringify({ pickupEnabled: true }) });
    expect(await screen.findByText(/^saved/i)).toBeInTheDocument();
  });

  it('uploads a QR to /store/payment-qr and shows it from the public base', async () => {
    apiFetch.mockResolvedValue({ paymentQrKey: 'qr/abc.webp' });
    screenWith();
    await userEvent.upload(screen.getByLabelText(/upload a payment qr/i), new File(['x'], 'qr.png', { type: 'image/png' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/payment-qr', { method: 'POST', body: JSON.stringify({ contentType: 'image/webp', data: 'AAAA' }) });
    expect(await screen.findByAltText(/payment qr/i)).toHaveAttribute('src', 'https://files.example/qr/abc.webp');
  });

  it('removes the QR with DELETE /store/payment-qr', async () => {
    apiFetch.mockResolvedValue({ paymentQrKey: null });
    screenWith({ paymentQrKey: 'k' });
    await userEvent.click(screen.getByRole('button', { name: /remove qr/i }));
    expect(apiFetch).toHaveBeenCalledWith('/store/payment-qr', { method: 'DELETE' });
  });

  it('lists the items under the settings and removes with DELETE /store/items/:id', async () => {
    apiFetch.mockResolvedValue({ status: 'removed' });
    screenWith();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Kek Batik' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/items/a', { method: 'DELETE' });
  });

  it('adds with POST /store/items and unwraps the item', async () => {
    apiFetch.mockResolvedValue({ item: { id: 'n', name: 'Tart', description: null, photoKey: null, available: true, priceCents: 900, options: [] } });
    screenWith();
    await userEvent.click(screen.getByRole('button', { name: '+ Add an item' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Tart');
    await userEvent.type(screen.getByLabelText('Price (RM)'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Tart', description: null, pricing: { kind: 'single', priceCents: 900 } }),
    });
    expect(await screen.findByRole('listitem', { name: 'Tart' })).toBeInTheDocument();
  });

  it('uploads an item picture to /store/items/:id/photo and shows it from the public base', async () => {
    apiFetch.mockResolvedValue({ photoKey: 'items/a.webp' });
    screenWith();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kek Batik' }));
    await userEvent.upload(screen.getByLabelText('Upload a picture for Kek Batik'), new File(['x'], 'k.png', { type: 'image/png' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/items/a/photo', { method: 'POST', body: JSON.stringify({ contentType: 'image/webp', data: 'AAAA' }) });
    expect(await screen.findByAltText('Picture of Kek Batik')).toHaveAttribute('src', 'https://files.example/items/a.webp');
  });

  it('reorders with PUT /store/items/order', async () => {
    apiFetch.mockResolvedValue({ status: 'ok' });
    screenWith({}, [...items, { ...items[0]!, id: 'b', name: 'Tart' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Move Kek Batik down' }));
    expect(apiFetch).toHaveBeenCalledWith('/store/items/order', { method: 'PUT', body: JSON.stringify({ ids: ['b', 'a'] }) });
  });
});
