import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');
const declarations = (block: string) =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
/** The declarations of the rule that opens with `selector {`, up to its closing brace. */
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return declarations(css.slice(start, css.indexOf('\n}', start)));
};

const calm = {
  '--paper': 'var(--calm-bg)',
  '--card': 'var(--calm-surface)',
  '--surface': 'var(--calm-soft)',
  '--ink': 'var(--calm-ink)',
  '--muted': 'var(--calm-muted)',
  '--line': 'var(--calm-line)',
  '--edge': 'var(--calm-ring)',
  '--ground': 'var(--calm-bg)',
  '--nav-on': 'var(--calm-surface)',
  '--action': 'var(--calm-ink)',
  '--action-fg': 'var(--calm-surface)',
  '--action-hover': 'var(--calm-ink-deep)',
};

// The screens outside the dashboard: sign in and sign up (.auth), onboarding (.ob), and forgot, reset
// and verify (.sy, the system shell). Light only; the calm dark mode is the dashboard's alone.
const roots: [string, string, string][] = [
  ['./auth.module.css', '.auth', 'sign in and sign up'],
  ['./app/onboarding/onboarding.module.css', '.ob', 'onboarding'],
  ['./_system/system.module.css', '.sy', 'forgot, reset and verify'],
];

describe('the auth screens take the calm tokens', () => {
  for (const [file, selector, what] of roots) {
    it(`maps the calm light values onto the base tokens on ${selector} (${what})`, () => {
      const css = read(file);
      const body = rule(css, selector);
      for (const [name, value] of Object.entries(calm)) expect(body[name], name).toBe(value);
      expect(css).toMatch(/--paper:\s*var\(--calm-bg\)/);
      expect(css).toMatch(/--action:\s*var\(--calm-ink\)/);
      expect(css).not.toMatch(/--calm-dark-/);
    });
  }
});
