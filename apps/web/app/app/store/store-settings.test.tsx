import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { StoreSettingsForm, type StoreSettingsApi, type StoreSettings } from './store-settings.js';

const base: StoreSettings = {
  enabled: false, pickupEnabled: false, pickupNote: null, deliveryMode: 'NONE',
  deliveryFeeCents: null, minNoticeDays: 0, paymentQrKey: null, bankName: null,
  bankAccountName: null, bankAccountNumber: null, tileSize: 'WIDE',
};

function setup(
  over: Partial<StoreSettings> = {},
  extra: { uploadsEnabled?: boolean; qrUrl?: string | null; api?: Partial<StoreSettingsApi> } = {},
) {
  const api: StoreSettingsApi = {
    save: vi.fn(async (patch) => ({ ...base, ...over, ...patch })),
    uploadQr: vi.fn(async () => 'https://files.example/qr.webp'),
    removeQr: vi.fn(async () => {}),
    ...extra.api,
  };
  render(
    <StoreSettingsForm
      initial={{ ...base, ...over }}
      uploadsEnabled={extra.uploadsEnabled ?? true}
      qrUrl={extra.qrUrl ?? null}
      api={api}
    />,
  );
  return api;
}

describe('StoreSettingsForm', () => {
  it('keeps Open shop off, with the reason, until the shop can open', async () => {
    setup();
    const open = screen.getByRole('checkbox', { name: /open shop/i });
    expect(open).toBeDisabled();
    expect(screen.getByText(/Before your shop can open, add a way to pay .* and turn on pickup or delivery\./)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^bank name/i), 'Maybank');
    await userEvent.type(screen.getByLabelText(/account name/i), 'Nadia Bakes');
    await userEvent.type(screen.getByLabelText(/account number/i), '1234567890');
    await userEvent.click(screen.getByRole('checkbox', { name: /offer pickup/i }));

    expect(open).toBeEnabled();
    expect(screen.queryByText(/Before your shop can open/)).toBeNull();
  });

  it('always lets the owner turn an open shop off', () => {
    setup({ enabled: true });
    expect(screen.getByRole('checkbox', { name: /open shop/i })).toBeEnabled();
  });

  it('saves only the changed fields in one call, and shows a refusal', async () => {
    const api = setup({}, { api: { save: vi.fn().mockRejectedValue(new ApiError(409, 'STORE_NOT_READY', 'Before your shop can open, turn on pickup or delivery.')) } });
    await userEvent.type(screen.getByLabelText(/^bank name/i), 'Maybank');
    await userEvent.clear(screen.getByLabelText(/days of notice/i));
    await userEvent.type(screen.getByLabelText(/days of notice/i), '3');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));

    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith({ bankName: 'Maybank', minNoticeDays: 3 });
    expect(await screen.findByText('Before your shop can open, turn on pickup or delivery.')).toBeInTheDocument();
  });

  it('confirms a save, and sends only what changed since', async () => {
    const api = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /offer pickup/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(api.save).toHaveBeenCalledWith({ pickupEnabled: true });
    expect(await screen.findByText(/^saved/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/pickup note/i), 'Ask at the door');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(api.save).toHaveBeenLastCalledWith({ pickupNote: 'Ask at the door' });
  });

  it('turns a flat fee typed in ringgit into sen', async () => {
    const api = setup();
    await userEvent.click(screen.getByRole('radio', { name: /flat fee/i }));
    await userEvent.type(screen.getByLabelText(/delivery fee/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(api.save).toHaveBeenCalledWith({ deliveryMode: 'FLAT', deliveryFeeCents: 1000 });
  });

  it.each(['abc', '0', '501', '10.555'])('refuses a flat fee of %s without calling the API', async (typed) => {
    const api = setup();
    await userEvent.click(screen.getByRole('radio', { name: /flat fee/i }));
    await userEvent.type(screen.getByLabelText(/delivery fee/i), typed);
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(screen.getByText('Give flat delivery a fee above RM0, up to RM500.')).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('refuses a notice that is not a whole number of days from 0 to 30', async () => {
    const api = setup();
    await userEvent.clear(screen.getByLabelText(/days of notice/i));
    await userEvent.type(screen.getByLabelText(/days of notice/i), '31');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(screen.getByText('Notice is a whole number of days, from 0 to 30.')).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('says a rider is paid separately', async () => {
    setup();
    expect(screen.queryByText(/Customers pay the rider directly/)).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /rider paid separately/i }));
    expect(screen.getByText('Customers pay the rider directly. It is never added to their total.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/delivery fee/i)).toBeNull();
  });

  it('says pictures are switched off, while bank details still work', async () => {
    const api = setup({}, { uploadsEnabled: false });
    expect(screen.getByText(/switched off here/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/upload a payment qr/i)).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^bank name/i), 'CIMB');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(api.save).toHaveBeenCalledWith({ bankName: 'CIMB' });
  });

  it('does not claim pictures are off when they are on', () => {
    setup();
    expect(screen.queryByText(/switched off here/i)).toBeNull();
    expect(screen.getByLabelText(/upload a payment qr/i)).toBeEnabled();
  });

  it('uploads a QR, shows it, and lets the shop open on it', async () => {
    const api = setup({ pickupEnabled: true });
    const file = new File(['x'], 'qr.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/upload a payment qr/i), file);
    expect(api.uploadQr).toHaveBeenCalledWith(file);
    expect(await screen.findByAltText(/payment qr/i)).toHaveAttribute('src', 'https://files.example/qr.webp');
    expect(screen.getByRole('checkbox', { name: /open shop/i })).toBeEnabled();
  });

  it('removes the QR, and keeps it with the reason when that is refused', async () => {
    const removeQr = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'STORE_NOT_READY', 'Your shop is open and this QR is its only way to pay. Add bank details first.'))
      .mockResolvedValue(undefined);
    setup({ paymentQrKey: 'k', enabled: true }, { qrUrl: 'https://files.example/k', api: { removeQr } });

    await userEvent.click(screen.getByRole('button', { name: /remove qr/i }));
    expect(removeQr).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/this QR is its only way to pay/)).toBeInTheDocument();
    expect(screen.getByAltText(/payment qr/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /remove qr/i }));
    expect(screen.queryByAltText(/payment qr/i)).toBeNull();
    expect(screen.queryByText(/this QR is its only way to pay/)).toBeNull();
  });
});
