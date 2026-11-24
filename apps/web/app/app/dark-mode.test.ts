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
  // The frame is one white surface with its own bluer soft fill and hairline (Dash board, 24 Nov); a preview island keeps the calm greys.
  '--paper': 'var(--calm-surface)',
  '--card': 'var(--calm-surface)',
  '--surface': 'var(--frame-soft)',
  '--ink': 'var(--calm-ink)',
  '--muted': 'var(--calm-muted)',
  '--ink-soft': 'var(--calm-muted)',
  '--hint': 'var(--calm-muted)',
  '--faint': 'var(--calm-faint)',
  '--line': 'var(--frame-line)',
  '--edge': 'var(--calm-ring)',
  '--ground': 'var(--calm-surface)',
  '--nav-on': 'var(--calm-surface)',
  '--action': 'var(--calm-action)',
  '--action-fg': 'var(--calm-action-fg)',
  '--action-hover': 'var(--calm-action-hover)',
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
  '--action': '--calm-dark-action',
  '--action-fg': '--calm-dark-action-fg',
  '--action-hover': '--calm-dark-action-hover',
  '--select': '--calm-dark-ink',
  '--select-fg': '--calm-dark-bg',
  // The status tags keep their hue on dark fills, with lighter inks (rulings R5); the badge red is a role (R6).
  '--tag-ok': '--calm-dark-tag-ok',
  '--tag-ok-ink': '--calm-dark-tag-ok-ink',
  '--tag-wait': '--calm-dark-tag-wait',
  '--tag-wait-ink': '--calm-dark-tag-wait-ink',
  '--tag-attn': '--calm-dark-tag-attn',
  '--tag-attn-ink': '--calm-dark-tag-attn-ink',
  '--tag-new': '--calm-dark-tag-new',
  '--tag-new-ink': '--calm-dark-tag-new-ink',
  '--tag-red': '--calm-dark-tag-red',
  '--tag-red-ink': '--calm-dark-tag-red-ink',
  '--badge': '--calm-dark-badge',
  '--calm-pick': '--calm-dark-pick',
  '--calm-scrim': '--calm-dark-scrim',
  '--calm-row-hover': '--calm-dark-row-hover',
  '--calm-urgent': '--calm-dark-urgent',
  '--calm-urgent-ring': '--calm-dark-urgent-ring',
  '--calm-urgent-label': '--calm-dark-urgent-label',
  '--calm-urgent-ink': '--calm-dark-urgent-ink',
  '--calm-urgent-hover-ring': '--calm-dark-urgent-hover-ring',
  '--calm-urgent-hover-shadow': '--calm-dark-urgent-hover-shadow',
  '--calm-spark': '--calm-dark-spark',
  '--calm-spark-today': '--calm-dark-spark-today',
  '--calm-danger': '--calm-dark-danger',
  '--calm-twice': '--calm-dark-twice',
  '--calm-twice-ring': '--calm-dark-twice-ring',
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
    expect(frame).toMatch(/--paper:\s*var\(--calm-surface\)/);
    expect(frame).toMatch(/--action:\s*var\(--calm-action\)/);
  });

  it('maps the calm dark values in dark mode, and the preview island keeps the owner light', () => {
    expect(darkBlock['--paper']).toBe('var(--calm-dark-bg)');
    expect(darkBlock['--action']).toBe('var(--calm-dark-action)');
    expect(darkBlock['--action-fg']).toBe('var(--calm-dark-action-fg)');
    expect(darkBlock['--action-hover']).toBe('var(--calm-dark-action-hover)');
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
    for (const name of ['--tag-ok', '--tag-ok-ink', '--tag-wait', '--tag-wait-ink', '--tag-attn', '--tag-attn-ink', '--tag-new', '--tag-new-ink', '--tag-red', '--tag-red-ink', '--badge']) {
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

  it('maps the page-phase --calm-* tokens: a dark twin swapped in dark, the light value back in an island', () => {
    const pinned: Record<string, [string, string]> = {
      pick: ['#e2f4fb', '#232321'],
      'row-hover': ['#f2f9fc', '#1b1b1a'],
      // Attention is hot pink (Dash.dc, 24 Nov), no longer amber.
      urgent: ['#fdf0f7', '#3a1430'],
      'urgent-ring': ['#f6cfe5', '#5c1f4a'],
      'urgent-label': ['#ae1e74', '#f7a8d4'],
      'urgent-ink': ['#8e1660', '#f7a8d4'],
      'urgent-hover-ring': ['#efa9d2', '#8a3a72'],
      spark: ['#c6dde8', '#3a3936'],
      'spark-today': ['#1d7a4c', '#7fd3a5'],
      danger: ['#b3261e', '#ff8a80'],
      twice: ['#fdf3f2', '#451f28'],
      'twice-ring': ['#f3d4d0', '#5e2b36'],
    };
    for (const [k, [light, dark]] of Object.entries(pinned)) {
      expect(tokens[`--calm-${k}`], k).toBe(light);
      expect(tokens[`--calm-dark-${k}`], k).toBe(dark);
    }
    for (const k of Object.keys(pinned)) {
      expect(tokens[`--calm-${k}`], k).toMatch(/^#[0-9a-f]{6}$/);
      expect(tokens[`--calm-dark-${k}`], k).toMatch(/^#[0-9a-f]{6}$/);
      expect(darkBlock[`--calm-${k}`], k).toBe(`var(--calm-dark-${k})`);
      expect(chosenBlock[`--calm-${k}`], k).toBe(`var(--calm-dark-${k})`);
      expect(islandBlock[`--calm-${k}`], k).toBe(`var(--light-calm-${k})`);
    }
    // The urgent card's hover lift has a dark shadow too, mapped in both dark blocks and restored by the island.
    expect(tokens['--calm-dark-urgent-hover-shadow']).toBe('0 8px 20px -14px rgba(0, 0, 0, 0.6)');
    expect(darkBlock['--calm-urgent-hover-shadow']).toBe('var(--calm-dark-urgent-hover-shadow)');
    expect(chosenBlock['--calm-urgent-hover-shadow']).toBe('var(--calm-dark-urgent-hover-shadow)');
    expect(islandBlock['--calm-urgent-hover-shadow']).toBe('var(--light-calm-urgent-hover-shadow)');
    // These two are the same in both themes.
    expect(tokens['--calm-hover-ring']).toBe('#a8d1e2');
    expect(tokens['--calm-switch-off']).toBe('#7b8891');
  });
  it('gives the frame its own white ground, soft fill and line in light (24 Nov), and leaves the calm greys to the island', () => {
    expect(tokens['--frame-soft']).toBe('#e8f4f9');
    expect(tokens['--frame-line']).toBe('#ddedf4');
    expect(tokens['--frame-hover']).toBe('#f2f9fc');
    expect(tokens['--frame-track']).toBe('#d2eaf4');
    // The customer-page greys are untouched, and a preview island takes them (through the light aliases) back.
    expect(tokens['--calm-bg']).toBe('#fcffff');
    expect(tokens['--calm-soft']).toBe('#edf6fa');
    expect(tokens['--calm-line']).toBe('#e2eef3');
    expect(frameRoot).toMatch(/--line:\s*var\(--frame-line\)/);
    expect(islandBlock['--line']).toBe('var(--light-line)');
    expect(islandBlock['--surface']).toBe('var(--light-surface)');
  });

  it('swaps the sidebar states in dark, the same by the device and by the switch (the board, .lc.dash.dk)', () => {
    const states = (selector: string) => {
      const start = frame.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return declarations(frame.slice(start, frame.indexOf('}', start)));
    };
    const chosen = states(".frame[data-theme='dark'] .side");
    expect(states(".frame:not([data-theme='light']) .side")).toEqual(chosen);
    expect(chosen).toEqual({
      '--side-hover': 'var(--calm-dark-surface)',
      '--side-on': 'var(--dark-biru-muda)',
      '--side-on-ink': 'var(--calm-dark-ink)',
      '--side-on-icon': 'var(--sky-light)',
      '--side-track': 'var(--calm-dark-line)',
      '--side-fill': 'var(--sky-light)',
    });
    expect(tokens['--dark-biru-muda']).toBe('#0d2f3d');
    expect(tokens['--sky-light']).toBe('#5cc6ec');
  });
});
