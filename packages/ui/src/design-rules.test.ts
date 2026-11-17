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

  it('accepts a radius hook with a fallback, which is how a shared piece keeps its look outside the calm scope', () => {
    // Button reads var(--button-radius, 10px): the calm scope sets the hook, a customer page keeps 10px.
    expect(findOffRuleRadii('a{border-radius:var(--button-radius, 10px)}')).toEqual([]);
  });

  it('still flags a non-radius custom property with a literal fallback', () => {
    expect(findOffRuleRadii('a{border-radius:var(--gap, 10px)}')).toEqual(['var(--gap, 10px)']);
  });
});

describe('the font scale', () => {
  it("has the board's 48px page title (Dash.html .pg h1)", () => {
    expect(findOffScaleFontSizes('.a { font-size: 48px; }')).toEqual([]);
  });
});

/**
 * The calm redesign's shared pieces (Task 3 of the calm foundation plan): the buttons, fields and
 * dashboard parts every screen is built from. Page modules join the corner check one by one as each
 * page is restyled; these are on it from now.
 */
describe('the calm rules on the shared pieces', () => {
  const repo = join(import.meta.dirname, '..', '..', '..');
  const shared = [
    'packages/ui/src/button/Button.module.css',
    'packages/ui/src/field/Field.module.css',
    ...['pill-tabs', 'popover', 'toast', 'alert-slot', 'page-head', 'empty-state', 'inbox', 'editor'].map(
      (name) => `apps/web/app/app/_ui/${name}.module.css`,
    ),
    'apps/web/app/app/panel.module.css',
    'apps/web/app/auth.module.css',
    'apps/web/app/_auth/scene.module.css',
  ];

  function walk(dir: string, keep: (name: string) => boolean): string[] {
    return readdirSync(join(repo, dir)).flatMap((entry) => {
      const path = `${dir}/${entry}`;
      if (statSync(join(repo, path)).isDirectory()) return walk(path, keep);
      return keep(entry) ? [path] : [];
    });
  }

  /** The rule a declaration sits in, comments dropped and whitespace folded: `.planBar i`. */
  function selectorAt(css: string, at: number): string {
    const open = css.lastIndexOf('{', at);
    const start = Math.max(css.lastIndexOf('}', open - 1), css.lastIndexOf('{', open - 1), css.lastIndexOf(';', open - 1));
    return css.slice(start + 1, open).replace(/\s+/g, ' ').trim();
  }

  /*
   * Brand marks keep the brand's blue: they are Curios itself, not an action. Each is named by file
   * and selector, so a new biru fill has to be argued for here, not slipped in.
   */
  const brandMarks = [
    // Peek's face on Help's answers: two eyes on a biru disc.
    'apps/web/app/app/help/help.module.css: .mark',
  ];

  it('paints primary actions with --action, not --biru, in the app and auth', () => {
    const files = [
      ...new Set([
        ...shared,
        ...walk('apps/web/app/app', (name) => name.endsWith('.module.css')),
        ...walk('apps/web/app/_auth', (name) => name.endsWith('.css')),
      ]),
    ];
    expect(files.length).toBeGreaterThan(30);
    const found = files.flatMap((file) => {
      const css = readFileSync(join(repo, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
      return [...css.matchAll(/background:\s*var\(--biru\)/g)].map((m) => `${file}: ${selectorAt(css, m.index)}`);
    });
    expect(found.filter((at) => !brandMarks.includes(at))).toEqual([]);
    // Every allowed mark still exists: a stale entry would let the next biru fill through unseen.
    for (const mark of brandMarks) expect(found).toContain(mark);
  });

  it('keeps the shared pieces on the calm corner rule', () => {
    const offenders = shared.flatMap((file) =>
      findOffRuleRadii(readFileSync(join(repo, file), 'utf8')).map((radius) => `${file}: ${radius}`),
    );
    expect(offenders).toEqual([]);
  });
});
