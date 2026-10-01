import type { HeadingFont } from '@curios/core/bento';

/**
 * The CSS variable each heading font resolves through, for `--font-heading`.
 *
 * Pure -- imports nothing from `next/font`. `fonts.ts` is where the loaders
 * actually run, and that file may only be imported by the root layout: later
 * tasks import `HEADING_FONT_VAR` into client components and their tests, and
 * `next/font` must never end up in that graph.
 */
export const HEADING_FONT_VAR: Record<HeadingFont, string> = {
  JAKARTA: 'var(--font-jakarta)',
  BRICOLAGE: 'var(--font-bricolage)',
  FRAUNCES: 'var(--font-fraunces)',
  SPACE_GROTESK: 'var(--font-space-grotesk)',
  DM_SERIF: 'var(--font-dm-serif)',
  OUTFIT: 'var(--font-outfit)',
};
