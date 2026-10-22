/**
 * Paying a shop online, through the owner's own CHIP account: the choices
 * checkout draws (Public board, "How you'll pay"), what each is called at CHIP,
 * and the words for how an order was paid. Shared by the API, which creates the
 * purchase, and checkout, which draws the choices; nothing here touches a key.
 *
 * The codes are CHIP's "Direct Post & Skip Payment Page" ones. There is exactly
 * one QR option, the owner's own; CHIP's `duitnow_qr` is never offered.
 */

/** The banks checkout lists under "Your bank", in the board's order. */
export const FPX_BANKS = [
  { id: 'maybank', name: 'Maybank2u', code: 'MB2U0227' },
  { id: 'cimb', name: 'CIMB Clicks', code: 'BCBB0235' },
  { id: 'pbb', name: 'Public Bank', code: 'PBB0233' },
  { id: 'rhb', name: 'RHB Now', code: 'RHB0218' },
  { id: 'bislam', name: 'Bank Islam', code: 'BIMB0340' },
  { id: 'hlb', name: 'Hong Leong', code: 'HLB0224' },
] as const;

export type FpxBankId = (typeof FPX_BANKS)[number]['id'];

/**
 * The e-wallets under "Your e-wallet", in the board's order, without Boost
 * (owner's answer 3: CHIP has no online Boost). `chip` lists the method names
 * CHIP may offer each under, first preferred.
 */
export const WALLETS = [
  { id: 'tng', name: 'Touch ’n Go', paid: 'Touch ’n Go eWallet', chip: ['razer_tng'], bankCode: 'TNG-EWALLET' },
  { id: 'grab', name: 'GrabPay', paid: 'GrabPay', chip: ['razer_grabpay'], bankCode: 'GrabPay' },
  { id: 'spay', name: 'ShopeePay', paid: 'ShopeePay', chip: ['shopee_pay', 'razer_shopeepay'], bankCode: null },
] as const;

export type WalletId = (typeof WALLETS)[number]['id'];

/** Card goes to CHIP's own card page; never a card form of ours. */
const CARDS = ['visa', 'mastercard', 'maestro'] as const;
const CARD_NAMES: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', maestro: 'Maestro' };

/** What the customer picked: FPX with a bank, one e-wallet, or card. */
export type OnlineMethod = 'fpx' | WalletId | 'card';
export const ONLINE_METHODS: readonly OnlineMethod[] = ['fpx', 'tng', 'grab', 'spay', 'card'];

export interface OnlineChoice {
  method: OnlineMethod;
  /** The bank, for FPX. */
  bank?: string;
}

/** Which of the board's online choices a CHIP account can take. */
export interface OnlineOffer {
  fpx: boolean;
  wallets: WalletId[];
  card: boolean;
}

/** The board's choices that CHIP's `GET /payment_methods/` listed. */
export function onlineOffer(chipMethods: readonly string[]): OnlineOffer {
  const has = new Set(chipMethods);
  return {
    fpx: has.has('fpx'),
    wallets: WALLETS.filter((wallet) => wallet.chip.some((name) => has.has(name))).map((wallet) => wallet.id),
    card: has.has('visa') || has.has('mastercard'),
  };
}

/**
 * The purchase's `payment_method_whitelist`: the online methods the account
 * offers that checkout draws, so a customer who lands on CHIP's own page can
 * never pick CHIP's DuitNow QR (or a method checkout has no words for).
 */
export function chipWhitelist(chipMethods: readonly string[]): string[] {
  const has = new Set(chipMethods);
  const wanted = ['fpx', ...WALLETS.flatMap((wallet) => wallet.chip), ...CARDS];
  return wanted.filter((name) => has.has(name));
}

/**
 * The purchase's checkout URL with the `preferred` params that send the
 * customer straight to their bank, their e-wallet or CHIP's card page. Null for
 * a choice the account does not offer, or FPX without a known bank.
 */
export function payUrl(checkoutUrl: string, choice: OnlineChoice, chipMethods: readonly string[]): string | null {
  const has = new Set(chipMethods);
  const params = new URLSearchParams();
  if (choice.method === 'fpx') {
    const bank = FPX_BANKS.find((candidate) => candidate.id === choice.bank);
    if (!bank || !has.has('fpx')) return null;
    params.set('preferred', 'fpx');
    params.set('fpx_bank_code', bank.code);
  } else if (choice.method === 'card') {
    const card = ['visa', 'mastercard'].find((name) => has.has(name));
    if (!card) return null;
    params.set('preferred', card);
  } else {
    const wallet = WALLETS.find((candidate) => candidate.id === choice.method);
    const name = wallet?.chip.find((candidate) => has.has(candidate));
    if (!wallet || !name) return null;
    params.set('preferred', name);
    if (wallet.bankCode) params.set('razer_bank_code', wallet.bankCode);
  }
  return `${checkoutUrl}${checkoutUrl.includes('?') ? '&' : '?'}${params.toString()}`;
}

/** The choice in words, as it is written on the purchase's notes: "FPX · Maybank2u". */
export function choiceLabel(choice: OnlineChoice): string {
  if (choice.method === 'fpx') {
    const bank = FPX_BANKS.find((candidate) => candidate.id === choice.bank);
    return bank ? `FPX · ${bank.name}` : 'FPX';
  }
  if (choice.method === 'card') return 'Card';
  return WALLETS.find((wallet) => wallet.id === choice.method)?.paid ?? 'CHIP';
}

/**
 * How CHIP says the order was paid, for the order page's Paid row (board:
 * "FPX · Maybank2u", "Touch ’n Go eWallet", "Visa card ending 4242"). CHIP does
 * not name the FPX bank, so the bank comes from the purchase's notes, which say
 * what the customer chose, when they name one of ours.
 */
export function paidMethodLabel(purchase: { paymentMethod: string | null; maskedPan: string | null; notes?: string }): string {
  const method = purchase.paymentMethod;
  if (method === 'fpx') {
    const chosen = FPX_BANKS.find((bank) => purchase.notes === `FPX · ${bank.name}`);
    return chosen ? `FPX · ${chosen.name}` : 'FPX';
  }
  const wallet = WALLETS.find((candidate) => method !== null && (candidate.chip as readonly string[]).includes(method));
  if (wallet) return wallet.paid;
  const card = method ? CARD_NAMES[method] : undefined;
  if (card) {
    const last4 = purchase.maskedPan?.match(/(\d{4})\D*$/)?.[1];
    return last4 ? `${card} card ending ${last4}` : `${card} card`;
  }
  return 'CHIP';
}
