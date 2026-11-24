import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'store.module.css'), 'utf8');
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]()]/g, '\$&')} \{[^}]*\}`))?.[0] ?? '';

describe('store.module.css, after the owner review of 24 Nov 2026', () => {
  it('draws the ready box on one surface, and only a step control washes on hover', () => {
    expect(rule('.ready')).toMatch(/background: var\(--card\)/);
    expect(rule('.step:hover')).toMatch(/background: var\(--calm-row-hover\)/);
    expect(rule('.step:hover')).not.toMatch(/--frame-hover/);
    expect(rule('.step:hover')).not.toMatch(/var\(--card\)/);
  });

  it('packs the item cards: about 176px tracks, two across on phones, still square photos', () => {
    expect(rule('.grid')).toMatch(/repeat\(auto-fill, minmax\(176px, 1fr\)\)/);
    expect(css).toMatch(/@container \(max-width: 480px\) \{\s*\.grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(rule('.cardPhoto')).toMatch(/aspect-ratio: 1 \/ 1/);
    expect(rule('.cardDots')).toMatch(/width: 36px;\s*height: 36px/);
  });

  it('shows the top Add item on phones and hides the grid add-card there', () => {
    expect(rule('.shelf .addTop')).toMatch(/display: none/);
    const phone = css.slice(css.lastIndexOf('@container (max-width: 480px)'));
    expect(phone).toMatch(/\.shelf \.addTop \{\s*display: inline-flex;/);
    expect(phone).toMatch(/\.cardAdd \{\s*display: none;/);
  });
});
