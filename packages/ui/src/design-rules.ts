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

/** DESIGN.md's scale, and the test that says six is the number. */
const SCALE = new Set(['11px', '12.5px', '14px', '17px', '22px', '32px']);

export function findOffScaleFontSizes(css: string): string[] {
  return [...css.matchAll(/font-size:\s*([^;}]+)/gi)]
    .map((match) => (match[1] ?? '').trim())
    // A var() is a token reference, and a keyword or relative unit is not a new
    // step on the scale. Only a literal px value can add a seventh size.
    .filter((value) => /^[\d.]+px$/.test(value))
    .filter((value) => !SCALE.has(value));
}
