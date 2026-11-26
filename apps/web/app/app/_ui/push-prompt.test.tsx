import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PushClient } from '../../../lib/push-client.js';
import { PUSH_DISMISSED_AT_KEY, PUSH_DISMISS_MS, PUSH_DONE_MS, PushPrompt } from './push-prompt.js';

function aClient(over: Partial<PushClient> = {}): PushClient {
  return {
    support: () => 'ok',
    publicKey: vi.fn(async () => 'BKey'),
    permission: () => 'default',
    current: vi.fn(async () => null),
    turnOn: vi.fn(async () => 'on' as const),
    turnOff: vi.fn(async () => undefined),
    test: vi.fn(async () => undefined),
    ...over,
  };
}

const ASK = 'Get a buzz for new orders on this phone?';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('PushPrompt', () => {
  it('asks in the installed app while permission is undecided', async () => {
    render(<PushPrompt client={aClient()} installed={() => true} />);
    expect(await screen.findByText(ASK)).toBeInTheDocument();
    expect(screen.getByText('New orders, receipts and leads, the moment they come in.')).toBeInTheDocument();
  });

  it('stays away in a browser tab without asking the network', async () => {
    const client = aClient();
    render(<PushPrompt client={client} installed={() => false} />);
    await act(async () => undefined);
    expect(screen.queryByText(ASK)).toBeNull();
    expect(client.publicKey).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<PushClient>]>([
    ['unsupported', { support: () => 'unsupported' as const }],
    ['denied', { permission: () => 'denied' as const }],
    ['already subscribed', { permission: () => 'granted' as const, current: async () => 'https://push.example/me' }],
    ['switched off on the server', { publicKey: async () => null }],
  ])('is hidden when %s', async (_name, over) => {
    render(<PushPrompt client={aClient(over)} installed={() => true} />);
    await act(async () => undefined);
    expect(screen.queryByText(ASK)).toBeNull();
  });

  it('shows when permission is granted but there is no subscription', async () => {
    render(<PushPrompt client={aClient({ permission: () => 'granted' })} installed={() => true} />);
    expect(await screen.findByText(ASK)).toBeInTheDocument();
  });

  it('is hidden for 14 days after Not now, then returns', async () => {
    render(<PushPrompt client={aClient()} installed={() => true} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(ASK)).toBeNull();
    expect(Number(window.localStorage.getItem(PUSH_DISMISSED_AT_KEY))).toBeGreaterThan(0);

    const again = render(<PushPrompt client={aClient()} installed={() => true} />);
    await act(async () => undefined);
    expect(again.queryByText(ASK)).toBeNull();

    window.localStorage.setItem(PUSH_DISMISSED_AT_KEY, String(Date.now() - PUSH_DISMISS_MS - 1000));
    again.unmount();
    render(<PushPrompt client={aClient()} installed={() => true} />);
    expect(await screen.findByText(ASK)).toBeInTheDocument();
  });

  it('turns on from the tap, shows success, then goes away', async () => {
    const client = aClient();
    render(<PushPrompt client={client} installed={() => true} />);
    const button = await screen.findByRole('button', { name: 'Turn on' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(button);
    expect(client.turnOn).toHaveBeenCalledWith('BKey');
    expect(await screen.findByText('Notifications are on for this phone.')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(PUSH_DONE_MS + 100);
    });
    expect(screen.queryByText('Notifications are on for this phone.')).toBeNull();
  });

  it('hides when the answer is denied', async () => {
    const client = aClient({ turnOn: vi.fn(async () => 'denied' as const) });
    render(<PushPrompt client={client} installed={() => true} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(screen.queryByText(ASK)).toBeNull());
    expect(screen.queryByText('Notifications are on for this phone.')).toBeNull();
  });

  it('treats a closed browser prompt as Not now, not a block', async () => {
    const client = aClient({ turnOn: vi.fn(async () => 'denied' as const), permission: () => 'default' });
    render(<PushPrompt client={client} installed={() => true} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(screen.queryByText(ASK)).toBeNull());
    expect(Number(window.localStorage.getItem(PUSH_DISMISSED_AT_KEY))).toBeGreaterThan(0);
  });

  it('stores nothing when the answer is a real denial', async () => {
    let permission: NotificationPermission = 'default';
    const client = aClient({
      turnOn: vi.fn(async () => {
        permission = 'denied';
        return 'denied' as const;
      }),
      permission: () => permission,
    });
    render(<PushPrompt client={client} installed={() => true} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(screen.queryByText(ASK)).toBeNull());
    expect(window.localStorage.getItem(PUSH_DISMISSED_AT_KEY)).toBeNull();
  });

  it('shows an error with Try again when turning on fails', async () => {
    const turnOn = vi.fn<PushClient['turnOn']>().mockRejectedValueOnce(new Error('Offline.')).mockResolvedValueOnce('on');
    const turnOff = vi.fn(async () => undefined);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<PushPrompt client={aClient({ turnOn, turnOff })} installed={() => true} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText(/Couldn.t turn on notifications\. Try again, or use Settings/)).toBeInTheDocument();
    expect(screen.queryByText('Offline.')).toBeNull();
    expect(spy).toHaveBeenCalled();
    expect(turnOff).toHaveBeenCalled();
    spy.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Notifications are on for this phone.')).toBeInTheDocument();
  });

  it('waits behind the new-version card', async () => {
    const client = aClient();
    const { rerender } = render(<PushPrompt held client={client} installed={() => true} />);
    await act(async () => undefined);
    expect(screen.queryByText(ASK)).toBeNull();
    rerender(<PushPrompt held={false} client={client} installed={() => true} />);
    expect(await screen.findByText(ASK)).toBeInTheDocument();
  });
});
