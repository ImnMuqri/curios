import { describe, expect, it } from 'vitest';
import { FPX_BANKS, chipWhitelist, choiceLabel, onlineOffer, paidMethodLabel, payUrl, WALLETS } from './shop-pay.js';

const ALL = ['fpx', 'fpx_b2b1', 'visa', 'mastercard', 'maestro', 'razer_tng', 'razer_grabpay', 'shopee_pay', 'duitnow_qr'];

describe('onlineOffer', () => {
  it('offers FPX, the e-wallets and card when the account has them', () => {
    expect(onlineOffer(ALL)).toEqual({ fpx: true, wallets: ['tng', 'grab', 'spay'], card: true });
  });

  it('offers nothing it is not given, and never Boost', () => {
    expect(onlineOffer(['duitnow_qr', 'boost'])).toEqual({ fpx: false, wallets: [], card: false });
    expect(WALLETS.map((wallet) => wallet.name)).not.toContain('Boost');
  });

  it("takes Razer's ShopeePay when that is the one offered, and Mastercard alone as card", () => {
    expect(onlineOffer(['razer_shopeepay', 'mastercard'])).toEqual({ fpx: false, wallets: ['spay'], card: true });
  });
});

describe('chipWhitelist', () => {
  it("is the online methods the shop offers, never CHIP's DuitNow QR", () => {
    expect(chipWhitelist(ALL)).toEqual(['fpx', 'razer_tng', 'razer_grabpay', 'shopee_pay', 'visa', 'mastercard', 'maestro']);
    expect(chipWhitelist(['duitnow_qr'])).toEqual([]);
  });
});

describe('payUrl', () => {
  const checkout = 'https://gate.chip-in.asia/p/abc/';

  it('the pay URL carries preferred=fpx&fpx_bank_code=MB2U0227 for Maybank2u', () => {
    expect(payUrl(checkout, { method: 'fpx', bank: 'maybank' }, ALL)).toBe(`${checkout}?preferred=fpx&fpx_bank_code=MB2U0227`);
  });

  it('carries every bank code from the table', () => {
    const codes = Object.fromEntries(FPX_BANKS.map((bank) => [bank.id, new URL(payUrl(checkout, { method: 'fpx', bank: bank.id }, ALL)!).searchParams.get('fpx_bank_code')]));
    expect(codes).toEqual({ maybank: 'MB2U0227', cimb: 'BCBB0235', pbb: 'PBB0233', rhb: 'RHB0218', bislam: 'BIMB0340', hlb: 'HLB0224' });
  });

  it('sends e-wallets straight to the wallet and card to CHIP’s card page', () => {
    expect(payUrl(checkout, { method: 'tng' }, ALL)).toBe(`${checkout}?preferred=razer_tng&razer_bank_code=TNG-EWALLET`);
    expect(payUrl(checkout, { method: 'grab' }, ALL)).toBe(`${checkout}?preferred=razer_grabpay&razer_bank_code=GrabPay`);
    expect(payUrl(checkout, { method: 'spay' }, ALL)).toBe(`${checkout}?preferred=shopee_pay`);
    expect(payUrl(checkout, { method: 'spay' }, ['razer_shopeepay'])).toBe(`${checkout}?preferred=razer_shopeepay`);
    expect(payUrl(checkout, { method: 'card' }, ALL)).toBe(`${checkout}?preferred=visa`);
    expect(payUrl(checkout, { method: 'card' }, ['mastercard'])).toBe(`${checkout}?preferred=mastercard`);
  });

  it('keeps a query the checkout URL already has', () => {
    expect(payUrl('https://gate.chip-in.asia/p/abc/?lang=ms', { method: 'card' }, ALL)).toBe('https://gate.chip-in.asia/p/abc/?lang=ms&preferred=visa');
  });

  it('is null for a method the account does not offer, or FPX with no bank', () => {
    expect(payUrl(checkout, { method: 'tng' }, ['fpx'])).toBeNull();
    expect(payUrl(checkout, { method: 'fpx' }, ALL)).toBeNull();
    expect(payUrl(checkout, { method: 'fpx', bank: 'nope' }, ALL)).toBeNull();
  });
});

describe('labels', () => {
  it('names the choice the customer made', () => {
    expect(choiceLabel({ method: 'fpx', bank: 'cimb' })).toBe('FPX · CIMB Clicks');
    expect(choiceLabel({ method: 'tng' })).toBe('Touch ’n Go eWallet');
    expect(choiceLabel({ method: 'card' })).toBe('Card');
  });

  it("says how CHIP says it was paid, with the bank chosen when CHIP names none", () => {
    expect(paidMethodLabel({ paymentMethod: 'fpx', maskedPan: null, notes: 'FPX · Maybank2u' })).toBe('FPX · Maybank2u');
    expect(paidMethodLabel({ paymentMethod: 'fpx', maskedPan: null })).toBe('FPX');
    expect(paidMethodLabel({ paymentMethod: 'razer_tng', maskedPan: null, notes: 'FPX · Maybank2u' })).toBe('Touch ’n Go eWallet');
    expect(paidMethodLabel({ paymentMethod: 'razer_grabpay', maskedPan: null })).toBe('GrabPay');
    expect(paidMethodLabel({ paymentMethod: 'razer_shopeepay', maskedPan: null })).toBe('ShopeePay');
    expect(paidMethodLabel({ paymentMethod: 'visa', maskedPan: '411111******4242' })).toBe('Visa card ending 4242');
    expect(paidMethodLabel({ paymentMethod: 'mastercard', maskedPan: null })).toBe('Mastercard card');
    expect(paidMethodLabel({ paymentMethod: 'something_new', maskedPan: null })).toBe('CHIP');
    expect(paidMethodLabel({ paymentMethod: null, maskedPan: null })).toBe('CHIP');
  });
});
