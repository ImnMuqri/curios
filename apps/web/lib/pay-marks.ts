/** The real marks of the ways to pay (public/pay), shared by checkout and the store's payment settings. */
export type PayMarkId = 'fpx' | 'tng' | 'grab' | 'spay' | 'visa' | 'mastercard' | 'duitnow';

/** `wide` marks (wordmarks) get a wider tile than the square icons; `navy` marks are white and need a dark tile. */
export const PAY_MARKS: Record<PayMarkId, { src: string; wide: boolean; navy: boolean }> = {
  fpx: { src: '/pay/fpx.png', wide: true, navy: true },
  tng: { src: '/pay/tng.svg', wide: false, navy: false },
  grab: { src: '/pay/grab.svg', wide: true, navy: false },
  spay: { src: '/pay/shopeepay.png', wide: false, navy: false },
  visa: { src: '/pay/visa.svg', wide: true, navy: false },
  mastercard: { src: '/pay/mastercard.svg', wide: false, navy: false },
  duitnow: { src: '/pay/duitnow.svg', wide: false, navy: false },
};
