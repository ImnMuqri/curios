/**
 * The dashboard's theme, as the owner chose it in the header's switch. "system" follows the
 * device, and is what no cookie means. A cookie rather than browser storage, so the layout
 * renders the frame in the chosen theme from the first paint, with no light flash first.
 *
 * A plain module, not the switch's: the layout (a Server Component) reads it, and a value
 * exported from a 'use client' file reaches the server only as a reference.
 */
export const THEME_COOKIE = 'curios_theme';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}
