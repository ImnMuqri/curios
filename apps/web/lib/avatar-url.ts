/**
 * Joins a storage base URL and an object key, trimming the base's trailing
 * slash(es) so the two never collide into a double slash. Shared by
 * `avatarUrl` here (server-side, reading `STORAGE_PUBLIC_URL` itself) and by
 * `my-curios-wrapper.tsx` (client-side, handed the same base as a prop) --
 * one join, so the two can never drift apart on this rule.
 */
export function joinAvatarUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key}`;
}

/** The public URL of an uploaded picture, or null when there is none or storage is not configured. */
export function avatarUrl(key: string | null): string | null {
  const base = process.env.STORAGE_PUBLIC_URL;
  if (!key || !base) return null;
  return joinAvatarUrl(base, key);
}
