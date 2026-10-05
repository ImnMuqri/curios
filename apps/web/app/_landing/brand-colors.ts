/**
 * The locked palette, as plain strings, for the few places CSS custom
 * properties cannot reach: the generated Open Graph image and the touch icon,
 * which are rendered to PNG on the server with no stylesheet.
 *
 * A mirror of packages/ui/src/tokens.css, never a source of truth.
 * brand-colors.test.ts fails if a value here stops matching it.
 */
export const BRAND = {
  ink: '#191f2c',
  paper: '#fafbfc',
  biru: '#2340c8',
  biruMuda: '#eaf0ff',
  kuning: '#f2a33c',
  card: '#ffffff',
  muted: '#696e7b',
} as const;
