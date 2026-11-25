import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/** The little of PostCSS this needs; it is Next's dependency, not ours, so its types are not here. */
type Plugin = object;
type PostCss = (plugins: Plugin[]) => { process: (css: string, opts: { from: undefined }) => { css: string } };

const require = createRequire(import.meta.url);
// Loaded from beside Next, as the build loads it.
const postcss = createRequire(require.resolve('next/package.json'))('postcss') as PostCss;
const plugin = require('./postcss-squircle.cjs') as () => Plugin;

const run = (css: string) => postcss([plugin()]).process(css, { from: undefined }).css;
const squished = (css: string) => run(css).replace(/\s+/g, ' ').trim();

describe('postcss-squircle', () => {
  it('keeps the plain corner and adds a 1.4x squircle only where squircles are drawn', () => {
    expect(squished('.card { border-radius: 16px; }')).toBe(
      '.card { border-radius: 16px; } @supports (corner-shape: squircle) { .card { corner-shape: squircle; border-radius: 22px; } }',
    );
    expect(squished('.tab { border-radius: 16px 16px 0 0; }')).toContain('border-radius: 22px 22px 0 0');
    expect(squished('.box { border-radius: var(--r-box); }')).toContain('border-radius: calc(var(--r-box) * 1.4)');
  });

  it('keeps pills and circles round, also where an earlier rule made the element a squircle', () => {
    for (const pill of ['999px', '50%', 'var(--r-pill)']) {
      expect(squished(`.p { border-radius: ${pill}; }`)).toContain('{ .p { corner-shape: round; } }');
    }
    expect(run('.z { border-radius: 0; }')).not.toContain('@supports');
  });

  it('lets a radius variable say whether it is a pill or a box, wherever it is set', () => {
    expect(squished('.frame { --field-radius: 10px; }')).toBe('.frame { --field-radius: 10px; --field-radius-shape: squircle; --field-radius-scale: 1.4; }');
    expect(squished('.onboard { --field-radius: var(--r-pill); }')).toContain('--field-radius-shape: round; --field-radius-scale: 1;');
    expect(squished('.in { border-radius: var(--field-radius, 10px); }')).toContain(
      'corner-shape: var(--field-radius-shape, squircle); border-radius: calc(var(--field-radius, 10px) * var(--field-radius-scale, 1.4))',
    );
    // Unset, a pill fallback stays a pill.
    expect(squished('.btn { border-radius: var(--btn-radius, 999px); }')).toContain('corner-shape: var(--btn-radius-shape, round)');
  });

  it('leaves keyframes, elliptic corners and !important alone, and keeps the copy inside its media query', () => {
    expect(run('@keyframes k { to { border-radius: 10px; } }')).not.toContain('@supports');
    expect(run('.e { border-radius: 10px / 20px; }')).not.toContain('@supports');
    expect(run('.i { border-radius: 10px !important; }')).not.toContain('@supports');
    expect(squished('@media (max-width: 600px) { .m { border-radius: 10px; } }')).toBe(
      '@media (max-width: 600px) { .m { border-radius: 10px; } @supports (corner-shape: squircle) { .m { corner-shape: squircle; border-radius: 14px; } } }',
    );
  });
});
