import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, type Settings } from '@curios/core/settings';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
}));
const apiFetch = vi.fn();
vi.mock('../../../lib/api.js', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly fields: string[] = [],
    ) {
      super(message);
    }
  },
}));

import { ApiError } from '../../../lib/api.js';
import { ControlsScreen, ControlsUnavailable } from './controls-screen.js';

const settings = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), cap: 200, ...over });
const off = (key: keyof Settings['switches']): Settings => {
  const s = settings();
  return { ...s, switches: { ...s.switches, [key]: false } };
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(null);
  refresh.mockClear();
});

const body = (call = 0) => JSON.parse((apiFetch.mock.calls[call]![1] as { body: string }).body) as Record<string, unknown>;

describe('the switches', () => {
  it('shows the five with the board’s titles and the amended sublines, all on by default', () => {
    render(<ControlsScreen settings={settings()} />);

    for (const title of ['Chat answers', 'New sign-ups', 'Reading new sources', 'Online payments (CHIP)', 'Emails to owners']) {
      expect(screen.getByRole('switch', { name: title })).toHaveAttribute('aria-checked', 'true');
    }
    expect(screen.getByText('Off: emails to owners are not sent. Sign-in and password emails still go.')).toBeInTheDocument();
    expect(screen.getByText('Off: checkouts offer only the owner’s own QR or bank transfer.')).toBeInTheDocument();
    expect(screen.getByText('Off: every page gives the short fixed reply and points to its links.')).toBeInTheDocument();
  });

  it('turning chat off asks for a reason with the board’s copy, then PUTs { on: false, reason }', async () => {
    render(<ControlsScreen settings={settings()} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Chat answers' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn off chat answers for everyone?' });
    expect(within(dialog).getByText('Every page switches to the short fixed reply straight away.')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Reason, for the audit log'), 'Model provider outage');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn it off' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/settings/switches/chat', expect.objectContaining({ method: 'PUT' }));
    expect(body()).toEqual({ on: false, reason: 'Model provider outage' });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Chat answers are off everywhere.');
  });

  it('turning another off says "Turn off {title}?" with its subline as the text', async () => {
    render(<ControlsScreen settings={settings()} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Emails to owners' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn off emails to owners?' });
    expect(within(dialog).getByText('Off: emails to owners are not sent. Sign-in and password emails still go.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Reason, for the audit log'), 'Mail provider is down');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn it off' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/settings/switches/ownerEmails', expect.anything());
    expect(screen.getByRole('status')).toHaveTextContent('Emails to owners off.');
  });

  it('turning one on PUTs at once, with no dialog', async () => {
    render(<ControlsScreen settings={off('signups')} />);

    await userEvent.click(screen.getByRole('switch', { name: 'New sign-ups' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith('/admin/settings/switches/signups', expect.objectContaining({ method: 'PUT' }));
    expect(body()).toEqual({ on: true });
    expect(screen.getByRole('status')).toHaveTextContent('New sign-ups on.');
  });

  it('keeps the dialog open and says why when the API refuses', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'SWITCH_STATE', 'That is already off.'));
    render(<ControlsScreen settings={settings()} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Reading new sources' }));
    await userEvent.type(screen.getByLabelText('Reason, for the audit log'), 'Queue stuck');
    await userEvent.click(screen.getByRole('button', { name: 'Turn it off' }));

    expect(screen.getByRole('alert')).toHaveTextContent('That is already off.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('refreshes the screen on 409 SWITCH_STATE, and keeps the API’s message', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'SWITCH_STATE', 'That is already off.'));
    render(<ControlsScreen settings={settings()} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Reading new sources' }));
    await userEvent.type(screen.getByLabelText('Reason, for the audit log'), 'Queue stuck');
    await userEvent.click(screen.getByRole('button', { name: 'Turn it off' }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('That is already off.');
  });

  it('says so, in words, when turning one on fails', async () => {
    apiFetch.mockRejectedValueOnce(new Error('boom: ECONNREFUSED'));
    render(<ControlsScreen settings={off('signups')} />);

    await userEvent.click(screen.getByRole('switch', { name: 'New sign-ups' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Something failed. Try again.');
  });
});

describe('the banner', () => {
  it('shows with Show banner, disabled while empty, and sends the text', async () => {
    render(<ControlsScreen settings={settings()} />);

    expect(screen.getByRole('button', { name: 'Show banner' })).toBeDisabled();
    expect(screen.queryByText('Showing now')).toBeNull();
    await userEvent.type(screen.getByLabelText('Banner text'), 'Payments are slow this morning.');
    await userEvent.click(screen.getByRole('button', { name: 'Show banner' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/settings/banner', expect.objectContaining({ method: 'PUT' }));
    expect(body()).toEqual({ text: 'Payments are slow this morning.' });
    expect(screen.getByRole('status')).toHaveTextContent('Banner is showing on every dashboard.');
  });

  it('reads Update banner, Take it down and Showing now when live; taking down sends null', async () => {
    render(<ControlsScreen settings={settings({ banner: 'Orders still come through.' })} />);

    expect(screen.getByLabelText('Banner text')).toHaveValue('Orders still come through.');
    expect(screen.getByText('Showing now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update banner' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Take it down' }));

    expect(body()).toEqual({ text: null });
  });

  it('disables Update banner while the text equals the stored banner, enables it once edited', async () => {
    render(<ControlsScreen settings={settings({ banner: 'Orders still come through.' })} />);

    expect(screen.getByRole('button', { name: 'Update banner' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Banner text'), '!');
    expect(screen.getByRole('button', { name: 'Update banner' })).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Banner text'), '{Backspace}  ');
    expect(screen.getByRole('button', { name: 'Update banner' })).toBeDisabled();
  });

  it('re-seeds the box when the stored banner changes after a refresh', () => {
    const { rerender } = render(<ControlsScreen settings={settings({ banner: 'Orders still come through.' })} />);

    rerender(<ControlsScreen settings={settings({ banner: 'Payments are back.' })} />);
    expect(screen.getByLabelText('Banner text')).toHaveValue('Payments are back.');

    rerender(<ControlsScreen settings={settings({ banner: null })} />);
    expect(screen.getByLabelText('Banner text')).toHaveValue('');
  });

  it('stops at 160 characters', async () => {
    render(<ControlsScreen settings={settings()} />);

    const box = screen.getByLabelText('Banner text');
    await userEvent.click(box);
    await userEvent.paste('x'.repeat(170));

    expect((box as HTMLTextAreaElement).value).toHaveLength(160);
  });
});

describe('limits and prices', () => {
  it('holds the saved values, with prices in whole RM, and Save is disabled until a value changes', async () => {
    render(<ControlsScreen settings={settings()} />);

    expect(screen.getByLabelText('Conversations a month, per page')).toHaveValue('200');
    expect(screen.getByLabelText('Free leads on a trial')).toHaveValue('3');
    expect(screen.getByLabelText('Free orders on a trial')).toHaveValue('3');
    expect(screen.getByLabelText('Business, monthly')).toHaveValue('49');
    expect(screen.getByLabelText('Business, yearly')).toHaveValue('490');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.queryByText('Not saved yet')).toBeNull();
    expect(screen.getByText('Price changes apply to the next payment. Anyone already paid keeps what they paid for.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Business, monthly'), '9');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Business, monthly')).toHaveValue('49');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('lists each changed value as old → new in the confirm, then PUTs only that value with the reason', async () => {
    render(<ControlsScreen settings={settings()} />);

    const monthly = screen.getByLabelText('Business, monthly');
    await userEvent.clear(monthly);
    await userEvent.type(monthly, '79');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = screen.getByRole('dialog', { name: 'Save new limits and prices?' });
    expect(within(dialog).getByText('This changes every page on Curios. Prices apply from each owner’s next payment.')).toBeInTheDocument();
    expect(within(dialog).getByText('RM49 → RM79')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);

    await userEvent.type(within(dialog).getByLabelText('Reason, for the audit log'), 'Costs went up');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save for everyone' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/settings/limits', expect.objectContaining({ method: 'PUT' }));
    expect(body()).toEqual({ monthlyRm: 79, reason: 'Costs went up' });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Saved for every page.');
  });

  it('asks a second time on 409 BIG_CHANGE, and resends with confirmBig', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'BIG_CHANGE', 'That is a big price change. Confirm it to go ahead.', ['monthly']));
    render(<ControlsScreen settings={settings()} />);

    const monthly = screen.getByLabelText('Business, monthly');
    await userEvent.clear(monthly);
    await userEvent.type(monthly, '149');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.type(screen.getByLabelText('Reason, for the audit log'), 'Repricing');
    await userEvent.click(screen.getByRole('button', { name: 'Save for everyone' }));

    const second = screen.getByRole('dialog', { name: "That's a big change. Save it anyway?" });
    expect(within(second).getByText('RM49 → RM149')).toBeInTheDocument();
    expect(body(0)).not.toHaveProperty('confirmBig');

    await userEvent.click(within(second).getByRole('button', { name: 'Save anyway' }));

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(body(1)).toEqual({ monthlyRm: 149, reason: 'Repricing', confirmBig: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Saved for every page.');
  });

  it('strips non-digits typed into a limit field', async () => {
    render(<ControlsScreen settings={settings()} />);

    const cap = screen.getByLabelText('Conversations a month, per page');
    await userEvent.clear(cap);
    await userEvent.type(cap, '1a2.5-e3 ');

    expect(cap).toHaveValue('1253');
  });

  it('cancelling the big-change dialog sends nothing more and keeps the typed values', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'BIG_CHANGE', 'That is a big price change. Confirm it to go ahead.', ['monthly']));
    render(<ControlsScreen settings={settings()} />);

    const monthly = screen.getByLabelText('Business, monthly');
    await userEvent.clear(monthly);
    await userEvent.type(monthly, '149');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.type(screen.getByLabelText('Reason, for the audit log'), 'Repricing');
    await userEvent.click(screen.getByRole('button', { name: 'Save for everyone' }));

    const second = screen.getByRole('dialog', { name: "That's a big change. Save it anyway?" });
    await userEvent.click(within(second).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Business, monthly')).toHaveValue('149');
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not save a value that is empty', async () => {
    render(<ControlsScreen settings={settings()} />);

    await userEvent.clear(screen.getByLabelText('Free leads on a trial'));

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('does not save free leads or free orders of 0', async () => {
    render(<ControlsScreen settings={settings()} />);

    const leads = screen.getByLabelText('Free leads on a trial');
    await userEvent.clear(leads);
    await userEvent.type(leads, '0');
    expect(leads).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await userEvent.clear(leads);
    await userEvent.type(leads, '3');
    const orders = screen.getByLabelText('Free orders on a trial');
    await userEvent.clear(orders);
    await userEvent.type(orders, '0');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('sends two changed values and nothing else', async () => {
    render(<ControlsScreen settings={settings()} />);

    const cap = screen.getByLabelText('Conversations a month, per page');
    await userEvent.clear(cap);
    await userEvent.type(cap, '80');
    const orders = screen.getByLabelText('Free orders on a trial');
    await userEvent.clear(orders);
    await userEvent.type(orders, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.type(screen.getByLabelText('Reason, for the audit log'), 'Review');
    await userEvent.click(screen.getByRole('button', { name: 'Save for everyone' }));

    expect(body()).toEqual({ cap: 80, freeOrders: 5, reason: 'Review' });
  });
});

describe('a reading queue that cannot be reached', () => {
  it('says so in words, whatever sentence the API sent', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(502, 'QUEUE_UNAVAILABLE', 'Something failed on our side. Try again.'));
    render(<ControlsScreen settings={settings()} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Reading new sources' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason, for the audit log'), 'Queue backed up');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn it off' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't reach the reading queue. Nothing was changed. Try again.");
  });
});

describe('limits that are already saved', () => {
  it('refreshes the screen on 409 NO_CHANGE, and keeps the API’s message', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'NO_CHANGE', 'Nothing is different from what is saved.'));
    render(<ControlsScreen settings={settings()} />);

    await userEvent.type(screen.getByLabelText('Business, monthly'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.type(screen.getByLabelText('Reason, for the audit log'), 'Same again');
    await userEvent.click(screen.getByRole('button', { name: 'Save for everyone' }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing is different from what is saved.');
  });
});

describe('ControlsUnavailable', () => {
  it('says the settings could not be loaded, with no switches, limits, banner or Save', () => {
    render(<ControlsUnavailable />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the current settings. Reload to try again.");
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });
});
