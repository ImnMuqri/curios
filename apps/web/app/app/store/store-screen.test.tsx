import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerStore } from '@curios/db-read';
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

const screenWith = (over: Partial<OwnerStore['settings']> = {}) =>
  render(<StoreScreen initial={{ ...settings, ...over }} handle="nadia" uploadsEnabled publicBase="https://files.example/" qrUrl={null} />);

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
});
