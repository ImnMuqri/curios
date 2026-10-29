import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '../../../lib/api.js';
import { PaymentTab } from './payment-tab.js';
import type { ChipApi, ChipState, SettingsPatch, StoreSettings } from './store-types.js';

const settings: StoreSettings = {
  enabled: false, shopDescription: null, shopHalal: false, pickupEnabled: true, pickupNote: null, deliveryMode: 'NONE',
  deliveryFeeCents: null, minNoticeDays: 1, closedDays: [], deliveryNote: null, paymentQrKey: null, bankName: null,
  bankAccountName: null, bankAccountNumber: null, tileSize: null,
};

const NOW = new Date('2026-10-23T04:00:00Z');
const notConnected: ChipState = { connected: false, brandName: null, methods: [], checkedAt: null, isTest: false };
const connected: ChipState = { connected: true, brandName: 'Kek Lina Bakes', methods: ['fpx', 'visa'], checkedAt: new Date('2026-10-23T03:59:30Z'), isTest: false };

function show(
  over: Partial<StoreSettings> = {},
  opts: { qr?: { has: boolean; url: string | null }; uploadsEnabled?: boolean; save?: (patch: SettingsPatch) => Promise<StoreSettings>; removeQr?: () => Promise<void>; chip?: ChipState; chipApi?: Partial<ChipApi> } = {},
) {
  const props = {
    save: vi.fn(opts.save ?? (async (patch: SettingsPatch) => ({ ...settings, ...over, ...patch }))),
    uploadQr: vi.fn(async () => 'https://files.example/qr/new.png'),
    removeQr: vi.fn(opts.removeQr ?? (async () => undefined)),
    onQr: vi.fn(),
    onChip: vi.fn(),
    navigate: vi.fn(),
    chipApi: {
      connect: vi.fn(opts.chipApi?.connect ?? (async () => ({ ...connected, brandName: null, checkedAt: NOW }))),
      disconnect: vi.fn(opts.chipApi?.disconnect ?? (async () => undefined)),
      test: vi.fn(opts.chipApi?.test ?? (async () => 'https://gate.chip-in.asia/p/test/')),
    },
  };
  const view = render(
    <PaymentTab displayName="Kek Lina" settings={{ ...settings, ...over }} qr={opts.qr ?? { has: false, url: null }} uploadsEnabled={opts.uploadsEnabled ?? true} chip={opts.chip ?? notConnected} now={NOW} {...props} />,
  );
  return { ...props, view };
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
    expect(screen.getByText('Customers scan it on their order page, with the exact total shown. No CHIP fee.')).toBeInTheDocument();
    expect(screen.getByText('Your QR is ready')).toBeInTheDocument();
    expect(screen.getByText('Kek Lina · DuitNow. Each order page shows it with the exact total, so customers pay the right amount.')).toBeInTheDocument();
  });

  it('says uploads are off, while the bank fields still work', () => {
    show({}, { uploadsEnabled: false });
    expect(screen.getByRole('button', { name: /Upload your DuitNow QR/ })).toBeDisabled();
    expect(screen.getByText('Uploading pictures is switched off here.')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank name')).toBeEnabled();
  });
});

