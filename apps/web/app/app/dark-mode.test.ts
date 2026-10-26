import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');
const declarations = (block: string) =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

const frame = read('./app-frame.module.css');
const dark = frame.slice(frame.indexOf('@media (prefers-color-scheme: dark)'));
/** The declarations of the rule that opens with `selector {`, up to its closing brace. */
const rule = (selector: string) => {
  const start = dark.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return declarations(dark.slice(start, dark.indexOf('}', start)));
};
// Dark by the device, unless the owner chose Light; and dark by the owner's own choice.
const darkBlock = rule(".frame:not([data-theme='light'])");
const chosenBlock = rule(".frame[data-theme='dark']");
const islandBlock = rule('.frame [data-island]');
const tokens = declarations(read('../../../../packages/ui/src/tokens.css'));

describe('dashboard dark mode', () => {
  it('swaps tokens only on the dashboard frame, never on :root', () => {
    expect(dark).not.toMatch(/:root/);
    expect(Object.keys(darkBlock).length).toBeGreaterThan(30);
  });

  it('follows the device only inside the media query, and the switch outside it', () => {
    const media = dark.slice(0, dark.indexOf('\n}\n'));
    expect(media).toContain(".frame:not([data-theme='light'])");
    expect(media).not.toContain(".frame[data-theme='dark']");
  });

  it('gives Dark from the switch exactly the dark the device gets', () => {
    expect(chosenBlock).toEqual(darkBlock);
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
