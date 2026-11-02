import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readBasket } from '../../shop/basket.js';
import { shopCopy } from '../../shop/copy.js';
import { PayFailed } from './pay-failed.js';

const copy = shopCopy('en');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const lines = [
  { itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17000, quantity: 1 },
  { itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 2 },
];
const props: Parameters<typeof PayFailed>[0] = {
  token: 'tok_abc',
  handle: 'keklina',
  displayName: 'Kek Lina',
  copy,
  code: '7Q4M',
  lines,
  totalCents: 26000,
  reason: 'cancelled',
  method: 'FPX · Maybank2u',
  chipMethods: ['fpx'],
};

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('PayFailed', () => {
  it('says nothing was taken and the order is held 30 minutes, with the code, lines and total', () => {
    render(<PayFailed {...props} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Payment didn’t go through' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing was taken\. Kek Lina has saved your order for/)).toHaveTextContent('Nothing was taken. Kek Lina has saved your order for 30 minutes.');
    expect(screen.getByText('30 minutes').tagName).toBe('B');
    const code = screen.getByRole('img', { name: 'Order code 7Q4M' });
    expect([...code.querySelectorAll('span')].map((tile) => tile.getAttribute('data-tone'))).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect(screen.getByText('1× Kek coklat moist · 2kg')).toBeInTheDocument();
    expect(screen.getByText('RM170')).toBeInTheDocument();
    expect(screen.getByText('2× Kek batik')).toBeInTheDocument();
    expect(screen.getByText('RM90')).toBeInTheDocument();
    expect(screen.getByText(copy.total).nextSibling).toHaveTextContent('RM260');
    expect(screen.getByRole('button', { name: 'Pay RM260 again' })).toBeInTheDocument();
    expect(screen.getByText('Tried with FPX · Maybank2u. The bank said: cancelled.')).toBeInTheDocument();
  });

  it('names the bank’s word for each reason, and with no method says only that', () => {
    const { rerender } = render(<PayFailed {...props} method={null} />);
    expect(screen.getByText('The bank said: cancelled.')).toBeInTheDocument();
    rerender(<PayFailed {...props} method="card" reason="expired" />);
    expect(screen.getByText('Tried with card. The bank said: it took too long.')).toBeInTheDocument();
  });

  it('pay again opens the online choices for this order', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { fpx: true, wallets: [], card: false })));
    render(<PayFailed {...props} />);

    await user.click(screen.getByRole('button', { name: 'Pay RM260 again' }));
    expect(await screen.findByRole('region', { name: copy.tryPayAgain })).toBeInTheDocument();
  });

  it('with no online way to pay, offers only another way', () => {
    render(<PayFailed {...props} chipMethods={null} />);
    expect(screen.queryByRole('button', { name: /again/ })).toBeNull();
    expect(screen.getByRole('button', { name: copy.payAnotherWay })).toBeInTheDocument();
  });

  describe('pay another way', () => {
    const answer = {
      lines: [
        { itemId: 'it_1', optionId: 'op_1', quantity: 1, sessionId: null },
        { itemId: 'it_2', optionId: null, quantity: 2, sessionId: 'se_9' },
      ],
    };

    it('cancels the order, fills the basket with its lines and goes to checkout', async () => {
      const user = userEvent.setup();
      const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(200, answer));
      vi.stubGlobal('fetch', fetch);
      const navigate = vi.fn();
      render(<PayFailed {...props} navigate={navigate} />);

      await user.click(screen.getByRole('button', { name: copy.payAnotherWay }));

      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/keklina/shop/checkout'));
      expect(String(fetch.mock.calls[0]![0])).toMatch(/\/store\/orders\/tok_abc\/pay-another-way$/);
      expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
      expect(readBasket('curios-basket:keklina')).toEqual(answer.lines);
    });

    it('still goes to checkout when the API left a line out', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn(async () => json(200, { lines: [answer.lines[0]] })));
      const navigate = vi.fn();
      render(<PayFailed {...props} navigate={navigate} />);

      await user.click(screen.getByRole('button', { name: copy.payAnotherWay }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/keklina/shop/checkout'));
      expect(readBasket('curios-basket:keklina')).toEqual([answer.lines[0]]);
    });

    it.each(['ORDER_ALREADY_PAID', 'ORDER_RECEIPT_SENT'])('%s reloads the order page, and leaves the basket alone', async (code) => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: { code, message: 'no' } })));
      const navigate = vi.fn();
      render(<PayFailed {...props} navigate={navigate} />);

      await user.click(screen.getByRole('button', { name: copy.payAnotherWay }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/keklina/order/tok_abc'));
      expect(readBasket('curios-basket:keklina')).toEqual([]);
    });

    it('says so, and stays, when CHIP cannot confirm the old payment closed', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: { code: 'ORDER_PAYMENT_OPEN', message: 'open' } })));
      const navigate = vi.fn();
      render(<PayFailed {...props} navigate={navigate} />);

      await user.click(screen.getByRole('button', { name: copy.payAnotherWay }));
      expect(await screen.findByText(copy.payStillOpen)).toBeInTheDocument();
      expect(navigate).not.toHaveBeenCalled();
      expect(within(document.body).getByRole('button', { name: copy.payAnotherWay })).toBeEnabled();
    });

    it('says to wait when the order’s budget is spent', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn(async () => json(429, { error: { code: 'RATE_LIMITED', message: 'slow' } })));
      render(<PayFailed {...props} navigate={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: copy.payAnotherWay }));
      expect(await screen.findByText(copy.payTooMany)).toBeInTheDocument();
    });
  });

  it('speaks Malay, and holds unpaid orders 30 minutes in both languages', () => {
    const ms = shopCopy('ms');
    render(<PayFailed {...props} copy={ms} />);
    expect(screen.getByRole('heading', { name: 'Bayaran tidak berjaya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bayar RM260 sekali lagi' })).toBeInTheDocument();
    expect(screen.getByText('Bayar cara lain')).toBeInTheDocument();
    expect(screen.getByText('Dicuba dengan FPX · Maybank2u. Bank berkata: cancelled.')).toBeInTheDocument();
    expect(ms.holdNote).toBe('Tempahan yang belum dibayar dilepaskan selepas 30 minit.');
    expect(copy.holdNote).toBe('Unpaid orders are released after 30 minutes.');
  });
});
