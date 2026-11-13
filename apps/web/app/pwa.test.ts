import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadata as appMetadata, viewport as appViewport } from './app/pwa-metadata.js';

const publicDir = join(import.meta.dirname, '..', 'public');
const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8'));

/*
 * The owner's dashboard installs to a home screen as an app. A browser offers
 * that only with a manifest naming the app, a start page, a standalone display
 * and 192px and 512px icons -- each of which is checked here.
 */
describe('the installable app', () => {
  it('opens the dashboard, without the browser bar', () => {
    expect(manifest.name).toBe('Curios');
    expect(manifest.short_name).toBe('Curios');
    expect(manifest.start_url).toBe('/app');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('has a 192px and a 512px icon, and a maskable one, each on disk', () => {
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(join(publicDir, icon.src))).toBe(true);
  });

  it('is linked from the dashboard and landing, with the theme colour and the iPhone home-screen title', () => {
    expect(appMetadata.manifest).toBe('/manifest.webmanifest');
    expect(appMetadata.appleWebApp).toMatchObject({ capable: true, title: 'Curios' });
    expect(appViewport.themeColor).toBe(manifest.theme_color);
  });
});
