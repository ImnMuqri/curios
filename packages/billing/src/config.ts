/** Every setting a Billplz integration needs, across the API and the workers. */
export const BILLPLZ_ENV = [
  'BILLPLZ_API_KEY',
  'BILLPLZ_COLLECTION_ID',
  'BILLPLZ_X_SIGNATURE_KEY',
  'BILLPLZ_BASE_URL',
  'BILLPLZ_CALLBACK_URL',
  'BILLPLZ_REDIRECT_URL',
] as const;

/**
 * Whether this process may run with billing switched off.
 *
 * Only outside production, and only when none of the Billplz settings is set:
 * a developer working on anything but payments should not need a Billplz
 * sandbox account just to boot the API. Everywhere else the settings stay
 * required at startup, where a missing value fails the deploy rather than an
 * owner's payment.
 *
 * A partial set is never "off". Some settings present and some missing is a
 * mistake, not a choice, so it falls through to the per-setting check that
 * names exactly which one is missing.
 */
export function billingDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return BILLPLZ_ENV.every((name) => !env[name]);
}
