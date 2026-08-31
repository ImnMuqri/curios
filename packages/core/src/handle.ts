export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/**
 * Names that must never sit at the root of the same namespace as a handle.
 *
 * `_next` is Next.js's asset path, `auth` and `api` are our own routes, and
 * the rest are the ordinary reservations BACKEND.md calls day-one work,
 * because retrofitting this once people own handles is miserable.
 *
 * Checked against the SKELETON, not the raw handle, so `adm1n` cannot walk
 * past an entry for `admin`. Non-ASCII lookalikes are stopped earlier and
 * harder, by the character class in `checkHandle`.
 */
const RESERVED = new Set([
  'app', 'api', 'faq', 'admin', 'about', 'pricing', 'help', 'support', 'blog',
  'login', 'signup', 'settings', 'static', 'next', '_next', 'www', 'auth',
  'terms', 'privacy', 'security', 'curios', 'root', 'system',
]);

/**
 * The shape of a handle, for deciding whether two of them are confusable.
 *
 * NFKD and not NFKC, deliberately: decomposition is what puts the combining
 * marks somewhere they can be stripped, which collapses every accented variant
 * of a name onto one shape. It does NOT touch atomic lookalike letters such as
 * U+0131 -- those are rejected by the character class instead, which is a
 * stronger guarantee. Kept anyway, because it is what keeps this function
 * meaningful if the character class is ever widened for Unicode handles. `normalizeClaim` in this same package
 * uses NFKC for the opposite reason, and the two must not be unified.
 *
 * Only digits fold to letters. Folding letters onto each other — {1, l, i} —
 * maps `mail` and `mall` together, which is why UTS-39 skeletons are normally
 * used to flag for review rather than to hard-block. The residual gap is
 * stated rather than hidden: `nadla` will not collide with `nadia`, and
 * impersonation by letter substitution is handled by the takedown path
 * BACKEND.md specifies, not by this namespace.
 */
export function handleSkeleton(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i');
}

export type HandleCheck =
  | { ok: true; handle: string; skeleton: string }
  | { ok: false; reason: 'FORMAT' | 'RESERVED' };

const SHAPE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function checkHandle(raw: string): HandleCheck {
  const handle = raw.trim().toLowerCase();

  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return { ok: false, reason: 'FORMAT' };
  }
  // SHAPE also rejects a leading or trailing separator, which is what makes
  // `_next` unclaimable on format alone. It stays on the reserved list anyway,
  // so the reservation still holds if this rule is ever loosened.
  if (!SHAPE.test(handle)) return { ok: false, reason: 'FORMAT' };

  const skeleton = handleSkeleton(handle);
  if (RESERVED.has(skeleton)) return { ok: false, reason: 'RESERVED' };

  return { ok: true, handle, skeleton };
}
