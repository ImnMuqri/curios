import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxBack } from './inbox-back.js';

const css = readFileSync(path.resolve(__dirname, './inbox.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration block whose selector list names the class, as `selector { body }`. */
function rules(cls: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => new RegExp(`\\.${cls}(?![\\w-])`).test(m[1]!))
    .map((m) => `${m[1]!.trim()} {${m[2]}}`);
}

describe('the inbox kit stylesheet', () => {
  it('outlines the list with a border, never an inset shadow', () => {
    const list = rules('list').filter((r) => r.startsWith('.split > .list {'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/border: 1px solid var\(--edge\);/);
    expect(list[0]).toMatch(/border-radius: var\(--r-box\);/);
    expect(list[0]).toMatch(/overflow: hidden;/);
    expect(list[0]).not.toMatch(/box-shadow/);
  });

  it('gives rows no left border or accent bar', () => {
    const li = rules('li');
    expect(li.length).toBeGreaterThan(3);
    for (const rule of li) {
      expect(rule).not.toMatch(/border-left|inset \d+px 0 0/);
    }
    expect(li.join('\n')).toMatch(/\.li \{[^}]*min-height: 64px;[^}]*padding: 16px 20px;[^}]*border-top: 1px solid var\(--line\);/);
    expect(li.join('\n')).toMatch(/\.li:first-child \{\s*border-top: 0;/);
    expect(li.join('\n')).toMatch(/\.li\[aria-current='true'\] \{\s*background: var\(--calm-pick\);/);
    expect(li.join('\n')).toMatch(/\.li:not\(\[aria-current='true'\]\):hover \{\s*background: var\(--calm-row-hover\);/);
    expect(li.join('\n')).toMatch(/\.li\[aria-current='true'\] \.liText b \{\s*font-weight: 700;/);
  });

  it('keeps the board values for the filter bar, the split and the detail', () => {
    expect(css).toMatch(/\.fbar \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*gap: 12px;/);
    expect(css).toMatch(/\.chip \{[^}]*height: 40px;[^}]*padding: 0 15px;[^}]*font-size: 14px;[^}]*font-weight: 500;/);
    expect(css).toMatch(/\.chip\[aria-pressed='true'\],\s*\.chip\[aria-current='true'\] \{\s*background: var\(--select\);/);
    expect(css).toMatch(/\.search \{[^}]*height: 40px;[^}]*border-radius: var\(--field-radius\);/);
    expect(css).toMatch(/\.split \{[^}]*grid-template-columns: minmax\(0, 1fr\) 420px;[^}]*align-items: start;[^}]*gap: 20px;[^}]*margin-top: 16px;/);
    expect(css).toMatch(/\.det \{[^}]*padding: 24px;/);
    expect(css).toMatch(/@media \(min-width: 1101px\) \{\s*\.split > \.det \{\s*position: sticky;\s*top: 24px;/);
    expect(css).toMatch(/\.av \{[^}]*width: 40px;[^}]*height: 40px;[^}]*border-radius: 50%;[^}]*font-size: 15px;[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.tag \{[^}]*height: 24px;[^}]*border-radius: var\(--r-pill\);[^}]*font-size: 12px;[^}]*font-weight: 600;/);
    expect(css).toMatch(/\.tag::before \{[^}]*width: 6px;[^}]*height: 6px;[^}]*background: currentColor;/);
  });

  it('keeps the 24px under the summary in the header, so the loading bar and a banner sit clear of it', () => {
    // NavProgress sits 8px up from the header's bottom: with no foot it drew across the summary.
    expect(css).toMatch(/\.screen > header \{\s*padding-bottom: 24px;/);
    expect(css).toMatch(/\.screen \{\s*--strip-top: 0px;/);
    expect(css).toMatch(/\.emptyPeek \{[^}]*margin: 36px auto 0;/);
  });

  it('gives a picked item the phone to itself under 1100px, and 44px chips under 760px', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 1100px) {\n  .split {'));
    expect(phone).toMatch(/\.split > \.det \{\s*display: none;/);
    expect(phone).toMatch(/\.split\[data-open\] > \.det \{\s*display: block;/);
    expect(phone).toMatch(/\.split\[data-open\] > \.list \{\s*display: none;/);
    expect(phone).toMatch(/\.screen:has\(\.split\[data-open\]\) header \[data-head-part\]/);
    // Overlays a page renders inside the screen survive the own-view.
    expect(phone).toMatch(/\.body:has\(> \.split\[data-open\]\) > :not\(\.split\):not\(dialog\):not\(\[role='dialog'\]\):not\(\[data-keep\]\)/);
    expect(phone).toMatch(/\.screen:has\(\.split\[data-open\]\) > :not\(header\):not\(\.body\):not\(dialog\):not\(\[role='dialog'\]\):not\(\[data-keep\]\)/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.chip \{\s*height: 44px;/);
  });

  it('keeps the shared pager and search, and no longer carries the pre-kit two-column frame', () => {
    for (const cls of ['pager', 'pages', 'search']) {
      expect(rules(cls).length, cls).toBeGreaterThan(0);
    }
    for (const cls of ['board', 'detail', 'detailInner', 'filters', 'filter', 'count', 'rows', 'row', 'listEmpty', 'listNote', 'title', 'section', 'chat']) {
      expect(rules(cls).length, cls).toBe(0);
    }
  });
});

describe('InboxBack', () => {
  it('says "All {noun}" and calls back', async () => {
    const onBack = vi.fn();
    render(<InboxBack noun="orders" onBack={onBack} />);
    const back = screen.getByRole('button', { name: 'All orders' });
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
