import { normalizeMalaysianPhone } from './phone.js';

/**
 * The social profiles a page can show as icons under its name, in the order
 * they show. Stored as handles (a number for WhatsApp, an address for email),
 * never as URLs: the URL is built here, so a stored value cannot point
 * anywhere but the profile it names.
 *
 * Client-safe (`@curios/core/socials`): the editor and the public page use it too.
 */
export const SOCIAL_KINDS = ['instagram', 'whatsapp', 'tiktok', 'email', 'facebook', 'youtube'] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
export type Socials = Partial<Record<SocialKind, string>>;

const HANDLE: Record<Exclude<SocialKind, 'whatsapp' | 'email'>, { prefix: RegExp; shape: RegExp; lower: boolean }> = {
  instagram: { prefix: /^(https?:\/\/)?(www\.)?instagram\.com\//i, shape: /^[a-z0-9._]{1,30}$/, lower: true },
  tiktok: { prefix: /^(https?:\/\/)?(www\.|m\.)?tiktok\.com\/@?/i, shape: /^[a-z0-9._]{2,24}$/, lower: true },
  facebook: { prefix: /^(https?:\/\/)?(www\.|m\.)?facebook\.com\//i, shape: /^[A-Za-z0-9.-]{1,50}$/, lower: false },
  youtube: { prefix: /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/@?/i, shape: /^[A-Za-z0-9._-]{3,30}$/, lower: false },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What to store for what the owner typed: a handle, a pasted profile URL, an
 * @name, a number. '' clears the field; null means it could not be read as
 * that kind of profile, and the editor says so rather than guessing.
 */
export function normalizeSocial(kind: SocialKind, raw: string): string | null {
  const value = raw.trim();
  if (value === '') return '';

  if (kind === 'email') {
    const email = value.replace(/^mailto:/i, '').toLowerCase();
    return EMAIL.test(email) && email.length <= 254 ? email : null;
  }

  if (kind === 'whatsapp') {
    const number = value.replace(/^(https?:\/\/)?(api\.)?(wa\.me|whatsapp\.com\/send\?phone=)\/?/i, '');
    const e164 = normalizeMalaysianPhone(number);
    return e164 ? e164.replace(/^\+/, '') : null;
  }

  const rule = HANDLE[kind];
  const stripped = value.replace(rule.prefix, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  // A full URL to some other site is not a handle with junk on it.
  if (/^https?:|\.(com|my|net|org)\//i.test(stripped)) return null;
  const handle = rule.lower ? stripped.toLowerCase() : stripped;
  return rule.shape.test(handle) ? handle : null;
}

/** Where a stored profile lives. */
export function socialUrl(kind: SocialKind, value: string): string {
  switch (kind) {
    case 'instagram':
      return `https://instagram.com/${value}`;
    case 'whatsapp':
      return `https://wa.me/${value}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${value}`;
    case 'email':
      return `mailto:${value}`;
    case 'facebook':
      return `https://facebook.com/${value}`;
    case 'youtube':
      return `https://youtube.com/@${value}`;
  }
}

/** The filled-in profiles from a stored column (JSON, so anything), in display order. */
export function tidySocials(stored: unknown): { kind: SocialKind; value: string }[] {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  const record = stored as Record<string, unknown>;
  return SOCIAL_KINDS.flatMap((kind) => {
    const value = record[kind];
    return typeof value === 'string' && value !== '' ? [{ kind, value }] : [];
  });
}
