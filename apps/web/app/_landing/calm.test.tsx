import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { findHexLiterals, findOffRuleRadii, findOffScaleFontSizes } from '../../../../packages/ui/src/design-rules.js';
import { LandingPage } from './LandingPage.js';
import { RevealWatcher } from './Reveal.js';
import { play } from './scene.js';
import { TERMS, read, reduceMotion, rule } from './test-kit.js';

/** Every calm landing stylesheet, relative to this folder. Each section task appends its own. */
const CALM_MODULES = ['calm.module.css', 'nav.module.css', 'footer.module.css', 'hero.module.css', 'page-card.module.css', 'claim.module.css', 'ask.module.css', 'who.module.css', 'how.module.css', 'lands.module.css', 'nocut.module.css', 'pricing.module.css', 'faq.module.css', 'closing.module.css'];

const CL_TOKENS = [
  'text-2', 'text-3', 'faint', 'hint', 'placeholder', 'ghost', 'ring-hover', 'dot', 'hl-green', 'hl-green-ink', 'hl-rose', 'hl-rose-ink',
  'art-blue', 'art-peach', 'art-mint', 'mark', 'mark-ink', 'fact-next', 'amber-ink', 'paid-wash', 'mint-on-ink', 'hot', 'hot-ink', 'miss',
  'sys', 'sent', 'zone-key', 'zone-empty', 'receipt-rule', 'mock-line', 'mock-soft', 'mock-hair', 'mock-ring', 'mock-radio', 'mock-text-2',
  'ig-a', 'ig-b', 'ig-ring', 'ig-ink',
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`word-${n}`, `word-${n}-ink`]),
].map((n) => `--cl-${n}`);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the calm page scope', () => {
  it('maps the calm values onto the base tokens on the landing root', () => {
    const page = rule(read('calm.module.css'), '.page');
    for (const [k, v] of [
      ['--paper', '--calm-bg'],
      ['--ink', '--calm-ink'],
      ['--line', '--calm-line'],
      ['--action', '--calm-ink'],
      ['--action-fg', '--calm-surface'],
    ])
      expect(page).toMatch(new RegExp(`${k}:\\s*var\\(${v}\\)`));
    expect(page).toMatch(/font-family:\s*var\(--font-inter\)/);
  });

  it('defines every calm landing token once', () => {
    const tokens = readFileSync(join(import.meta.dirname, '../../../../packages/ui/src/tokens.css'), 'utf8');
    for (const name of CL_TOKENS) {
      const count = tokens.match(new RegExp(`^\\s*${name}:`, 'gm'))?.length ?? 0;
      expect(count, name).toBe(1);
    }
  });

  it('keeps every calm landing module on the corner rule, the type scale, and hex-free', () => {
    for (const f of CALM_MODULES) {
      const css = read(f);
      expect(findOffRuleRadii(css), f).toEqual([]);
      expect(findOffScaleFontSizes(css), f).toEqual([]);
      expect(findHexLiterals(css), f).toEqual([]);
    }
  });

  it('runs every looping animation only for visitors who have not asked for less motion', () => {
    for (const f of CALM_MODULES)
      expect(read(f).replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, ''), f).not.toMatch(/animation:[^;]*infinite/);
  });

  it('never styles a bare attribute selector, which next dev rejects as impure', () => {
    for (const f of CALM_MODULES) {
      const selectors = [...read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^{]*\{/g, '{').matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1]!.split(/,(?![^(]*\))/));
      for (const s of selectors.map((x) => x.trim()).filter((x) => x && !/^(from|to|\d+%)/.test(x))) expect(s, `${f}: ${s}`).toMatch(/\./);
    }
  });
});

describe('the reveal', () => {
  it('draws everything on the server, nothing held for a reveal', () => {
    const html = renderToString(<LandingPage locale="en" terms={TERMS} />);
    expect(html).not.toContain('data-rv="wait"');
  });

  function page() {
    return render(
      <div data-landing>
        <p data-rv="" data-testid="above">
          above
        </p>
        <p data-rv="" data-testid="below">
          below
        </p>
        <RevealWatcher />
      </div>,
    );
  }

  it('holds below-the-fold blocks for their reveal, and shows them in view', () => {
    const watchers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          watchers.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.dataset.testid === 'below' ? window.innerHeight + 200 : 10;
      return { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top, toJSON() {} };
    });
    const { getByTestId } = page();
    expect(getByTestId('above')).toHaveAttribute('data-rv', '');
    expect(getByTestId('below')).toHaveAttribute('data-rv', 'wait');
    act(() => watchers.forEach((w) => w([{ target: getByTestId('below'), isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)));
    expect(getByTestId('below')).toHaveAttribute('data-rv', 'in');
  });

  it('reveals nothing when the visitor asks for less motion', () => {
    reduceMotion();
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000, bottom: 5020 } as DOMRect);
    const { container } = page();
    expect(container.querySelector('[data-rv="wait"]')).toBeNull();
  });
});

describe('the scene runner', () => {
  it('a stopped scene runs nothing after its pending wait', async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const stop = play(async (wait) => {
      seen.push(1);
      await wait(100);
      seen.push(2);
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(seen).toEqual([1, 2, 1]);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1, 2, 1]);
  });
});

describe('contrast', () => {
  it('draws text people read, and everything they click, in --calm-muted or darker, never --cl-faint', () => {
    const readable: [string, string][] = [
      ['calm.module.css', '.lbl'],
      ['footer.module.css', '.note'],
      ['footer.module.css', '.legal'],
      ['who.module.css', '.sw button'],
      ['pricing.module.css', '.k0'],
      ['nocut.module.css', '.incl small'],
      ['lands.module.css', '.lsteps span'],
    ];
    for (const [file, selector] of readable) {
      const decls = rule(read(file), selector);
      expect(decls, `${file} ${selector}`).toMatch(/color:/);
      expect(decls, `${file} ${selector}`).not.toMatch(/--cl-faint/);
    }
  });
});
