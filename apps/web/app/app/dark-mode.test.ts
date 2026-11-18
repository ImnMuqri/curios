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
/** The base tokens the calm scope re-maps, and what they take in the light frame and in dark mode. */
const calmLight: Record<string, string> = {
  '--paper': 'var(--calm-bg)',
  '--card': 'var(--calm-surface)',
  '--surface': 'var(--calm-soft)',
  '--ink': 'var(--calm-ink)',
  '--muted': 'var(--calm-muted)',
  '--ink-soft': 'var(--calm-muted)',
  '--hint': 'var(--calm-muted)',
  '--faint': 'var(--calm-faint)',
  '--line': 'var(--calm-line)',
  '--edge': 'var(--calm-ring)',
  '--ground': 'var(--calm-bg)',
  '--nav-on': 'var(--calm-surface)',
  '--action': 'var(--calm-ink)',
  '--action-fg': 'var(--calm-surface)',
  '--action-hover': 'var(--calm-ink-deep)',
};
const calmDark: Record<string, string> = {
  '--paper': '--calm-dark-bg',
  '--card': '--calm-dark-surface',
  '--surface': '--calm-dark-soft',
  '--ink': '--calm-dark-ink',
  '--muted': '--calm-dark-muted',
  '--ink-soft': '--calm-dark-muted',
  '--hint': '--calm-dark-muted',
  '--faint': '--calm-dark-faint',
  '--line': '--calm-dark-line',
  '--edge': '--calm-dark-ring',
  '--ground': '--calm-dark-bg',
  '--nav-on': '--calm-dark-surface',
  '--action': '--calm-dark-ink',
  '--action-fg': '--calm-dark-bg',
  '--action-hover': '--calm-dark-ink-deep',
  // The status tags keep their hue on dark fills, with lighter inks (rulings R5); the badge red is a role (R6).
  '--tag-ok': '--calm-dark-tag-ok',
  '--tag-ok-ink': '--calm-dark-tag-ok-ink',
  '--tag-wait': '--calm-dark-tag-wait',
  '--tag-wait-ink': '--calm-dark-tag-wait-ink',
  '--tag-new': '--calm-dark-tag-new',
  '--tag-new-ink': '--calm-dark-tag-new-ink',
  '--tag-red': '--calm-dark-tag-red',
  '--tag-red-ink': '--calm-dark-tag-red-ink',
  '--badge': '--calm-dark-badge',
};
/** The `.frame {…}` root rule, and the island rule, as text. */
const frameRoot = frame.slice(frame.indexOf('.frame {'), frame.indexOf('\n}\n', frame.indexOf('.frame {')));
const islandRule = frame.slice(frame.indexOf('.frame [data-island] {'), frame.indexOf('\n}\n', frame.indexOf('.frame [data-island] {')));
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
      const source = value.slice('var('.length, -1);
      expect(value, name).toBe(`var(${source})`);
      expect(tokens[source], name).toBeDefined();
      // Calm tokens are the dark mapping of the base tokens in `calmDark`; the rest are the old dark values.
      expect(source, name).toBe(calmDark[name] ?? `--dark-${name.slice(2)}`);
    }
  });

  it('maps the calm light values onto the base tokens on the frame', () => {
    const start = frame.indexOf('.frame {');
    const body = declarations(frame.slice(start, frame.indexOf('\n}\n', start)));
    for (const [name, value] of Object.entries(calmLight)) expect(body[name], name).toBe(value);
    expect(frame).toMatch(/--paper:\s*var\(--calm-bg\)/);
    expect(frame).toMatch(/--action:\s*var\(--calm-ink\)/);
  });

  it('maps the calm dark values in dark mode, and the preview island keeps the owner light', () => {
    expect(darkBlock['--paper']).toBe('var(--calm-dark-bg)');
    expect(darkBlock['--action']).toBe('var(--calm-dark-ink)');
    expect(darkBlock['--action-fg']).toBe('var(--calm-dark-bg)');
    expect(darkBlock['--action-hover']).toBe('var(--calm-dark-ink-deep)');
    expect(islandBlock['--paper']).toBe('var(--light-paper)');
    expect(islandBlock['--ink']).toBe('var(--light-ink)');
    expect(islandBlock['--action']).toBe('var(--light-action)');
  });

  it('works out again in the island whatever the frame derives from a swapped token', () => {
    // A custom property (and `color`) inherits its computed value, so what `.frame` works out from a swapped
    // token would reach the owner's preview in the frame's colours unless the island works it out again.
    const swapped = [...Object.keys(calmLight), '--ink-soft'];
    const derived = [...frameRoot.matchAll(/^\s*(--[a-z0-9-]+|color)\s*:\s*([^;]+);/gm)]
      .filter(([, name, value]) => !(name! in calmLight) && swapped.some((token) => value!.includes('var(' + token + ')')))
      .map(([, name]) => name!);
    expect(derived).toContain('--biru-deep');
    expect(derived).toContain('--soft');
    expect(derived).toContain('color');
    // A component hook may instead be unset (`initial`): the component then falls back to what a customer
    // sees. Only a hook may; a colour token must come back as its light value.
    const hook = /^--(button|field|callout)-/;
    for (const name of derived) {
      const back = hook.test(name) ? '([^;]*var\\(--light-|initial;)' : '[^;]*var\\(--light-';
      expect(islandRule, name).toMatch(new RegExp(`^\\s*${name}\\s*:\\s*${back}`, 'm'));
    }
  });

  it('unsets in the island every component hook the frame gives the calm look', () => {
    // The calm corners and the black pill's hover are the frame's voice, not the owner's: a Button or a
    // Field in the preview takes its customer-page fallback, so the island resets each such hook.
    const calmHooks = [...frameRoot.matchAll(/^\s*(--(?:button|field|callout)-[a-z0-9-]+)\s*:\s*([^;]+);/gm)]
      .filter(([, name, value]) => name!.includes('radius') || /var\(--(r-|action)/.test(value!))
      .map(([, name]) => name!);
    expect(calmHooks).toEqual(
      expect.arrayContaining([
        '--button-radius',
        '--button-primary-hover',
        '--button-primary-active',
        '--field-radius',
        '--field-area-radius',
        '--field-reveal-radius',
        '--callout-radius',
      ]),
    );
    for (const name of calmHooks) expect(islandRule, name).toMatch(new RegExp(`^\\s*${name}\\s*:\\s*initial;`, 'm'));
  });

  it('swaps the status tags and the badge in dark, so anything reading --tag-* or --badge follows (Leads new dot)', () => {
    for (const name of ['--tag-ok', '--tag-ok-ink', '--tag-wait', '--tag-wait-ink', '--tag-new', '--tag-new-ink', '--tag-red', '--tag-red-ink', '--badge']) {
      expect(darkBlock[name], name).toBe(`var(${calmDark[name]})`);
      expect(chosenBlock[name], name).toBe(`var(${calmDark[name]})`);
      expect(islandBlock[name], name).toBe(`var(--light-${name.slice(2)})`);
    }
    // Every calm dark token is read somewhere: a declared but unused one is a promise nothing keeps.
    const declared = Object.keys(tokens).filter((name) => name.startsWith('--calm-dark-'));
    for (const name of declared) expect(frame, name).toContain(`var(${name})`);
  });

  it('draws the counts and the avatar disc from the --badge role, never the raw calm red, and Sign out from the red tag ink', () => {
    // Sign out: the board's badge red in light, the lighter red tag ink in dark (DEVIATIONS row 314).
    expect(frame).toMatch(/\n\.menuOut \{\s*color:\s*var\(--tag-red-ink\);/);
    for (const file of ['./app-frame.module.css', './_ui/phone-menu.module.css', './_ui/notifications.module.css']) {
      expect(read(file), file).not.toContain('var(--calm-badge)');
      expect(read(file), file).toContain('var(--badge)');
    }
    // The avatar's initial takes the red tag ink, which lightens in dark (about 2.4:1 on the dark disc otherwise).
    const start = frame.indexOf('\n.avatar {');
    const avatar = frame.slice(start, frame.indexOf('}', start));
    expect(avatar).toMatch(/\n\s*color:\s*var\(--tag-red-ink\);/);
  });

  it('keeps no --dark-* token that the calm mapping replaced', () => {
    for (const name of Object.keys(calmDark)) {
      if (name.startsWith('--action')) continue;
      expect(tokens[`--dark-${name.slice(2)}`], name).toBeUndefined();
    }
  });

  it('gives every swapped token its light value back in a preview island, from the light alias of that same token', () => {
    expect(Object.keys(islandBlock)).toEqual(expect.arrayContaining(Object.keys(darkBlock)));
    for (const name of Object.keys(darkBlock)) {
      expect(islandBlock[name], name).toBe(`var(--light-${name.slice(2)})`);
      expect(tokens[`--light-${name.slice(2)}`], name).toBe(`var(${name})`);
    }
  });
});
