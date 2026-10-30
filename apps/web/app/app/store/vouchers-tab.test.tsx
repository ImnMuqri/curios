import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { OwnerVoucher } from '@curios/core/vouchers';
import { ApiError } from '../../../lib/api.js';
import { VouchersTab } from './vouchers-tab.js';
import type { VouchersApi } from './store-types.js';

const voucher = (over: Partial<OwnerVoucher>): OwnerVoucher => ({
  id: 'v1', mode: 'AUTO', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, label: 'Raya sale',
  code: null, name: 'Raya sale', endsAt: null, maxUses: null, active: true, uses: 0, state: 'on', itemName: null, ...over,
});

const list: OwnerVoucher[] = [
  voucher({ id: 'v1' }),
  voucher({ id: 'v2', mode: 'CODE', kind: 'AMOUNT', percent: null, amountCents: 500, itemId: 'a', itemName: 'Kek Batik', code: 'INSTA15', name: null, label: 'INSTA15', maxUses: 50, uses: 12 }),
  voucher({ id: 'v3', mode: 'CODE', code: 'OLD10', name: null, label: 'OLD10', endsAt: '2026-11-30T16:00:00.000Z', state: 'ended' }),
  voucher({ id: 'v4', mode: 'CODE', code: 'PAUSED', name: null, label: 'PAUSED', active: false, state: 'off' }),
];
const items = [{ id: 'a', name: 'Kek Batik' }, { id: 'b', name: 'Burnt cheesecake' }];

function api(over: Partial<VouchersApi> = {}): VouchersApi {
  return {
    add: vi.fn(async (input) => voucher({ id: 'new', mode: input.mode, code: input.code, label: input.code ?? input.name ?? '' })),
    update: vi.fn(async (id, patch) => voucher({ id, ...(patch.active === undefined ? {} : { active: patch.active }) })),
    remove: vi.fn(async () => undefined),
    ...over,
  };
}

/** Holds the list as the editor does, so a change shows. */
function Harness({ start, calls }: { start: OwnerVoucher[]; calls: VouchersApi }) {
  const [vouchers, setVouchers] = useState(start);
  return <VouchersTab vouchers={vouchers} items={items} api={calls} onChange={setVouchers} />;
}
const show = (start = list, calls = api()) => {
  render(<Harness start={start} calls={calls} />);
  return calls;
};
const row = (name: RegExp | string) => screen.getByRole('listitem', { name });

beforeEach(() => vi.restoreAllMocks());