describe('PaymentTab, online payments', () => {
  it('sits above the DuitNow QR, and invites the owner to connect CHIP', () => {
    show();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings.slice(0, 2)).toEqual(['Online payments', 'DuitNow QR']);
    expect(screen.getByText('FPX, e-wallets and cards through your own CHIP account. Orders mark themselves paid.')).toBeInTheDocument();
    expect(screen.getByText('Let customers pay online')).toBeInTheDocument();
    expect(screen.getByText('Connect your own CHIP account. Customers pick their bank or e-wallet at checkout, and the order marks itself paid. No receipts to check.')).toBeInTheDocument();
    expect(screen.getByText('Your DuitNow QR below stays on, with no CHIP fee')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'No account yet? Sign up' })).toHaveAttribute('target', '_blank');
  });

  it('does not show Boost, which CHIP cannot take', () => {
    const { view } = show();
    expect(view.container.textContent).not.toContain('Boost');
  });

  it('asks for the Brand ID and secret key, monospace and never autofilled, and Cancel goes back', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Connect CHIP' }));
    expect(screen.getByText('Copy these from your CHIP dashboard, under Developers. We only use them to take payments for your orders.')).toBeInTheDocument();
    for (const label of ['Brand ID', 'Secret key']) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveValue('');
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field.closest('label')?.className).toMatch(/mono/);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Let customers pay online')).toBeInTheDocument();
  });

  it('checks and connects, then shows the connection and forgets what was typed', async () => {
    const props = show();
    fireEvent.click(screen.getByRole('button', { name: 'Connect CHIP' }));
    fireEvent.change(screen.getByLabelText('Brand ID'), { target: { value: 'brand-uuid' } });
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'the-secret-key' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check and connect' })); });

    expect(props.chipApi.connect).toHaveBeenCalledWith('brand-uuid', 'the-secret-key');
    expect(props.onChip).toHaveBeenCalledWith({ ...connected, brandName: null, checkedAt: NOW });
    props.view.rerender(
      <PaymentTab displayName="Kek Lina" settings={settings} qr={{ has: false, url: null }} uploadsEnabled chip={{ ...connected, brandName: null, checkedAt: NOW }} now={NOW} {...props} />,
    );
    expect(screen.getByText('Connected to CHIP')).toBeInTheDocument();
    expect(screen.queryByLabelText('Secret key')).toBeNull();
    expect(props.view.container.innerHTML).not.toContain('the-secret-key');
  });

  it('keeps the form, with the API’s reason, when CHIP refuses the key', async () => {
    const props = show({}, { chipApi: { connect: async () => { throw new ApiError(400, 'CHIP_KEY_REFUSED', "That key or Brand ID didn't work. Copy both again from your CHIP dashboard, under Developers."); } } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect CHIP' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check and connect' })); });
    expect(screen.getByRole('alert')).toHaveTextContent("That key or Brand ID didn't work.");
    expect(screen.getByLabelText('Secret key')).toBeInTheDocument();
    expect(props.onChip).not.toHaveBeenCalled();
  });

  it('says CHIP is not answering on an outage', async () => {
    show({}, { chipApi: { connect: async () => { throw new ApiError(502, 'CHIP_UNAVAILABLE', 'Something failed on our side. Try again.'); } } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect CHIP' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check and connect' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('CHIP is not answering right now. Try again in a few minutes.');
  });

  it('shows the brand and when it was checked, in the board’s words', () => {
    show({}, { chip: connected });
    expect(screen.getByText('Connected to CHIP')).toBeInTheDocument();
    expect(screen.getByText(/^Brand “Kek Lina Bakes” · checked just now\./)).toBeInTheDocument();
    expect(screen.getByText(/Customers can pay by FPX, e-wallet or card, and those orders land in Orders as Paid\. Your DuitNow QR below stays on too, with receipts to check as before\./)).toBeInTheDocument();
  });

  it('names the page when CHIP has not said the brand’s name yet, and says when the key is a test one', () => {
    show({}, { chip: { ...connected, brandName: null, isTest: true, checkedAt: new Date('2026-10-23T03:48:00Z') } });
    expect(screen.getByText(/^Brand “Kek Lina” · checked 12 min ago\./)).toBeInTheDocument();
    expect(screen.getByText('Test mode: payments here move no real money.')).toBeInTheDocument();
  });

  it('Test with RM1 opens the payment CHIP returns', async () => {
    const props = show({}, { chip: connected });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Test with RM1' })); });
    expect(props.chipApi.test).toHaveBeenCalled();
    expect(props.navigate).toHaveBeenCalledWith('https://gate.chip-in.asia/p/test/');
  });

  it('Disconnect asks first, and Keep changes nothing', async () => {
    const props = show({}, { chip: connected });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText('Disconnect CHIP? Customers can’t pay online until you connect again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(props.chipApi.disconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' })); });
    expect(props.chipApi.disconnect).toHaveBeenCalled();
    expect(props.onChip).toHaveBeenCalledWith({ connected: false, brandName: null, methods: [], checkedAt: null, isTest: false });
  });

  it('keeps the connection, with the reason, when disconnecting is refused', async () => {
    const props = show({}, { chip: connected, chipApi: { disconnect: async () => { throw new ApiError(400, 'STORE_NOT_READY', 'Your shop is open and CHIP is its only way to pay.'); } } });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('CHIP is its only way to pay.');
    expect(props.onChip).not.toHaveBeenCalled();
  });
});
