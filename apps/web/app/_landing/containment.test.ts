import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..'); // apps/web/app
const WEB = join(APP, '..'); // apps/web

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('the landing motion libraries', () => {
  it('are imported only from app/_landing', () => {
    const offenders = files(WEB)
      .filter((path) => !relative(APP, path).startsWith(`_landing${sep}`))
      .filter((path) => /(?:from|import)\s*\(?\s*['"](?:gsap|lenis)/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never frost anything on the landing page', () => {
    const css = files(join(APP, '_landing')).filter((p) => p.endsWith('.css'));
    for (const path of css) expect(readFileSync(path, 'utf8')).not.toMatch(/backdrop-filter/);
  });
});
