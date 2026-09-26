/** The public URL of an uploaded picture, or null when there is none or storage is not configured. */
export function avatarUrl(key: string | null): string | null {
  const base = process.env.STORAGE_PUBLIC_URL;
  if (!key || !base) return null;
  return `${base.replace(/\/+$/, '')}/${key}`;
}
