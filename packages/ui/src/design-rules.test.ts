import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findHexLiterals, findOffRuleRadii, findOffScaleFontSizes } from './design-rules.js';

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
    expect(findHexLiterals('.a { color: var(--biru); }')).toEqual([]);
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

  it('flags a size nobody designed', () => {
    // The scale is the approved boards' sizes; anything else is a stray.
    expect(findOffScaleFontSizes('.a { font-size: 15.7px; }')).toEqual(['15.7px']);
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

describe('findOffRuleRadii', () => {
  it('finds radii off the calm rule', () => {
    expect(findOffRuleRadii('a{border-radius:12px}b{border-radius:999px}c{border-radius:var(--r-box)}')).toEqual([
      '12px',
    ]);
  });

  it('accepts every value the rule allows', () => {
    const css =
      'a{border-radius:999px}b{border-radius:50%}c{border-radius:var(--r-box)}d{border-radius:var(--r-pill)}e{border-radius:0}f{border-radius:inherit}g{border-radius:var(--btn-radius)}';
    expect(findOffRuleRadii(css)).toEqual([]);
  });
});

describe('the calm tokens', () => {
  const tokens = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
  const light = ['bg', 'surface', 'ink', 'ink-deep', 'muted', 'line', 'soft', 'ring', 'badge'];
  const tags = ['ok', 'wait', 'new', 'red'].flatMap((t) => [`tag-${t}`, `tag-${t}-ink`]);
  const names = [
    ...light.map((n) => `--calm-${n}`),
    ...light.map((n) => `--calm-dark-${n}`),
    ...tags.map((n) => `--${n}`),
    ...tags.map((n) => `--calm-dark-${n}`),
    '--action',
    '--action-fg',
    '--action-hover',
    '--r-box',
    '--r-pill',
  ];

  it('defines every calm token, light and dark', () => {
    for (const name of names) {
      const declared = tokens.match(new RegExp(`^\\s*${name}:`, 'gm')) ?? [];
      expect(declared, name).toHaveLength(1);
    }
  });
});

describe('findOffRuleRadii, longhand and multi-value', () => {
  it('reads the corner longhands', () => {
    expect(findOffRuleRadii('a{border-top-left-radius:12px}b{border-bottom-right-radius:var(--r-box)}')).toEqual([
      '12px',
    ]);
  });

  it('flags a multi-value shorthand', () => {
    expect(findOffRuleRadii('a{border-radius:16px 16px 0 0}')).toEqual(['16px 16px 0 0']);
  });
});
