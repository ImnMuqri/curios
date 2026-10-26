import { normalizeMalaysianPhone } from './phone.js';

/** The admin app's session cookie. Owner routes ignore it; admin routes ignore curios_session. */
export const ADMIN_COOKIE = 'curios_admin';

/** Eight hours, absolute: no sliding refresh. */
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Every action string an AdminAction row can carry. */
export const ADMIN_ACTIONS = {
  SIGNED_IN: 'SIGNED_IN',
  SUSPENDED_PAGE: 'SUSPENDED_PAGE',
  UNSUSPENDED_PAGE: 'UNSUSPENDED_PAGE',
  GRANTED_MONTH: 'GRANTED_MONTH',
  RESET_CONVERSATIONS: 'RESET_CONVERSATIONS',
  DELETED_ACCOUNT: 'DELETED_ACCOUNT',
  VIEWED_AS_OWNER: 'VIEWED_AS_OWNER',
  DISMISSED_REPORTS: 'DISMISSED_REPORTS',
  EMAILED_OWNER: 'EMAILED_OWNER',
} as const;

const DOTS = '••••••';

/**
 * A phone number with its middle hidden: +60••••••89. Malaysian numbers are
 * normalised first; anything else keeps a leading +, up to three leading
 * characters of the country code, and the last two digits.
 */
export function maskPhone(phone: string): string {
  const normalised = normalizeMalaysianPhone(phone);
  if (normalised) return `+60${DOTS}${normalised.slice(-2)}`;

  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 3) return `${plus}${DOTS}`;
  const head = digits.slice(0, Math.min(3, digits.length - 2));
  return `${plus}${head}${DOTS}${digits.slice(-2)}`;
}

/** Aisyah Rahman -> A. R. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(' ');
}
