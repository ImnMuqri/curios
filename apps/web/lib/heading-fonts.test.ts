import { describe, expect, it } from 'vitest';
import { HEADING_FONTS } from '@curios/core/bento';
import { HEADING_FONT_VAR } from './heading-fonts.js';

/**
 * Pure data, but it still drifts: a font added to `HEADING_FONTS` (bento.ts)
 * with no matching entry here renders `undefined` for `--font-heading` and
 * nothing catches it until a page picks that font. This proves both
 * directions -- the values are what `fonts.ts` actually declares, and the
 * key set matches the enum exactly.
 */
describe('HEADING_FONT_VAR', () => {
  it('maps every heading font to the CSS variable its next/font declaration uses', () => {
    expect(HEADING_FONT_VAR).toEqual({
      JAKARTA: 'var(--font-jakarta)',
      BRICOLAGE: 'var(--font-bricolage)',
      FRAUNCES: 'var(--font-fraunces)',
      SPACE_GROTESK: 'var(--font-space-grotesk)',
      DM_SERIF: 'var(--font-dm-serif)',
      OUTFIT: 'var(--font-outfit)',
    });
  });

  it('has exactly one entry per HeadingFont the enum declares', () => {
    expect(Object.keys(HEADING_FONT_VAR).sort()).toEqual([...HEADING_FONTS].sort());
  });
});
