import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { widgetHeight, widgetSrc } from '@curios/core/widgets';
import { Widget } from './Widget.js';
import { BentoPage, type BentoPageProps } from './BentoPage.js';

const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const ref = 'playlist/37i9dQZF1DXcBWIGoYBM5M';

describe('Widget', () => {
  it("draws the service's player: lazy, titled, no autoplay", () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef={ref} label="My mix" url={url} interactive />);
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(widgetSrc('SPOTIFY', ref));
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.getAttribute('title')).toBe('My mix, Spotify');
    expect(frame.getAttribute('allow') ?? '').not.toContain('autoplay');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-forms');
  });

  it('gives the iframe itself the full widgetHeight', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef={ref} label="My mix" url={url} interactive />);
    expect((container.querySelector('iframe') as HTMLElement).style.height).toBe(`${widgetHeight('SPOTIFY', ref)}px`);
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
    render(<Widget provider="SPOTIFY" embedRef={ref} label="My mix" url={url} interactive />);
    const link = screen.getByRole('link', { name: 'Open in Spotify' });
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it("shows the owner's label above the frame, but not when it is only the service name", () => {
    const { unmount } = render(<Widget provider="SPOTIFY" embedRef={ref} label="My mix" url={url} interactive />);
    expect(screen.getByText('My mix').tagName).not.toBe('IFRAME');
    unmount();
    const { container } = render(<Widget provider="SPOTIFY" embedRef={ref} label="Spotify" url={url} interactive />);
    expect(container.querySelector('[data-widget-label]')).toBeNull();
  });

  it('covers the frame with a non-clickable cover in the editor preview', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef={ref} label="My mix" url={url} interactive={false} />);
    expect(container.querySelector('[data-widget-cover]')).not.toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('uses the aspect ratio where the height is 0', () => {
    const { container } = render(<Widget provider="YOUTUBE" embedRef="v/dQw4w9WgXc" label="Clip" url="https://youtu.be/dQw4w9WgXc" interactive />);
    expect((container.querySelector('iframe') as HTMLElement).style.aspectRatio).toBe('16 / 9');
  });

  it('renders only the fallback when the stored embedRef is malformed', () => {
    const { container } = render(<Widget provider="SPOTIFY" embedRef="../evil" label="My mix" url={url} interactive />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in Spotify' }).getAttribute('href')).toBe(url);
  });

  it('draws no link for a url that is not https', () => {
    render(<Widget provider="SPOTIFY" embedRef={ref} label="My mix" url="javascript:alert(1)" interactive />);
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
  it('draws a widget row as a player in its own li', () => {
    const { container } = render(<BentoPage {...page} />);
    expect(container.querySelectorAll('li[data-widget] iframe')).toHaveLength(1);
  });
  it('draws no widget in chat mode', () => {
    const { container } = render(<BentoPage {...page} mode="chat" />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
