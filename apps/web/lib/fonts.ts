import {
  Bricolage_Grotesque,
  DM_Serif_Display,
  Fraunces,
  IBM_Plex_Mono,
  Inter,
  Outfit,
  Plus_Jakarta_Sans,
  Space_Grotesk,
} from 'next/font/google';

/*
 * Self-hosted at build time by next/font. The heading fonts are declared with
 * preload: false: a font's file is only fetched when something on the page
 * uses it, so a visitor downloads the one face their page chose, not six.
 *
 * The variable names below are the seam. packages/ui reads --font-display and
 * friends, which resolve through these -- so the design system never imports
 * Next and stays renderable in a plain vitest jsdom.
 *
 * Only the root layout may import this file. `HEADING_FONT_VAR` (the mapping
 * a client component needs) lives in `./heading-fonts.js` instead, which
 * imports nothing from `next/font`.
 */
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap', preload: false });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap', preload: false });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap', preload: false });
const dmSerif = DM_Serif_Display({ subsets: ['latin'], weight: '400', variable: '--font-dm-serif', display: 'swap', preload: false });
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap', preload: false });

export const fontVariables = [bricolage, inter, plexMono, jakarta, fraunces, spaceGrotesk, dmSerif, outfit]
  .map((font) => font.variable)
  .join(' ');
