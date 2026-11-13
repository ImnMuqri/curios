import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PushClient } from '../../../lib/push-client.js';
import { PushDeviceForm } from './push-device.js';

function aClient(over: Partial<PushClient> = {}): PushClient {
  return {
    support: () => 'ok',
    publicKey: async () => 'BKey',
    permission: () => 'default',
    current: async () => null,
    turnOn: vi.fn(async () => 'on' as const),
    turnOff: vi.fn(async () => undefined),
    test: vi.fn(async () => undefined),
    ...over,
  };
}

describe('Notify this device', () => {
  it('turns notifications on with a tap, then offers a test', async () => {
    const client = aClient();
    render(<PushDeviceForm client={client} />);
    const toggle = await screen.findByRole('switch', { name: 'Notify this device' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);
    expect(client.turnOn).toHaveBeenCalledWith('BKey');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

    await userEvent.click(screen.getByRole('button', { name: 'Send a test' }));
    expect(client.test).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Sent.');
  });

  it('shows on for a device already subscribed, and turns it off', async () => {
    const client = aClient({ permission: () => 'granted', current: async () => 'https://push.example/me' });
    render(<PushDeviceForm client={client} />);
    const toggle = await screen.findByRole('switch', { name: 'Notify this device' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(toggle);
    expect(client.turnOff).toHaveBeenCalled();
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  // Apple allows web push only from the Home Screen: the row says how, instead of a switch that cannot work.
  it('tells an iPhone in Safari to add Curios to the Home Screen first', async () => {
    render(<PushDeviceForm client={aClient({ support: () => 'ios-install' })} />);
    expect(await screen.findByText(/tap Share, then Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('says where to unblock them when the browser was told no', async () => {
    render(<PushDeviceForm client={aClient({ permission: () => 'denied' })} />);
    expect(await screen.findByText(/Blocked for Curios in this browser’s settings/)).toBeInTheDocument();
  });

  it('moves to blocked when the owner says no to the browser’s question', async () => {
    render(<PushDeviceForm client={aClient({ turnOn: vi.fn(async () => 'denied' as const) })} />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Notify this device' }));
    expect(await screen.findByText(/Blocked for Curios/)).toBeInTheDocument();
  });

  it('draws nothing where push is switched off on the server', async () => {
    const { container } = render(<PushDeviceForm client={aClient({ publicKey: async () => null })} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('keeps the switch where it was and says why when saving fails', async () => {
    render(<PushDeviceForm client={aClient({ turnOn: vi.fn(async () => { throw new Error('No connection. Try again.'); }) })} />);
    const toggle = await screen.findByRole('switch', { name: 'Notify this device' });
    await userEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection. Try again.');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});
