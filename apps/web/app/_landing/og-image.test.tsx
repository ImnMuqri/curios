import { describe, expect, it } from 'vitest';
import { ogImage } from './og-image.js';

describe('the share image', () => {
  it.each(['en', 'ms'] as const)('%s: draws from the copy it has, and renders', async (locale) => {
    const response = ogImage(locale);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
