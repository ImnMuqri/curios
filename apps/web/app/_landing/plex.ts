import { IBM_Plex_Sans } from 'next/font/google';

/*
 * The landing family's body face, shared by the landing page and the five
 * sign-in screens (AuthShell). The product's own screens keep Inter. Declared
 * once here: next/font wants one call per face, not one per importer.
 */
export const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans', display: 'swap' });
