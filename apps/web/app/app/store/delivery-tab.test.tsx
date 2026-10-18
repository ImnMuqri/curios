import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DeliveryTab } from './delivery-tab.js';
import type { SettingsPatch, StoreSettings } from './store-types.js';

const settings: StoreSettings = {
  enabled: true, shopDescription: null, pickupEnabled: true, pickupNote: 'Seksyen 7', deliveryMode: 'NONE',
  deliveryFeeCents: null, minNoticeDays: 2, paymentQrKey: 'qr', bankName: null,
  bankAccountName: null, bankAccountNumber: null, tileSize: null,
  closedDays: [0], deliveryNote: null,
};

// A Friday.
const today = new Date(2026, 9, 16);

function show(over: Partial<StoreSettings> = {}, save?: (patch: SettingsPatch) => Promise<StoreSettings>) {
  const saveFn = vi.fn(save ?? (async (patch: SettingsPatch) => ({ ...settings, ...over, ...patch })));
  render(<DeliveryTab settings={{ ...settings, ...over }} save={saveFn} today={today} />);
  return saveFn;
}

const tile = (name: RegExp) => screen.getByRole('button', { name });

afterEach(() => vi.useRealTimers());

describe('DeliveryTab, pickup', () => {
  it('turns pickup off at once', async () => {
    const save = show();
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Allow pickup' })); });
    expect(save).toHaveBeenCalledWith({ pickupEnabled: false });
    expect(screen.queryByLabelText('Where and when')).toBeNull();
  });

  it('puts the switch back, with the reason, when that would leave an open shop no way to hand over', async () => {
    show({}, async () => { throw new Error('Before your shop can open, turn on pickup or delivery.'); });
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Allow pickup' })); });
    expect(screen.getByRole('switch', { name: 'Allow pickup' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('turn on pickup or delivery');
  });

  it('saves the pickup note once the owner pauses', async () => {
    vi.useFakeTimers();
    const save = show();
    fireEvent.change(screen.getByLabelText('Where and when'), { target: { value: 'Seksyen 9, 10am to 6pm' } });
    expect(screen.getByText('22/120')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(save).toHaveBeenCalledWith({ pickupNote: 'Seksyen 9, 10am to 6pm' });
  });
});

describe('DeliveryTab, delivery', () => {
  it('saves a rider at once', async () => {
    const save = show();
    await act(async () => { fireEvent.click(tile(/Rider paid separately/)); });
    expect(save).toHaveBeenCalledWith({ deliveryMode: 'RIDER' });
    expect(tile(/Rider paid separately/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('waits for a fee before sending flat delivery, then sends the two together, in sen', async () => {
    vi.useFakeTimers();
    const save = show();
    await act(async () => { fireEvent.click(tile(/Flat fee/)); });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('Give flat delivery a fee above RM0, up to RM500.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Delivery fee in ringgit'), { target: { value: '10.50' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(save).toHaveBeenCalledWith({ deliveryMode: 'FLAT', deliveryFeeCents: 1050 });
    expect(screen.getByText('Added to every delivery order')).toBeInTheDocument();
  });

  it('sends flat delivery at once when the fee is already there', async () => {
    const save = show({ deliveryMode: 'RIDER', deliveryFeeCents: null });
    fireEvent.click(tile(/Flat fee/));
    fireEvent.change(screen.getByLabelText('Delivery fee in ringgit'), { target: { value: '8' } });
    save.mockClear();
    await act(async () => { fireEvent.click(tile(/No delivery/)); });
    await act(async () => { fireEvent.click(tile(/Flat fee/)); });
    expect(save).toHaveBeenLastCalledWith({ deliveryMode: 'FLAT', deliveryFeeCents: 800 });
  });

  it('puts the choice back, with the reason, when the API refuses it', async () => {
    show({ pickupEnabled: false, deliveryMode: 'RIDER' }, async () => { throw new Error('Before your shop can open, turn on pickup or delivery.'); });
    await act(async () => { fireEvent.click(tile(/No delivery/)); });
    expect(tile(/Rider paid separately/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('turn on pickup or delivery');
  });
});

describe('DeliveryTab, notice', () => {
  it('steps the notice and saves it, from 0 to 30', async () => {
    vi.useFakeTimers();
    const save = show({ minNoticeDays: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'One day less' }));
    expect(screen.getByText('Same day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'One day less' })).toBeDisabled();
    expect(screen.getByText('Customers can order for today.')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(save).toHaveBeenCalledWith({ minNoticeDays: 0 });
  });

  it('crosses out the days a customer cannot have, and names the first they can', () => {
    const { container } = render(<DeliveryTab settings={settings} save={vi.fn()} today={today} />);
    const days = [...container.querySelectorAll('[data-when]')].map((day) => [day.textContent, day.getAttribute('data-when')]);
    expect(days).toEqual([
      ['Today16', 'before'],
      ['Sat17', 'before'],
      ['Sun18', 'first'],
    ]);
    expect(screen.getByText('Ordering today, the earliest a customer can have it is Sun 18 Oct.')).toBeInTheDocument();
  });

  it('stops at 30 days', () => {
    show({ minNoticeDays: 30 });
    expect(screen.getByRole('button', { name: 'One day more' })).toBeDisabled();
    expect(screen.getByText('Customers order 30 days ahead.')).toBeInTheDocument();
  });
});

describe('DeliveryTab, closed days and the delivery note', () => {
  it('toggles a closed day and saves it', async () => {
    vi.useFakeTimers();
    const save = show();
    const pills = screen.getAllByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/ });
    expect(pills.map((pill) => pill.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(save).toHaveBeenCalledWith({ closedDays: [0, 1] });
    fireEvent.click(screen.getByRole('button', { name: 'Sun' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(save).toHaveBeenLastCalledWith({ closedDays: [1] });
  });

  it('saves the delivery note as typed', async () => {
    vi.useFakeTimers();
    const save = show({ deliveryMode: 'RIDER' });
    fireEvent.change(screen.getByLabelText('Delivery note'), { target: { value: 'Around Shah Alam · 2pm to 6pm' } });
    expect(screen.getByText('29/120')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(save).toHaveBeenCalledWith({ deliveryNote: 'Around Shah Alam · 2pm to 6pm' });
  });
});
