/**
 * The two rules DESIGN.md states in prose, made checkable.
 *
 * A rule in a document decays: someone reads it once, ships a #fff at 11pm,
 * and nothing objects. These are greps, which is all they need to be -- the
 * value is not in their cleverness but in their existing before there is any
 * CSS to check, while adding them is still free.
 */

/** Every hex spelling that is actually a colour: #rgb, #rrggbb, #rrggbbaa. */
const HEX = /#[0-9a-f]{3,8}\b/gi;

export function findHexLiterals(css: string): string[] {
  // A url() fragment identifier is a hash followed by a name, not a colour.
  const withoutUrls = css.replace(/url\([^)]*\)/gi, '');
  return [...withoutUrls.matchAll(HEX)]
    .map((match) => match[0])
    .filter((hex) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex));
}

/**
 * The sizes the approved design uses. DESIGN.md first said six steps
 * (11 / 12.5 / 14 / 17 / 22 / 32); the design handoff of 2026-10-16
 * (design/boards) is denser, and its CSS is the source of truth for sizes, so
 * this is every size those boards use on product screens. A size not here is
 * one nobody designed: the check still catches a stray 15.7px. (52 is the
 * deleted System board's 404 headline, set inline there; 48 was the calm Dash board's page title (.pg h1, now 40 / 34 / 32); 15.5 is its summary line; 54 is the
 * deleted Onboarding board's "facts found" count; 8.5 is the deleted TanyaJe board's count badge in the Orders mirror; 64 is the deleted Public board's product-page hero initial; 16.5 and 18.5 are the Site board's lede and legal text and its auth sub line; 56 is the Site board's legal title (.lg-h .ttl) and 60 its 404 headline and the More board's onboarding heading, 24 Nov.)
 */
const SCALE = new Set(
  [
    8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 18, 18.5, 19, 20, 21, 22, 23, 24, 26, 28, 30, 31,
    32, 34, 36, 38, 40, 42, 44, 48, 52, 54, 56, 60, 64,
  ].map((px) => `${px}px`),
);

export function findOffScaleFontSizes(css: string): string[] {
  return [...css.matchAll(/font-size:\s*([^;}]+)/gi)]
    .map((match) => (match[1] ?? '').trim())
    // A var() is a token reference, and a keyword or relative unit is not a new
    // step on the scale. Only a literal px value can add a seventh size.
    .filter((value) => /^[\d.]+px$/.test(value))
    .filter((value) => !SCALE.has(value));
}

/**
 * The calm corner rule: anything clicked or typed into is a pill, containers
 * are --r-box, circles are 50%. Returns every border-radius value that is none
 * of those (a var(--btn-radius)-style custom property, with or without a fallback, is a token reference and
 * passes, as does 0 or inherit).
 */
const RULE_RADII = new Set(['999px', '50%', '0', 'inherit', 'var(--r-box)', 'var(--r-pill)']);

export function findOffRuleRadii(css: string): string[] {
  return [...css.matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*([^;}]+)/gi)]
    .map((match) => (match[1] ?? '').trim())
    // A hook keeps its fallback (var(--button-radius, 10px)): the scope that sets the hook decides.
    .filter((value) => !RULE_RADII.has(value) && !/^var\(--[\w-]*radius[\w-]*(?:,[^()]*)?\)$/.test(value));
}
