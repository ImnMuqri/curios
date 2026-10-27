import { describe, expect, it } from 'vitest';
import { paidVia } from './paid-via.js';

describe('paidVia', () => {
  it('names a card by its scheme, which CHIP gives as the method itself', () => {
    expect(paidVia('visa')).toBe('Card · Visa');
    expect(paidVia('mastercard')).toBe('Card · Mastercard');
    expect(paidVia('maestro')).toBe('Card · Maestro');
  });

  it('names the wallets and bank transfers the way the board does', () => {
    expect(paidVia('fpx')).toBe('FPX');
    expect(paidVia('fpx_b2b1')).toBe('FPX B2B1');
    expect(paidVia('razer_tng')).toBe('TNG eWallet');
    expect(paidVia('duitnow_qr')).toBe('DuitNow QR');
    expect(paidVia('razer_grabpay')).toBe('GrabPay');
    expect(paidVia('shopee_pay')).toBe('ShopeePay');
    expect(paidVia('razer_shopeepay')).toBe('ShopeePay');
    expect(paidVia('mpgs_apple_pay')).toBe('Apple Pay');
  });

  it('shows a method it does not know in words: underscores to spaces, each word capitalised', () => {
    expect(paidVia('crypto_coin')).toBe('Crypto Coin');
    expect(paidVia('buy_now_pay_later')).toBe('Buy Now Pay Later');
    expect(paidVia('newpay')).toBe('Newpay');
  });

  it('is nothing when CHIP says no method, or that it could not tell', () => {
    expect(paidVia(null)).toBeNull();
    expect(paidVia('')).toBeNull();
    expect(paidVia('unknown')).toBeNull();
  });
});
