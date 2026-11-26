import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { widgetHeight, widgetSrc } from '@curios/core/widgets';
import { Widget } from './Widget.js';
import { BentoPage, type BentoPageProps } from './BentoPage.js';

const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const ref = 'playlist/37i9dQZF1DXcBWIGoYBM5M';
const yt = 'https://youtu.be/dQw4w9WgXcQ';

const mapsUrl = 'https://www.google.com/maps/place/KLCC';

describe('Widget', () => {
  it("draws the service's player: lazy, titled, no autoplay", () => {
    const { container } = render(<Widget provider="GOOGLE_MAPS" embedRef="KLCC" label="Find us" url={mapsUrl} interactive />);
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(widgetSrc('GOOGLE_MAPS', 'KLCC'));
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.getAttribute('title')).toBe('Find us, Google Maps');
    expect(frame.getAttribute('allow') ?? '').not.toContain('autoplay');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-forms');
  });

  it('gives the iframe itself the full widgetHeight', () => {
    const { container } = render(<Widget provider="GOOGLE_MAPS" embedRef="KLCC" label="Find us" url={mapsUrl} interactive />);
    expect((container.querySelector('iframe') as HTMLElement).style.height).toBe(`${widgetHeight('GOOGLE_MAPS', 'KLCC')}px`);
  });

  it('caps the box corner so Soft pills never turn a player into an oval', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/\.widgetBox\s*\{[^}]*border-radius:\s*min\(var\(--btn-radius, 16px\), 16px\);/s);
    expect(css).toMatch(/\.widgetFrame\s*\{[^}]*border-radius:\s*calc\(min\(var\(--btn-radius, 16px\), 16px\) - 5px\);/s);
  });

  it('lets booking services take a form', () => {
    const { container } = render(<Widget provider="CALENDLY" embedRef="nadia" label="Book" url="https://calendly.com/nadia" interactive />);
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toContain('allow-forms');
  });

  it('always leaves an Open in link to the pasted url under the frame', () => {
    render(<Widget provider="GOOGLE_MAPS" embedRef="KLCC" label="Find us" url={mapsUrl} interactive />);
    const link = screen.getByRole('link', { name: 'Open in Google Maps' });
    expect(link.getAttribute('href')).toBe(mapsUrl);
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it("shows the owner's label above the frame, but not when it is only the service name", () => {
    const { unmount } = render(<Widget provider="GOOGLE_MAPS" embedRef="KLCC" label="Find us" url={mapsUrl} interactive />);
    expect(screen.getByText('Find us').tagName).not.toBe('IFRAME');
    unmount();
    const { container } = render(<Widget provider="GOOGLE_MAPS" embedRef="KLCC" label="Google Maps" url={mapsUrl} interactive />);
    expect(container.querySelector('[data-widget-label]')).toBeNull();
  });

  it('covers the frame with a non-clickable cover in the editor preview', () => {
    const { container } = render(<Widget provider="GOOGLE_MAPS" embedRef="KLCC" label="Find us" url={mapsUrl} interactive={false} />);
    expect(container.querySelector('[data-widget-cover]')).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('uses the aspect ratio where the height is 0', () => {
    const { container } = render(<Widget provider="YOUTUBE" embedRef="v/dQw4w9WgXc" label="Clip" url="https://youtu.be/dQw4w9WgXc" interactive />);
    expect((container.querySelector('iframe') as HTMLElement).style.aspectRatio).toBe('16 / 9');
  });

  it('renders only the fallback when the stored embedRef is malformed', () => {
    const { container } = render(<Widget provider="YOUTUBE" embedRef="../evil" label="Clip" url={yt} interactive />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in YouTube Music' }).getAttribute('href')).toBe(yt);
  });

  it('draws no link for a url that is not https', () => {
    render(<Widget provider="YOUTUBE" embedRef="v/dQw4w9WgXc" label="Clip" url="javascript:alert(1)" interactive />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('BentoPage widgets', () => {
  const page: BentoPageProps = {
    displayName: 'Nadia', handle: 'nadia', bio: null, avatarUrl: null, style: 'SOFT', accentColor: '#2340c8', headingFont: 'JAKARTA',
    links: [
      { id: 'a', label: 'Site', url: 'https://n.dev', size: null },
      { id: 'w', label: 'My mix', url, size: null, kind: 'WIDGET', provider: 'SPOTIFY', embedRef: ref },
    ],
  };
  it('draws a Spotify row as a card in its own li, with no player', () => {
    const { container } = render(<BentoPage {...page} />);
    expect(container.querySelectorAll('li[data-widget] [data-widget-card]')).toHaveLength(1);
    expect(container.querySelector('iframe')).toBeNull();
  });
  it('draws another service as a player in its own li', () => {
    const { container } = render(<BentoPage {...page} links={[{ id: 'm', label: 'Find us', url: 'https://www.google.com/maps/place/KLCC', size: null, kind: 'WIDGET', provider: 'GOOGLE_MAPS', embedRef: 'KLCC' }]} />);
    expect(container.querySelectorAll('li[data-widget] iframe')).toHaveLength(1);
  });
  it('draws no widget in chat mode', () => {
    const { container } = render(<BentoPage {...page} mode="chat" />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});

describe('Widget card (Spotify and Apple Music)', () => {
  const track = 'track/4uLU6hMCjMI75M1A2tKUQC';
  const cover = 'https://i.scdn.co/image/abc';

  it('is one link to the canonical address, never the pasted one, named by title and type', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef={track} label="Spotify" url="https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=tracking" title="Blinding Lights" image={cover} interactive />);
    const link = screen.getByRole('link', { name: 'Blinding Lights, Song on Spotify' });
    expect(link.getAttribute('href')).toBe('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(/Open in/)).toBeNull();
    expect(screen.getByText('Song · Spotify')).toBeTruthy();
    expect(container.querySelector('[data-card-title]')!.textContent).toBe('Blinding Lights');
  });

  it('draws the cover as a decorative lazy image without a referrer', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef={track} label="Spotify" url="https://open.spotify.com/x" title="T" image={cover} interactive />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(cover);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(container.querySelector('[data-card-mark]')).toBeNull();
  });

  it('falls back to the mark and the label, then the service name, when nothing was fetched', () => {
    const { container, unmount } = render(<Widget provider="SPOTIFY" embedRef="show/abc" label="My podcast" url="https://open.spotify.com/show/abc" interactive />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-card-mark]')).not.toBeNull();
    expect(container.querySelector('[data-card-title]')!.textContent).toBe('My podcast');
    expect(screen.getByText('Podcast · Spotify')).toBeTruthy();
    expect(container.querySelector('[data-widget-label]')).toBeNull();
    unmount();
    const bare = render(<Widget provider="SPOTIFY" embedRef="album/abc" label="Spotify" url="https://open.spotify.com/album/abc" interactive />);
    expect(bare.container.querySelector('[data-card-title]')!.textContent).toBe('Spotify');
  });

  it("shows the owner's label above the card only when it adds something", () => {
    const { container, unmount } = render(<Widget provider="SPOTIFY" embedRef={track} label="Our song" url="https://open.spotify.com/x" title="Blinding Lights" interactive />);
    expect(container.querySelector('[data-widget-label]')!.textContent).toBe('Our song');
    unmount();
    const same = render(<Widget provider="SPOTIFY" embedRef={track} label="Blinding Lights" url="https://open.spotify.com/x" title="Blinding Lights" interactive />);
    expect(same.container.querySelector('[data-widget-label]')).toBeNull();
  });

  it('refuses a cover that is not https', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef={track} label="Spotify" url="https://open.spotify.com/x" title="T" image="javascript:alert(1)" interactive />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('in the editor preview is the same card but not a link', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef={track} label="Spotify" url="https://open.spotify.com/x" title="Blinding Lights" image={cover} interactive={false} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-widget-card]')).not.toBeNull();
    expect(container.querySelector('[data-card-title]')!.textContent).toBe('Blinding Lights');
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('works for Apple Music: its address, type line and note mark', () => {
    const ref = 'us/album/after-hours/1499378108?i=1499378113';
    const { container } = render(<Widget provider="APPLE_MUSIC" embedRef={ref} label="Apple Music" url="https://music.apple.com/x" interactive />);
    const link = screen.getByRole('link', { name: 'Apple Music, Song on Apple Music' });
    expect(link.getAttribute('href')).toBe(`https://music.apple.com/${ref}`);
    expect(screen.getByText('Song · Apple Music')).toBeTruthy();
    expect(container.querySelector('[data-card-mark]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('draws the plain fallback for a malformed stored ref', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef="../evil" label="Mix" url="https://open.spotify.com/x" interactive />);
    expect(container.querySelector('[data-widget-card]')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('turns to a column in a small or tall Bento tile', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/\.bentoGrid > li:is\(\[data-size='SMALL'\], \[data-size='TALL'\]\) \.cardIn\s*\{[^}]*flex-direction:\s*column;/s);
  });
});
