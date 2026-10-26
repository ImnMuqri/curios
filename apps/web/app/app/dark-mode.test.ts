import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');
const declarations = (block: string) =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

const frame = read('./app-frame.module.css');
const dark = frame.slice(frame.indexOf('@media (prefers-color-scheme: dark)'));
const darkBlock = declarations(dark.slice(dark.indexOf('.frame {'), dark.indexOf('.frame [data-island]')));
const islandBlock = declarations(dark.slice(dark.indexOf('.frame [data-island]')));
const tokens = declarations(read('../../../../packages/ui/src/tokens.css'));

describe('dashboard dark mode', () => {
  it('swaps tokens only on the dashboard frame, never on :root', () => {
    expect(dark).not.toMatch(/:root/);
    expect(Object.keys(darkBlock).length).toBeGreaterThan(30);
  });

  it('takes every dark value from tokens.css, which defines it', () => {
    for (const [name, value] of Object.entries(darkBlock)) {
      expect(value, name).toBe(`var(--dark-${name.slice(2)})`);
      expect(tokens[`--dark-${name.slice(2)}`], name).toBeDefined();
    }
  });

  it('gives every swapped token its light value back in a preview island, from the light alias of that same token', () => {
    expect(Object.keys(islandBlock).sort()).toEqual(Object.keys(darkBlock).sort());
    for (const name of Object.keys(darkBlock)) {
      expect(islandBlock[name], name).toBe(`var(--light-${name.slice(2)})`);
      expect(tokens[`--light-${name.slice(2)}`], name).toBe(`var(${name})`);
    }
  });
});
