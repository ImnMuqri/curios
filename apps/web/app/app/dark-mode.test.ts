import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');
const declarations = (block: string) =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

const frame = read('./app-frame.module.css');
const dark = frame.slice(frame.indexOf('@media (prefers-color-scheme: dark)'));
const darkBlock = dark.slice(dark.indexOf('.frame {'), dark.indexOf('.frame [data-island]'));
const islandBlock = dark.slice(dark.indexOf('.frame [data-island]'));
const tokens = declarations(read('../../../../packages/ui/src/tokens.css'));

describe('dashboard dark mode', () => {
  it('swaps tokens only on the dashboard frame, never on :root', () => {
    expect(dark).not.toMatch(/:root/);
    expect(Object.keys(declarations(darkBlock)).length).toBeGreaterThan(30);
  });

  it('gives every swapped token back its light value inside a preview island, exactly as tokens.css has it', () => {
    const swapped = Object.keys(declarations(darkBlock));
    const island = declarations(islandBlock);
    expect(Object.keys(island).sort()).toEqual([...swapped].sort());
    for (const name of swapped) expect(island[name], name).toBe(tokens[name]);
  });
});
