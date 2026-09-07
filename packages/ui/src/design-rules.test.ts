import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findHexLiterals, findOffScaleFontSizes } from './design-rules.js';

describe('findHexLiterals', () => {
  it('finds a hex colour', () => {
    expect(findHexLiterals('.a { color: #0C7A62; }')).toEqual(['#0C7A62']);
  });

  it('finds short and eight-digit forms too', () => {
    // #fff and #0C7A62CC are the two spellings a "no hex" check written in a
    // hurry misses, and both are still a colour typed into a component.
    expect(findHexLiterals('.a { color: #fff; }')).toEqual(['#fff']);
    expect(findHexLiterals('.a { color: #0C7A62CC; }')).toEqual(['#0C7A62CC']);
  });

  it('does not flag a token reference', () => {
    expect(findHexLiterals('.a { color: var(--hijau); }')).toEqual([]);
  });

  it('does not flag a URL fragment that merely contains a hash', () => {
    expect(findHexLiterals('.a { background: url("/x.svg#icon"); }')).toEqual([]);
  });
});

describe('findOffScaleFontSizes', () => {
  it('accepts every step of the scale', () => {
    const css =
      '.a{font-size:11px}.b{font-size:12.5px}.c{font-size:14px}.d{font-size:17px}.e{font-size:22px}.f{font-size:32px}';
    expect(findOffScaleFontSizes(css)).toEqual([]);
  });

  it('flags a seventh size', () => {
    // DESIGN.md: "Six sizes. Adding a seventh is a smell."
    expect(findOffScaleFontSizes('.a { font-size: 18px; }')).toEqual(['18px']);
  });

  it('ignores relative and keyword sizes, which are not new steps', () => {
    expect(findOffScaleFontSizes('.a { font-size: inherit; } .b { font-size: 1em; }')).toEqual([]);
  });

  it('accepts a token reference, which is how a component should say it', () => {
    expect(findOffScaleFontSizes('.a { font-size: var(--text-body); }')).toEqual([]);
  });
});

/**
 * The unit tests above prove the checkers work. These walk what actually
 * exists, so a hex typed into a module six months from now fails here rather
 * than being noticed by nobody.
 */
describe('the rules hold across every stylesheet in the repo', () => {
  const roots = [
    join(import.meta.dirname, '..', '..', '..', 'packages', 'ui', 'src'),
    join(import.meta.dirname, '..', '..', '..', 'apps', 'web', 'app'),
  ];

  function stylesheets(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) out.push(...stylesheets(path));
      else if (entry.endsWith('.module.css')) out.push(path);
    }
    return out;
  }

  const found = roots.flatMap(stylesheets);

  it('is actually looking at files, not at an empty list', () => {
    // Without this, both tests below pass forever if the walk breaks or the
    // suffix stops matching -- a guard that inspects nothing reports no
    // problems, which is indistinguishable from a guard that works.
    expect(found.length).toBeGreaterThan(0);
  });

  it('declares no hex outside tokens.css', () => {
    const offenders = found.flatMap((file) =>
      findHexLiterals(readFileSync(file, 'utf8')).map((hex) => `${file}: ${hex}`),
    );
    expect(offenders).toEqual([]);
  });

  it('declares no font-size outside the six-step scale', () => {
    const offenders = found.flatMap((file) =>
      findOffScaleFontSizes(readFileSync(file, 'utf8')).map((size) => `${file}: ${size}`),
    );
    expect(offenders).toEqual([]);
  });
});
