/**
 * How strong a password looks, 0 to 4, for the four bars under the field: a
 * hint while typing, nothing more. The API decides (length, and the public
 * breach list), and says why when it refuses.
 */
export function strength(password: string): number {
  if (!password) return 0;
  if (password.length < 8) return 1;
  if (!(/[0-9]/.test(password) && /[A-Za-z]/.test(password))) return 2;
  return password.length >= 12 ? 4 : 3;
}
