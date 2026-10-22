/**
 * The settings whose joint absence means "billing is off". CHIP_PUBLIC_KEY (fetched from
 * CHIP when unset), CHIP_BASE_URL (CHIP_DEFAULT_BASE_URL when unset) and
 * CHIP_WEBHOOK_PUBLIC_KEY (required in production only, enforced where it is read) are
 * deliberately not here: a developer with none of the three required ones is not
 * configuring payments, whatever else is set.
 */
export const CHIP_ENV = ['CHIP_SECRET_KEY', 'CHIP_BRAND_ID', 'CHIP_CALLBACK_BASE_URL'] as const;

/** CHIP's API root, used when CHIP_BASE_URL is unset. */
export const CHIP_DEFAULT_BASE_URL = 'https://gate.chip-in.asia/api/v1';

/**
 * Whether this process may run with billing switched off.
 *
 * Only outside production, and only when none of the CHIP settings is set:
 * a developer working on anything but payments should not need a CHIP
 * account just to boot the API. Everywhere else the settings stay
 * required at startup, where a missing value fails the deploy rather than an
 * owner's payment.
 *
 * A partial set is never "off". Some settings present and some missing is a
 * mistake, not a choice, so it falls through to the per-setting check that
 * names exactly which one is missing.
 */
export function billingDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return CHIP_ENV.every((name) => !env[name]);
}

/**
 * A PEM public key as it comes out of the environment, or undefined when unset or blank.
 * A one-line .env value or a hosting dashboard often holds the key with each newline
 * written as a backslash and an n; those are turned back into newlines, so the key
 * parses either way. A value pasted with real newlines (a quoted multi-line value) is
 * left as it is.
 */
export function pemFromEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replaceAll(String.raw`\n`, '\n');
}
