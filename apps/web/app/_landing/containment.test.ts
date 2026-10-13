import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..'); // apps/web/app
const WEB = join(APP, '..'); // apps/web
const LANDING = `_landing${sep}`;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

// Any mention of the libraries as a module: static, side-effect, dynamic, re-export.
const ANY = /(?:from|import)\s*\(?\s*['"](?:gsap|lenis)/;
// The only forms allowed in motion.ts: import('gsap...') and typeof import('gsap...').
const ALLOWED = /(?:typeof\s+)?import\s*\(\s*['"](?:gsap|lenis)[^'"]*['"]\s*\)/g;

describe('the landing motion libraries', () => {
  it('are imported only from app/_landing', () => {
    const offenders = files(WEB)
      .filter((path) => !relative(APP, path).startsWith(LANDING))
      .filter((path) => ANY.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('inside app/_landing, only motion.ts reaches them, and only on demand', () => {
    const offenders = files(join(APP, '_landing'))
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      .filter((path) => {
        const src = readFileSync(path, 'utf8');
        if (!path.endsWith(`${sep}motion.ts`)) return ANY.test(src);
        // In motion.ts, strip the allowed dynamic forms; anything left is static.
        return ANY.test(src.replace(ALLOWED, ''));
      });
    expect(offenders).toEqual([]);
  });

  it('never frost anything on the landing page', () => {
    const css = files(join(APP, '_landing')).filter((p) => p.endsWith('.css'));
    for (const path of css) expect(readFileSync(path, 'utf8')).not.toMatch(/backdrop-filter/);
  });
});
