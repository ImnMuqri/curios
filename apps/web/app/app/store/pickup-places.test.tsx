import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ApiError } from '../../../lib/api.js';
import { PickupPlaces } from './pickup-places.js';
import type { PickupApi, PickupPlaceView } from './store-types.js';

const shop: PickupPlaceView = { id: 'p1', name: 'Seksyen 7 stall', address: 'Jalan 7/1, Shah Alam', mapUrl: null, note: null, anyTime: true, windows: [] };
const timed: PickupPlaceView = {
  id: 'p2', name: 'Bangi office', address: 'Lot 3, Bangi', mapUrl: null, note: null, anyTime: false,
  windows: [{ id: 'w1', from: 600, to: 720, limit: null }, { id: 'w2', from: 840, to: 960, limit: 5 }],
};

function show(places: PickupPlaceView[], over: Partial<PickupApi> = {}) {
  const api: PickupApi = {
    list: vi.fn(async () => places),
    add: vi.fn(async () => places),
    save: vi.fn(async () => places),
    remove: vi.fn(async () => places),
    reorder: vi.fn(async () => places),
    ...over,
  };
  render(<PickupPlaces places={places} api={api} />);
  return api;
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('PickupPlaces', () => {
  it('lists each place with its address and times', () => {
    show([shop, timed]);
    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Seksyen 7 stall');
    expect(first).toHaveTextContent('Jalan 7/1, Shah Alam');
    expect(first).toHaveTextContent('Any time');
    expect(second).toHaveTextContent('10am–12pm · 2pm–4pm (up to 5)');
  });

  it('opens a form with the fields and the When choice', () => {
    show([shop]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add pickup place' }));
    for (const label of ['Name', 'Address', 'Map link', 'Note']) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Any time that day/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Set times/ }));
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'time');
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'time');
    expect(screen.getByLabelText('Limit')).toHaveAttribute('placeholder', 'No limit');
    fireEvent.click(screen.getByRole('button', { name: '+ Add a time' }));
    expect(screen.getAllByLabelText('From')).toHaveLength(2);
  });

  it('saves a new place with its times in minutes', async () => {
    const api = show([shop]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add pickup place' }));
    type('Name', 'Bangi office');
    type('Address', 'Lot 3, Bangi');
    fireEvent.click(screen.getByRole('button', { name: /Set times/ }));
    type('From', '10:00');
    type('To', '12:30');
    type('Limit', '5');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add place' })); });
    expect(api.add).toHaveBeenCalledWith({
      name: 'Bangi office', address: 'Lot 3, Bangi', mapUrl: null, note: null, anyTime: false,
      windows: [{ from: 600, to: 750, limit: 5 }],
    });
  });

  it('saves a place open any time with no windows', async () => {
    const api = show([shop]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add pickup place' }));
    type('Name', 'Stall');
    type('Address', 'Jalan 1');
    type('Map link', 'https://maps.example/x');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add place' })); });
    expect(api.add).toHaveBeenCalledWith({ name: 'Stall', address: 'Jalan 1', mapUrl: 'https://maps.example/x', note: null, anyTime: true, windows: [] });
  });

  it('refuses overlapping times with the rule words and sends nothing', async () => {
    const api = show([shop]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add pickup place' }));
    type('Name', 'Bangi');
    type('Address', 'Lot 3');
    fireEvent.click(screen.getByRole('button', { name: /Set times/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add a time' }));
    const [from1, from2] = screen.getAllByLabelText('From');
    const [to1, to2] = screen.getAllByLabelText('To');
    fireEvent.change(from1!, { target: { value: '10:00' } });
    fireEvent.change(to1!, { target: { value: '12:00' } });
    fireEvent.change(from2!, { target: { value: '11:00' } });
    fireEvent.change(to2!, { target: { value: '13:00' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add place' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/overlap/i);
    expect(api.add).not.toHaveBeenCalled();
  });

  it('edits a place and keeps its windows ids', async () => {
    const api = show([timed]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bangi office' }));
    fireEvent.change(screen.getAllByLabelText('Limit')[0]!, { target: { value: '3' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save place' })); });
    expect(api.save).toHaveBeenCalledWith('p2', expect.objectContaining({
      anyTime: false,
      windows: [{ id: 'w1', from: 600, to: 720, limit: 3 }, { id: 'w2', from: 840, to: 960, limit: 5 }],
    }));
  });

  it('asks before removing, then removes', async () => {
    const api = show([shop, timed]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bangi office' }));
    expect(api.remove).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(screen.getByRole('group', { name: 'Confirm remove' })).getByRole('button', { name: 'Yes, remove' })); });
    expect(api.remove).toHaveBeenCalledWith('p2');
  });

  it('shows the API words when the last place cannot go', async () => {
    const words = 'Pickup is on, so keep at least one place.';
    show([shop], { remove: async () => { throw new ApiError(409, 'PICKUP_LAST_PLACE', words); } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Seksyen 7 stall' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(words);
  });

  it('reorders with the move buttons', async () => {
    const api = show([shop, timed]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move Bangi office up' })); });
    expect(api.reorder).toHaveBeenCalledWith(['p2', 'p1']);
    expect(screen.getByRole('button', { name: 'Move Seksyen 7 stall up' })).toBeDisabled();
  });
});
