import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landingCopy } from './copy.js';
import { SITE_URL, structuredData } from './structured-data.js';
import { TERMS } from './test-kit.js';

type Node = Record<string, unknown>;
const graph = () => structuredData(landingCopy('en', TERMS), SITE_URL, TERMS.prices)['@graph'] as Node[];
const node = (type: string) => graph().find((n) => n['@type'] === type)!;

describe('the landing structured data', () => {
  // "Curios" alone is a common word; the alternate names tell search which site the brand is.
  it.each(['Organization', 'WebSite'])('%s carries the names people search for', (type) => {
    expect(node(type).name).toBe('Curios');
    expect(node(type).alternateName).toEqual(['Curios.my', 'Curios Malaysia']);
  });

  it('gives the organisation a raster logo that exists', () => {
    const logo = node('Organization').logo as Node;
    expect(logo).toMatchObject({ '@type': 'ImageObject', url: `${SITE_URL}/apple-icon.png`, width: 180, height: 180 });
    expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'apple-icon.png'))).toBe(true);
  });
});
