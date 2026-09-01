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
const RESERVED_ROUTES = new Set([
  'app', 'api', 'faq', 'admin', 'about', 'pricing', 'help', 'support', 'blog',
  'login', 'signup', 'settings', 'static', 'next', '_next', 'www', 'auth',
  'terms', 'privacy', 'security', 'curios', 'root', 'system',
]);

/**
 * The profanity seed the spec calls for.
 *
 * Deliberately narrow. Only unambiguous vulgarities are here: mild expletives
 * that are also ordinary words -- `sial`, `bodoh`, `babi` -- are left out,
 * because a handle namespace that rejects ordinary words is a worse product
 * than one that lets a rude handle through to the takedown path.
 *
 * Matched exactly against the skeleton, like every other entry, so `fuckshop`
 * is NOT blocked. Substring matching is the obvious next thought and the wrong
 * one: it fails on innocent handles that happen to contain a short term, and
 * the false positives are invisible to us and infuriating to the person who
 * hit one. The residual gap goes where the spec already sends this class of
 * problem -- the takedown path in BACKEND.md, not the namespace.
 */
const RESERVED_PROFANITY = new Set([
  // English
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'whore', 'slut', 'rape',
  'nigger', 'faggot', 'retard',
  // Malay
  'pukimak', 'puki', 'kimak', 'cibai', 'lancau', 'pantat', 'kanina', 'lanjiao',
]);

/**
 * The Malaysian trademark seed the spec calls for.
 *
 * A seed, in the spec's own word, not a register: it holds the names whose
 * impersonation would be most immediately costly -- banks, telcos, airlines,
 * payment rails, and the government services people are asked to log into.
 * It is not legal advice and has not had legal review.
 *
 * Short and ambiguous names are deliberately absent. `mas`, `tng`, `tm` and
 * `ioi` are all real Malaysian marks and all plausible personal handles, and a
 * namespace that refuses someone called Mas to protect an airline abbreviation
 * has the trade backwards.
 *
 * Expansion is expected, and cheap: add a string. What this list misses is
 * handled the same way the confusables gap is -- by takedown, after the fact.
 */
const RESERVED_TRADEMARKS = new Set([
  // Banks and payments
  'maybank', 'cimb', 'publicbank', 'ambank', 'hongleong', 'bankislam', 'rhbbank',
  'touchngo', 'boost', 'bigpay', 'duitnow', 'fpx',
  // Telcos and utilities
  'celcom', 'maxis', 'umobile', 'unifi', 'telekom', 'tenaga', 'petronas', 'petron',
  // Airlines
  'airasia', 'malaysiaairlines', 'firefly', 'batikair',
  // Platforms and retail
  'shopee', 'lazada', 'foodpanda', 'mydin', 'aeon', 'lotuss', 'speedmart',
  // Automotive
  'proton', 'perodua',
  // Conglomerates
  'genting', 'sunway', 'simedarby', 'gamuda',
  // Government services people are asked to sign in to
  'mysejahtera', 'jpj', 'lhdn', 'kwsp', 'perkeso', 'myeg', 'imigresen',
]);

/**
 * Everything unclaimable, in one set.
 *
 * Kept as three named sets rather than one flat list so each entry's reason for
 * being here is visible. A future reader deleting `_next` because it looks like
 * a typo should be able to see which group it belongs to and why.
 */
const RESERVED = new Set([
  ...RESERVED_ROUTES,
  ...RESERVED_PROFANITY,
  ...RESERVED_TRADEMARKS,
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