describe('VouchersTab', () => {
  it('lists each voucher with its saving, how customers get it, its state and its uses', () => {
    show();
    const auto = row(/Raya sale/);
    expect(within(auto).getByText('10% off everything')).toBeInTheDocument();
    expect(within(auto).getByText('Automatic')).toBeInTheDocument();
    const code = row(/INSTA15/);
    expect(within(code).getByText('RM5 off Kek Batik')).toBeInTheDocument();
    expect(within(code).getByText('Code INSTA15')).toBeInTheDocument();
    expect(within(code).getByText('12 of 50 used')).toBeInTheDocument();
    expect(within(row(/OLD10/)).getByText('Ended 30 Nov')).toBeInTheDocument();
    expect(within(row(/PAUSED/)).getByText('Off')).toBeInTheDocument();
  });

  it('says there are none yet, and what a voucher is for', () => {
    show([]);
    expect(screen.getByRole('heading', { name: 'No vouchers yet' })).toBeInTheDocument();
  });

  it('adds a Code voucher with its code normalised, money in sen', async () => {
    const calls = show([]);
    await userEvent.click(screen.getByRole('button', { name: /Add voucher|Add your first voucher/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Code/ }));
    await userEvent.type(screen.getByLabelText('Code'), ' insta15 ');
    await userEvent.click(screen.getByRole('button', { name: /^Amount off/ }));
    await userEvent.type(screen.getByLabelText('Amount off in ringgit'), '5');
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'a');
    await userEvent.type(screen.getByLabelText('Minimum spend in ringgit'), '30.50');
    await userEvent.type(screen.getByLabelText('Uses'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Add voucher' }));
    expect(calls.add).toHaveBeenCalledWith({ mode: 'CODE', code: 'INSTA15', name: null, kind: 'AMOUNT', percent: null, amountCents: 500, itemId: 'a', minSpendCents: 3050, endsOn: null, maxUses: 50 });
    expect(await screen.findByRole('listitem', { name: /INSTA15/ })).toBeInTheDocument();
  });

  it('adds an Automatic voucher with a name and a percent', async () => {
    const calls = show([]);
    await userEvent.click(screen.getByRole('button', { name: /Add your first voucher/ }));
    await userEvent.type(screen.getByLabelText('Name customers see'), 'Raya sale');
    await userEvent.type(screen.getByLabelText('Percent off'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add voucher' }));
    expect(calls.add).toHaveBeenCalledWith({ mode: 'AUTO', code: null, name: 'Raya sale', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, endsOn: null, maxUses: null });
  });

  it('refuses 0 percent with the rule’s own message, before calling the API', async () => {
    const calls = show([]);
    await userEvent.click(screen.getByRole('button', { name: /Add your first voucher/ }));
    await userEvent.type(screen.getByLabelText('Name customers see'), 'Raya sale');
    await userEvent.type(screen.getByLabelText('Percent off'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Add voucher' }));
    expect(screen.getByRole('alert')).toHaveTextContent('A percent voucher takes 1 to 100 percent off.');
    expect(calls.add).not.toHaveBeenCalled();
  });

  it('says a taken code on the code field', async () => {
    const calls = show([], api({ add: vi.fn(async () => { throw new ApiError(409, 'VOUCHER_CODE_TAKEN', 'taken'); }) }));
    await userEvent.click(screen.getByRole('button', { name: /Add your first voucher/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Code/ }));
    await userEvent.type(screen.getByLabelText('Code'), 'insta15');
    await userEvent.type(screen.getByLabelText('Percent off'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add voucher' }));
    expect(await screen.findByText('You already have a code like that.')).toBeInTheDocument();
    expect(calls.add).toHaveBeenCalledTimes(1);
  });

  it('switches a voucher off with update(id, { active: false })', async () => {
    const calls = show();
    await userEvent.click(within(row(/Raya sale/)).getByRole('switch'));
    expect(calls.update).toHaveBeenCalledWith('v1', { active: false });
  });

  it('asks inside the page before deleting, then removes', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const calls = show();
    await userEvent.click(within(row(/INSTA15/)).getByRole('button', { name: /^Delete/ }));
    expect(calls.remove).not.toHaveBeenCalled();
    const ask = screen.getByRole('group', { name: 'Confirm delete' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Yes, delete' }));
    expect(calls.remove).toHaveBeenCalledWith('v2');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('listitem', { name: /INSTA15/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('keeps a voucher when the owner says Keep', async () => {
    const calls = show();
    await userEvent.click(within(row(/INSTA15/)).getByRole('button', { name: /^Delete/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(calls.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('listitem', { name: /INSTA15/ })).toBeInTheDocument();
  });

  it('removes once on a double click of Yes, delete, and shows no error', async () => {
    let finish = () => {};
    const calls = show(list, api({ remove: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) }));
    await userEvent.click(within(row(/INSTA15/)).getByRole('button', { name: /^Delete/ }));
    await userEvent.dblClick(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(calls.remove).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /INSTA15/ })).not.toBeInTheDocument());
    expect(screen.queryByText(/did not save/)).not.toBeInTheDocument();
  });

  it('updates once on a double click of the switch', async () => {
    let finish = () => {};
    const calls = show(list, api({ update: vi.fn((id) => new Promise<OwnerVoucher>((resolve) => { finish = () => resolve(voucher({ id, active: false, state: 'off' })); })) }));
    await userEvent.dblClick(within(row(/Raya sale/)).getByRole('switch'));
    expect(calls.update).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(within(row(/Raya sale/)).getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  });

  it('says a failed switch and leaves the list as it was', async () => {
    show(list, api({ update: vi.fn(async () => { throw new Error('Nope.'); }) }));
    await userEvent.click(within(row(/Raya sale/)).getByRole('switch'));
    expect(await screen.findByText('Nope.')).toBeInTheDocument();
    expect(within(row(/Raya sale/)).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('says a failed delete and leaves the list as it was', async () => {
    show(list, api({ remove: vi.fn(async () => { throw new Error('Could not delete.'); }) }));
    await userEvent.click(within(row(/INSTA15/)).getByRole('button', { name: /^Delete/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('Could not delete.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});
