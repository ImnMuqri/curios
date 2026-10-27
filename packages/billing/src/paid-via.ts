/**
 * How a purchase was paid, in the words the admin's Payments shows: "FPX", "Card · Visa",
 * "TNG eWallet". Read from CHIP's `transaction_data.payment_method` alone, because that is
 * all chip-collect.v1.yaml gives: for a card, `extra.card_brand` is documented as the same
 * as the method, so the method already names the scheme; and for FPX the spec documents no
 * field naming the payer's bank, so the board's "FPX · Maybank2u" stays "FPX" until it does.
 */
const NAMES: Record<string, string> = {
  visa: 'Card · Visa',
  mastercard: 'Card · Mastercard',
  maestro: 'Card · Maestro',
  fpx: 'FPX',
  fpx_b2b1: 'FPX B2B1',
  duitnow_qr: 'DuitNow QR',
  dnqr: 'DuitNow QR',
  razer_tng: 'TNG eWallet',
  razer_grabpay: 'GrabPay',
  razer_shopeepay: 'ShopeePay',
  shopee_pay: 'ShopeePay',
  razer_atome: 'Atome',
  razer_maybankqr: 'MaybankQR',
  mpgs_apple_pay: 'Apple Pay',
  mpgs_google_pay: 'Google Pay',
};

/**
 * Null when CHIP names no method (it sends '' until one was used) or says `unknown`: the
 * screen shows "—" for those, as it does for payments made before this was recorded. A
 * method CHIP adds later is shown in words (`crypto_coin` is "Crypto Coin") rather than not at all.
 */
export function paidVia(method: string | null): string | null {
  if (!method || method === 'unknown') return null;
  return (
    NAMES[method] ??
    method
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}
