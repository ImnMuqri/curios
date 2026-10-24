import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const brand = (name: string) => readFileSync(join(here, '..', '..', '..', 'design', 'brand', name));
const app = (name: string) => readFileSync(join(here, name));

describe('the site icons', () => {
  // HANDOFF: Peek's eyes on brand blue. The app serves copies of design/brand/, so they must not drift.
  it.each(['icon.svg', 'apple-icon.png', 'favicon.ico'])('%s is the design copy', (name) => {
    expect(app(name).equals(brand(name))).toBe(true);
  });
});
