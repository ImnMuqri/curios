/**
 * Sites that show the crawler a login wall instead of a profile.
 *
 * A link to one of these can only come back as "we found nothing": the page the
 * crawler receives is a sign-in form, and at best a title. Sending it anyway
 * spends an ingestion and a rate-limit token to tell the owner what this list
 * already knows, so the form opens the paste box instead.
 *
 * Matched on the host alone, subdomains included. Anything else in the address
 * -- a shop whose path mentions instagram.com -- is the owner's own site.
 */
const LOGIN_WALLED: ReadonlyArray<readonly [host: string, name: string]> = [
  ['linkedin.com', 'LinkedIn'],
  ['instagram.com', 'Instagram'],
  ['tiktok.com', 'TikTok'],
];

/** The site's name when this link points behind a login wall, otherwise null. */
export function loginWalledSite(link: string): string | null {
  const trimmed = link.trim();
  if (trimmed === '') return null;

  let host: string;
  try {
    // Owners paste what the address bar shows, often without the scheme.
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }

  const lower = host.toLowerCase();
  const match = LOGIN_WALLED.find(([domain]) => lower === domain || lower.endsWith(`.${domain}`));
  return match ? match[1] : null;
}
