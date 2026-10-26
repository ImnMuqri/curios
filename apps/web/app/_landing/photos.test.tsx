import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LandingPage } from './LandingPage.js';
import { PHOTOS, photo, photoCopy } from './photos.js';

const PUBLIC = join(import.meta.dirname, '..', '..', 'public');

describe('photos', () => {
  it('has every smaller copy it lists, beside its original', () => {
    for (const [src, { copies }] of Object.entries(PHOTOS)) {
      expect(existsSync(join(PUBLIC, src)), src).toBe(true);
      for (const width of copies) expect(existsSync(join(PUBLIC, photoCopy(src, width))), photoCopy(src, width)).toBe(true);
    }
  });

  it('offers the copies smallest first, then the original at its own width', () => {
    expect(photo('/landing/hero-baker.webp', 26)).toEqual({
      src: '/landing/hero-baker.webp',
      width: 1024,
      height: 1536,
      srcSet: '/landing/hero-baker-96.webp 96w, /landing/hero-baker-512.webp 512w, /landing/hero-baker.webp 1024w',
      sizes: '26px',
    });
  });

  it.each(['en', 'ms'] as const)('gives every image on the %s landing alt text, dimensions and copies', (locale) => {
    const { container } = render(<LandingPage locale={locale} />);
    const images = [...container.querySelectorAll('img')];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute('alt'), img.outerHTML).toMatch(/\S/);
      expect(img.getAttribute('width'), img.outerHTML).toMatch(/^\d+$/);
      expect(img.getAttribute('height'), img.outerHTML).toMatch(/^\d+$/);
      expect(img.getAttribute('srcset'), img.outerHTML).toBeTruthy();
    }
  });
});
