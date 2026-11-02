import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicPickupPlace } from '@curios/db-read';
import { shopCopy } from '../copy.js';
import { PickupPicker } from './pickup-picker.js';

const copy = shopCopy('en');

const home: PublicPickupPlace = {
  id: 'home',
  name: 'Home',
  address: 'No 12, Jalan Mawar, Seksyen 7',
  mapUrl: 'https://maps.app.goo.gl/abc',
  note: 'Ring the bell',
  anyTime: false,
  windows: [
    { id: 'w1', from: 600, to: 720 },
    { id: 'w2', from: 840, to: 960 },
  ],
};
const stall: PublicPickupPlace = { id: 'stall', name: 'Bazaar stall', address: 'Bazaar Ramadan, Seksyen 13', mapUrl: null, note: null, anyTime: true, windows: [] };

function reply(windows: { id: string; from: number; to: number; full: boolean }[]) {
  const spy = vi.fn(async (_url: string) => new Response(JSON.stringify({ windows }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** The picker as checkout holds it: the place and time in state, the day from outside. */
function Host({ places, day, onWindow }: { places: PublicPickupPlace[]; day: string | null; onWindow?: (id: string | null) => void }) {
  const [placeId, setPlaceId] = useState<string | null>(places.length === 1 ? places[0]!.id : null);
  const [windowId, setWindowId] = useState<string | null>(null);
  return (
    <PickupPicker
      copy={copy}
      handle="keklina"
      places={places}
      day={day}
      placeId={placeId}
      windowId={windowId}
      onPlace={setPlaceId}
      onWindow={(id) => {
        setWindowId(id);
        onWindow?.(id);
      }}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PickupPicker', () => {
  it('lists several places to pick from, each with its address and its map link when given', async () => {
    const user = userEvent.setup();
    reply([]);
    render(<Host places={[home, stall]} day={null} />);
    const where = screen.getByRole('radiogroup', { name: copy.pickupWhere });
    const [first, second] = within(where).getAllByRole('radio');
    expect(first).toHaveAccessibleName(/Home/);
    expect(within(first!).getByText('No 12, Jalan Mawar, Seksyen 7')).toBeInTheDocument();
    expect(within(second!).getByText('Bazaar Ramadan, Seksyen 13')).toBeInTheDocument();
    expect(first).toHaveAttribute('aria-checked', 'false');
    // One map link: the stall has none.
    const maps = screen.getAllByRole('link', { name: new RegExp(copy.pickupMap) });
    expect(maps).toHaveLength(1);
    expect(maps[0]).toHaveAttribute('href', 'https://maps.app.goo.gl/abc');

    await user.click(second!);
    expect(second).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the one place as text, with no choice to make', () => {
    reply([]);
    render(<Host places={[stall]} day={null} />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Bazaar stall')).toBeInTheDocument();
    expect(screen.getByText('Bazaar Ramadan, Seksyen 13')).toBeInTheDocument();
  });

  it('asks for the times once a day is picked, and a full one cannot be picked', async () => {
    const user = userEvent.setup();
    const fetch = reply([
      { id: 'w1', from: 600, to: 720, full: false },
      { id: 'w2', from: 840, to: 960, full: true },
    ]);
    const { rerender } = render(<Host places={[home]} day={null} />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('radiogroup', { name: copy.pickupTime })).toBeNull();

    rerender(<Host places={[home]} day="2026-10-17" />);
    const time = await screen.findByRole('radiogroup', { name: copy.pickupTime });
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/store\/keklina\/pickup-times\?place=home&day=2026-10-17$/);
    const open = within(time).getByRole('radio', { name: '10am–12pm' });
    const full = within(time).getByRole('radio', { name: `2pm–4pm · ${copy.pickupFull}` });
    expect(full).toBeDisabled();
    await user.click(open);
    expect(open).toHaveAttribute('aria-checked', 'true');
  });

  it('says any time that day for a place without set times, and asks nothing', () => {
    const fetch = reply([]);
    render(<Host places={[stall]} day="2026-10-17" />);
    expect(screen.getByText(copy.pickupAnyTime)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the picked time when the day changes', async () => {
    const user = userEvent.setup();
    reply([
      { id: 'w1', from: 600, to: 720, full: false },
      { id: 'w2', from: 840, to: 960, full: false },
    ]);
    const onWindow = vi.fn();
    const { rerender } = render(<Host places={[home]} day="2026-10-17" onWindow={onWindow} />);
    await user.click(await screen.findByRole('radio', { name: '10am–12pm' }));
    expect(onWindow).toHaveBeenLastCalledWith('w1');

    rerender(<Host places={[home]} day="2026-10-19" onWindow={onWindow} />);
    expect(onWindow).toHaveBeenLastCalledWith(null);
    expect(await screen.findByRole('radio', { name: '10am–12pm' })).toHaveAttribute('aria-checked', 'false');
  });
});
