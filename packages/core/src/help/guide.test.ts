import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script with no types; only its pure `generated` is used.
import { generated } from '../../scripts/gen-help-guide.mjs';
import { HELP_GUIDE_MARKDOWN } from './guide.generated.js';
import {
  fillPlaceholders,
  GUIDE_PLACEHOLDERS,
  HELP_SCREENS,
  HELP_SUGGESTIONS,
  helpScreenFor,
  parseGuide,
  publicGuide,
  searchGuide,
} from './guide.js';
import { helpGuide } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const faq = readFileSync(join(here, 'faq.md'), 'utf8');
const terms = { prices: { MONTHLY: 4900, ANNUAL: 49000 }, freeLeads: 3, freeOrders: 3, cap: 200 };

describe('the help guide file', () => {
  it('is what guide.generated.ts holds (run `pnpm --filter @curios/core gen:help` after editing faq.md)', () => {
    expect(readFileSync(join(here, 'guide.generated.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe(generated(faq));
    expect(HELP_GUIDE_MARKDOWN).toBe(faq.replace(/\r\n/g, '\n'));
  });

  it('parses, with one entry per ### heading and no id twice', () => {
    const guide = helpGuide();
    expect(guide.entries.length).toBe((faq.match(/^### /gm) ?? []).length);
    expect(new Set(guide.entries.map((e) => e.id)).size).toBe(guide.entries.length);
    for (const e of guide.entries) {
      expect(e.answer.length, e.id).toBeGreaterThan(20);
      expect(e.source, e.id).not.toBe('');
    }
  });

  it('points every Open: at a real dashboard screen, and every tab at a tab that screen has', () => {
    const tabsOf: Record<string, string> = {
      knowledge: /KNOWLEDGE_TABS = \[([^\]]+)\]/.exec(readFileSync(join(repo, 'apps/web/app/app/knowledge/tabs.tsx'), 'utf8'))![1]!,
      store: /TAB_NAMES = \[([^\]]+)\]/.exec(readFileSync(join(repo, 'apps/web/app/app/store/page.tsx'), 'utf8'))![1]!,
    };
    for (const e of helpGuide().entries) {
      if (!e.open) continue;
      const url = new URL(e.open, 'https://curios.my');
      const segment = /^\/app\/([^/]+)$/.exec(url.pathname)?.[1];
      expect(segment, `${e.id}: ${e.open}`).toBeDefined();
      expect(existsSync(join(repo, 'apps/web/app/app', segment!, 'page.tsx')), `${e.id}: ${e.open}`).toBe(true);
      const tab = url.searchParams.get('tab');
      if (tab) {
        expect(Object.keys(tabsOf), `${e.id}: only Knowledge's and Store's tabs are known`).toContain(segment);
        expect(tabsOf[segment!], `${e.id}: ${tab}`).toContain(`'${tab}'`);
      }
    }
  });

  it('uses only placeholders that fill', () => {
    for (const e of helpGuide().entries) {
      for (const [, key] of e.answer.matchAll(/\{(\w+)\}/g)) expect(GUIDE_PLACEHOLDERS, e.id).toContain(key);
      expect(fillPlaceholders(e.answer, terms), e.id).not.toMatch(/[{}]/);
    }
  });

  it('suggests four real entries on every screen', () => {
    const ids = new Set(helpGuide().entries.map((e) => e.id));
    for (const screen of HELP_SCREENS) for (const id of HELP_SUGGESTIONS[screen]) expect(ids.has(id), `${screen}: ${id}`).toBe(true);
  });
});

describe('parseGuide', () => {
  const sample = `# Title\n\nIntro.\n\n---\n\n## One\n\n### a-b · Question one?\nFirst line.\nSecond line.\nOpen: /app/store\nSource: x.ts\n\n### c · Two?\nAnswer.\nOpen: none\nSource: y\n\n---\n\n## Empty\n`;

  it('reads sections, entries, Open and Source, and drops empty sections', () => {
    const guide = parseGuide(sample);
    expect(guide.sections.map((s) => s.title)).toEqual(['One']);
    expect(guide.entries).toEqual([
      { id: 'a-b', question: 'Question one?', answer: 'First line. Second line.', open: '/app/store', source: 'x.ts', section: 'One' },
      { id: 'c', question: 'Two?', answer: 'Answer.', open: null, source: 'y', section: 'One' },
    ]);
  });

  it('refuses an entry with no Open line, a bad heading, or an id used twice', () => {
    expect(() => parseGuide('## S\n### a · Q\nA\nSource: x\n')).toThrow(/no Open/);
    expect(() => parseGuide('## S\n### Not an id · Q\nA\nOpen: none\nSource: x\n')).toThrow(/line 2/);
    expect(() => parseGuide('## S\n### a · Q\nA\nOpen: none\nSource: x\n### a · Q\nA\nOpen: none\nSource: x\n')).toThrow(/twice/);
  });
});

describe('fillPlaceholders', () => {
  it('writes the live prices and limits', () => {
    expect(fillPlaceholders('{monthlyPrice} a month, or {annualPrice} a year ({annualSaving}). {freeLeads} leads, {freeOrders} orders, {conversationCap} chats.', terms)).toBe(
      'RM49 a month, or RM490 a year (two months free). 3 leads, 3 orders, 200 chats.',
    );
  });

  it('says what a year saves when it is not ten months, and drops the brackets when it saves nothing', () => {
    expect(fillPlaceholders('{annualPrice} a year ({annualSaving}).', { ...terms, prices: { MONTHLY: 5900, ANNUAL: 59900 } })).toBe(
      'RM599 a year (RM109 less than paying monthly).',
    );
    expect(fillPlaceholders('{annualPrice} a year ({annualSaving}).', { ...terms, prices: { MONTHLY: 4900, ANNUAL: 58800 } })).toBe('RM588 a year.');
  });

  it('leaves an unknown brace alone', () => {
    expect(fillPlaceholders('{nope}', terms)).toBe('{nope}');
  });
});

describe('publicGuide', () => {
  it('carries no Source line', () => {
    const sections = publicGuide(helpGuide(), terms);
    expect(JSON.stringify(sections)).not.toMatch(/"source"/);
    expect(sections.flatMap((s) => s.entries)).toHaveLength(helpGuide().entries.length);
  });
});

describe('helpScreenFor', () => {
  it('names the screen from the path, home for anything else', () => {
    expect(helpScreenFor('/app/store')).toBe('store');
    expect(helpScreenFor('/app/knowledge?tab=sources')).toBe('knowledge');
    expect(helpScreenFor('/app/orders/abc')).toBe('orders');
    expect(helpScreenFor('/app')).toBe('home');
    expect(helpScreenFor('/app/onboarding')).toBe('home');
  });
});

describe('searchGuide', () => {
  const sections = publicGuide(helpGuide(), terms);

  it('finds entries with every word, in the question or the answer', () => {
    expect(searchGuide(sections, 'voucher discount').map((e) => e.id)).toContain('shop-vouchers');
    expect(searchGuide(sections, 'dark mode').map((e) => e.id)).toEqual(['acc-dark']);
  });

  it('finds nothing for an empty or one-letter query', () => {
    expect(searchGuide(sections, '  ')).toEqual([]);
    expect(searchGuide(sections, 'a')).toEqual([]);
  });
});
