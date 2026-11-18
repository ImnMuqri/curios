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

  it('maps the same calm tokens on every calm root, the light frame included, so they cannot drift', () => {
    // Every --token: value the four roots set from the calm palette (the frame's root is its light scope).
    const calmOf = (file: string, selector: string) =>
      Object.fromEntries(Object.entries(rule(read(file), selector)).filter(([, value]) => value.startsWith('var(--calm-')));
    const frame = calmOf('./app/app-frame.module.css', '.frame');
    expect(Object.keys(frame).length).toBeGreaterThanOrEqual(Object.keys(calm).length);
    for (const [file, selector] of roots) expect(calmOf(file, selector), selector).toEqual(frame);
  });
});

/*
 * Inter and the calm shared pieces, scope by scope. Only the calm scopes change: :root keeps its
 * fonts and the shared components keep their fallbacks, so customer pages and emails look as before.
 */
describe('the calm scopes read in Inter and set the shared pieces to the corner rule', () => {
  const scopes: [string, string][] = [['./app/app-frame.module.css', '.frame'], ...roots.map(([f, s]) => [f, s] as [string, string])];
  const hooks = {
    '--button-radius': 'var(--r-pill)',
    '--button-primary-hover': 'var(--action-hover)',
    '--button-primary-active': 'var(--action-hover)',
    '--field-radius': 'var(--r-pill)',
    '--field-area-radius': 'var(--r-box)',
    '--field-reveal-radius': '50%',
    '--callout-radius': 'var(--r-box)',
  };

  for (const [file, selector] of scopes) {
    it(`points --font-body at Inter on ${selector}, and the root reads it`, () => {
      const css = read(file);
      const start = css.indexOf(`\n${selector} {`);
      const block = css.slice(start, css.indexOf('\n}', start));
      expect(rule(css, selector)['--font-body']).toMatch(/^var\(--font-inter\)/);
      expect(block).toMatch(/\n\s*font-family:\s*var\(--font-body\);/);
      expect(css).not.toMatch(/--font-plex-sans/);
    });

    it(`sets the Button and Field hooks to pills and boxes on ${selector}`, () => {
      const body = rule(read(file), selector);
      // The dashboard's single-line fields take the box corner, like its cards (DEVIATIONS 347).
      const want = selector === '.frame' ? { ...hooks, '--field-radius': 'var(--r-box)' } : hooks;
      for (const [name, value] of Object.entries(want)) expect(body[name], name).toBe(value);
    });
  }

  it('leaves :root on its own fonts, so customer pages and emails keep theirs', () => {
    const tokens = readFileSync(path.resolve(__dirname, '../../../packages/ui/src/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--font-body: var\(--font-inter, Inter, system-ui, sans-serif\);/);
    expect(tokens).toMatch(/--font-display: var\(--font-bricolage,/);
  });
});

describe('the page title, from the calm Dash board (.pg h1)', () => {
  const css = read('./app/_ui/page-head.module.css');
  const title = (from: number) => css.slice(css.indexOf('.title {', from), css.indexOf('}', css.indexOf('.title {', from)));

  it('is Inter 48px, weight 600, -0.045em on a desktop', () => {
    const t = title(0);
    expect(t).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(t).toMatch(/font-size:\s*48px/);
    expect(t).toMatch(/font-weight:\s*600/);
    expect(t).toMatch(/letter-spacing:\s*-0\.045em/);
  });

  it('steps down to 38px on a phone', () => {
    expect(title(css.indexOf('@media (max-width: 760px)'))).toMatch(/font-size:\s*38px/);
  });
});
