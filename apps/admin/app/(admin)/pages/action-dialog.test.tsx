import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh }) }));

const apiFetch = vi.fn();
vi.mock('../../../lib/api.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { ActionDialog, type ActionKind } from './action-dialog.js';

const page = { id: 'p1', handle: 'keklina', displayName: 'Kek Lina' };

function open(kind: ActionKind) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<ActionDialog kind={kind} page={page} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}

const reasonBox = () => screen.getByLabelText('Reason, for the audit log');

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  apiFetch.mockReset().mockResolvedValue(null);
});

describe('ActionDialog', () => {
  it('suspend: will not confirm without a reason, then posts { reason }', async () => {
    const { onDone } = open('suspend');
    const confirm = screen.getByRole('button', { name: 'Suspend page' });

    expect(screen.getByRole('dialog', { name: 'Suspend curios.my/keklina?' })).toBeInTheDocument();
    expect(screen.getByText('The owner sees this.')).toBeInTheDocument();
    expect(reasonBox()).toHaveAttribute('placeholder', 'E.g. Scam reports, asking for transfers first');
    expect(confirm).toBeDisabled();

    await userEvent.type(reasonBox(), '   ');
    expect(confirm).toBeDisabled();

    await userEvent.type(reasonBox(), ' Scam reports ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(apiFetch).toHaveBeenCalledWith('/admin/pages/p1/suspend', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Scam reports' }),
    });
    expect(refresh).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('curios.my/keklina is suspended.');
  });

  it('unsuspend also tells the owner sees the reason', async () => {
    const { onDone } = open('unsuspend');

    expect(screen.getByText('The owner sees this.')).toBeInTheDocument();
    await userEvent.type(reasonBox(), 'Fixed');
    await userEvent.click(screen.getByRole('button', { name: 'Bring it back' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/pages/p1/unsuspend', expect.anything());
    expect(onDone).toHaveBeenCalledWith('curios.my/keklina is live again.');
  });

  it('delete: needs the handle typed exactly, then sends reason and handle', async () => {
    const { onDone } = open('del');
    const confirm = screen.getByRole('button', { name: 'Delete account' });

    expect(screen.queryByText('The owner sees this.')).not.toBeInTheDocument();
    await userEvent.type(reasonBox(), 'Owner asked');
    expect(confirm).toBeDisabled();

    const typed = screen.getByLabelText('Type keklina to confirm');
    await userEvent.type(typed, 'keklin');
    expect(confirm).toBeDisabled();
    await userEvent.type(typed, 'A');
    expect(confirm).toBeDisabled();
    await userEvent.clear(typed);
    await userEvent.type(typed, 'keklina');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(apiFetch).toHaveBeenCalledWith('/admin/pages/p1', {
      method: 'DELETE',
      body: JSON.stringify({ reason: 'Owner asked', handle: 'keklina' }),
    });
    expect(onDone).toHaveBeenCalledWith('Account deleted.');
  });

  it('grant and reset post to their own routes with the board toasts', async () => {
    const a = open('comp');
    await userEvent.type(reasonBox(), 'Outage');
    await userEvent.click(screen.getByRole('button', { name: 'Give one month' }));
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/pages/p1/grant-month', expect.anything());
    expect(a.onDone).toHaveBeenCalledWith('One month added.');
  });

  it('reset: says the cap in force, not the default', () => {
    render(<ActionDialog kind="reset" page={{ ...page, cap: 10 }} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('This month’s count goes back to 0, so the chat answers again until it reaches 10.')).toBeInTheDocument();
  });

  it('reset: posts to reset-conversations', async () => {
    const { onDone } = open('reset');
    await userEvent.type(reasonBox(), 'Bot');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to 0' }));
    expect(apiFetch).toHaveBeenLastCalledWith('/admin/pages/p1/reset-conversations', expect.anything());
    expect(onDone).toHaveBeenCalledWith('Conversations reset to 0.');
  });

  it('owner view: posts view-as-owner, then opens the read-only route', async () => {
    open('owner');

    expect(reasonBox()).toHaveAttribute('placeholder', 'E.g. Owner says the shop shows no items');
    await userEvent.type(reasonBox(), 'Support');
    await userEvent.click(screen.getByRole('button', { name: 'See it as the owner' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/pages/p1/view-as-owner', expect.anything());
    expect(push).toHaveBeenCalledWith('/pages/p1/as-owner');
  });

  it('keeps the dialog open and shows the API message when the call fails', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'PAGE_STATE', 'That page is already suspended.'));
    const { onDone, onClose } = open('suspend');

    await userEvent.type(reasonBox(), 'Scam');
    await userEvent.click(screen.getByRole('button', { name: 'Suspend page' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That page is already suspended.');
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
