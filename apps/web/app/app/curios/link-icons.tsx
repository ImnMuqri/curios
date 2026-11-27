// Shared by the Links and Layout tabs: the glyph at the start of a row, read off the address.
import { WIDGET_NAMES, cardTypeName, effectivePictureMode as effectiveMode, type WidgetProvider } from '@curios/core/widgets';
import ui from '../_ui/editor.module.css';

/** An address as the row shows it: without the scheme nobody reads. */
export const shown = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/^mailto:/i, '').replace(/\/$/, '');

export function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
      <path d={d} />
    </svg>
  );
}

/**
 * The tile at a row's start (v3 board): WhatsApp and Instagram in their own colours, any other
 * address a plain link, read off the address so the owner never has to say what a link is.
 */
export const KINDS = {
  whatsapp: 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17.5 6.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
} as const;
export const kindOf = (url: string): keyof typeof KINDS =>
  /^(https?:\/\/)?([\w-]+\.)*(wa\.me|whatsapp\.com)(\/|$)/i.test(url)
    ? 'whatsapp'
    : /^(https?:\/\/)?([\w-]+\.)*instagram\.com(\/|$)/i.test(url)
      ? 'instagram'
      : 'link';

/** One small glyph per service, drawn inline: no image requests. */
const NOTE = 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z';
const CALENDAR = 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4';
const WIDGET_GLYPHS: Record<WidgetProvider, string> = {
  SPOTIFY: NOTE,
  APPLE_MUSIC: NOTE,
  YOUTUBE: 'M9 7l8 5-8 5zM3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z',
  SOUNDCLOUD: 'M3 15v-3M6 16V9M9 16V7M12 16V6M15 16h3a3 3 0 0 0 0-6 5 5 0 0 0-3-1',
  GOOGLE_MAPS: 'M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM12 8.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  CALCOM: CALENDAR,
  CALENDLY: CALENDAR,
  CANVA: 'M12 3l9 9-9 9-9-9zM12 8l4 4-4 4-4-4z',
  PICTURES: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M9 9.5a1.5 1.5 0 1 0 0-.01z',
  GIF: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 15v-6h-2v6zM12 9v6M15 15V9h3M15 12h2',
};

export function WidgetIcon({ provider }: { provider: WidgetProvider }) {
  return <Icon d={WIDGET_GLYPHS[provider]} />;
}

export { effectivePictureMode as effectiveMode } from '@curios/core/widgets';

export const MODE_NAMES = { CAROUSEL: 'Carousel', GRID: 'Grid', FULL: 'Full width', SQUARE: 'Square' } as const;

type Described = { provider: WidgetProvider | null; embedRef: string | null; pictureMode: 'CAROUSEL' | 'GRID' | 'FULL' | 'SQUARE' | null; pictures: unknown[] };

/**
 * The line under a widget's name, in the Links and Layout tabs: what it is, never an address (a picture
 * widget has none). "Gallery · 3 pictures · Carousel", "GIF · Full width", "Spotify · Song".
 */
export function widgetLine(link: Described): string {
  const provider = link.provider;
  if (provider === 'PICTURES') {
    const count = link.pictures.length;
    if (count === 0) return 'Gallery · No pictures yet';
    return `Gallery · ${count} ${count === 1 ? 'picture' : 'pictures'} · ${MODE_NAMES[effectiveMode('PICTURES', count, link.pictureMode)]}`;
  }
  if (provider === 'GIF') return `GIF · ${link.pictures.length === 0 ? 'No GIF yet' : MODE_NAMES[effectiveMode('GIF', 1, link.pictureMode)]}`;
  if (provider === null) return '';
  const ref = link.embedRef ?? '';
  switch (provider) {
    case 'SPOTIFY':
    case 'APPLE_MUSIC':
      return `${WIDGET_NAMES[provider]} · ${cardTypeName(provider, ref) || 'Song'}`;
    case 'SOUNDCLOUD':
      return 'SoundCloud · Song';
    case 'YOUTUBE':
      return `YouTube · ${ref.startsWith('list/') ? 'Playlist' : 'Video'}`;
    case 'GOOGLE_MAPS':
      return 'Google Maps · Map';
    case 'CALCOM':
    case 'CALENDLY':
      return `${WIDGET_NAMES[provider]} · Calendar`;
    case 'CANVA':
      return 'Canva · Design';
  }
}
