import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '../../../lib/api.js';
import { PaymentTab } from './payment-tab.js';
import type { SettingsPatch, StoreSettings } from './store-types.js';

const settings: StoreSettings = {
  enabled: false, shopDescription: null, pickupEnabled: true, pickupNote: null, deliveryMode: 'NONE',
  deliveryFeeCents: null, minNoticeDays: 1, closedDays: [], deliveryNote: null, paymentQrKey: null, bankName: null,
  bankAccountName: null, bankAccountNumber: null, tileSize: null,
};

function show(over: Partial<StoreSettings> = {}, opts: { qr?: { has: boolean; url: string | null }; uploadsEnabled?: boolean; save?: (patch: SettingsPatch) => Promise<StoreSettings>; removeQr?: () => Promise<void> } = {}) {
  const props = {
    save: vi.fn(opts.save ?? (async (patch: SettingsPatch) => ({ ...settings, ...over, ...patch }))),
    uploadQr: vi.fn(async () => 'https://files.example/qr/new.png'),
    removeQr: vi.fn(opts.removeQr ?? (async () => undefined)),
    onQr: vi.fn(),
  };
  render(<PaymentTab settings={{ ...settings, ...over }} qr={opts.qr ?? { has: false, url: null }} uploadsEnabled={opts.uploadsEnabled ?? true} {...props} />);
  return props;
}

const pause = () => act(async () => { await vi.advanceTimersByTimeAsync(600); });

afterEach(() => vi.useRealTimers());

describe('PaymentTab, the bank account', () => {
  it('fills in the bank name from a chip, and saves it once the owner pauses', async () => {
    vi.useFakeTimers();
    const props = show();
    fireEvent.click(screen.getByRole('button', { name: 'CIMB' }));
    expect(screen.getByLabelText('Bank name')).toHaveValue('CIMB');
    expect(screen.getByRole('button', { name: 'CIMB' })).toHaveAttribute('aria-pressed', 'true');
    await pause();
    expect(props.save).toHaveBeenCalledWith({ bankName: 'CIMB' });
  });

  it('saves each field on its own, and a cleared field as no value', async () => {
    vi.useFakeTimers();
    const props = show({ bankAccountName: 'Lina' });
    fireEvent.change(screen.getByLabelText('Account name'), { target: { value: '  ' } });
    await pause();
    expect(props.save).toHaveBeenCalledWith({ bankAccountName: null });
  });

  it('shows the API’s own reason when it refuses a field', async () => {
    vi.useFakeTimers();
    show({}, { save: async () => { throw new ApiError(400, 'INVALID_STORE_SETTING', 'That account number does not look right. Use the digits on your bank card or app.'); } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '12ab' } });
    await pause();
    expect(screen.getByRole('alert')).toHaveTextContent('That account number does not look right.');
  });

  it('says what the bank details still need, and when they are complete', () => {
    show();
    expect(screen.getByText('Fill in all three to use it')).toBeInTheDocument();
  });

  it('says the money is the owner’s', () => {
    show({ bankName: 'Maybank', bankAccountName: 'Lina', bankAccountNumber: '1234567890' });
    expect(screen.getByText('All three filled in')).toBeInTheDocument();
    expect(screen.getByText('Money goes straight to you. Curios never holds it.')).toBeInTheDocument();
  });
});

describe('PaymentTab, the QR', () => {
  it('uploads a QR and hands it up', async () => {
    const props = show();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('QR file'), { target: { files: [new File(['x'], 'qr.png', { type: 'image/png' })] } });
    });
    expect(props.uploadQr).toHaveBeenCalled();
    expect(props.onQr).toHaveBeenCalledWith({ has: true, url: 'https://files.example/qr/new.png' });
  });

  it('shows a saved QR, and removes it', async () => {
    const props = show({ paymentQrKey: 'qr/k.png' }, { qr: { has: true, url: 'https://files.example/qr/k.png' } });
    expect(screen.getByAltText('Your DuitNow QR')).toHaveAttribute('src', 'https://files.example/qr/k.png');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove' })); });
    expect(props.removeQr).toHaveBeenCalled();
    expect(props.onQr).toHaveBeenCalledWith({ has: false, url: null });
  });

  it('keeps the QR, with the reason, when removing it is refused', async () => {
    const props = show({}, { qr: { has: true, url: null }, removeQr: async () => { throw new Error('Your shop is open and this QR is its only way to pay.'); } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove' })); });
    expect(props.onQr).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('only way to pay');
  });

  it('says where customers see the QR, in the board’s words', () => {
    show({}, { qr: { has: true, url: null } });
    expect(screen.getByText('Customers scan it on their order page')).toBeInTheDocument();
    expect(screen.getByText('Your QR is ready')).toBeInTheDocument();
    expect(screen.getByText('Each order page shows it with the exact total, so customers pay the right amount.')).toBeInTheDocument();
  });

  it('says uploads are off, while the bank fields still work', () => {
    show({}, { uploadsEnabled: false });
    expect(screen.getByRole('button', { name: /Upload your DuitNow QR/ })).toBeDisabled();
    expect(screen.getByText('Uploading pictures is switched off here.')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank name')).toBeEnabled();
  });
});
