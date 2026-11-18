import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, 'help.module.css'), 'utf8').replace(/\r\n/g, '\n');

/** The declarations of the first rule whose selector is exactly `selector`, at any depth. */
function rule(selector: string, from = 0): string {
  const at = css.indexOf(`${selector} {`, from);
  if (at < 0) return '';
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

/** The text of the media block that opens with `query`. */
function media(query: string): string {
  const at = css.indexOf(`@media ${query} {`);
  if (at < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
  }
  return '';
}

describe('help.module.css: where the panel sits', () => {
  it('leaves no strip between the top bar and the panel at any width: the scrim covers the whole screen', () => {
    expect(css).not.toMatch(/top:\s*64px/);
    expect(css).not.toMatch(/inset:\s*64px/);
    expect(rule('.scrim')).toMatch(/inset:\s*0/);
    expect(rule('.scrim')).not.toMatch(/display:\s*none/);
  });

  it('is a sheet at the frame’s own breakpoint, 1100px, not 760px', () => {
    expect(css).not.toContain('max-width: 760px');
    const sheet = media('(max-width: 1100px)');
    expect(sheet).toMatch(/\.panel\s*\{[^}]*bottom:/);
    expect(sheet).toMatch(/\.panel\s*\{[^}]*animation-name:\s*panelUp/);
  });

  it('turns every animation off under prefers-reduced-motion', () => {
    const calm = media('(prefers-reduced-motion: reduce)');
    for (const name of ['.panel', '.scrim']) expect(calm).toContain(name);
    expect(calm).toMatch(/animation:\s*none/);
  });
});
