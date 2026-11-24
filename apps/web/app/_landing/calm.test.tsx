import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useRef } from 'react';
import { findHexLiterals, findOffRuleRadii, findOffScaleFontSizes } from '../../../../packages/ui/src/design-rules.js';
import { LandingPage } from './LandingPage.js';
import { RevealWatcher } from './Reveal.js';
import { play, useScene, type Scene } from './scene.js';
import { TERMS, advance, read, reduceMotion, rule, watchViews } from './test-kit.js';
import calm from './calm.module.css';

/** Every calm landing stylesheet, relative to this folder. Each section task appends its own. */
const CALM_MODULES = ['calm.module.css', 'nav.module.css', 'footer.module.css', 'hero.module.css', 'page-card.module.css', 'claim.module.css', 'ask.module.css', 'who.module.css', 'how.module.css', 'lands.module.css', 'nocut.module.css', 'pricing.module.css', 'faq.module.css', 'closing.module.css'];

const CL_TOKENS = [
  'text-2', 'text-3', 'placeholder', 'ghost', 'ring-hover', 'dot', 'hl-green', 'hl-green-ink', 'hl-rose', 'hl-rose-ink',
  'art-blue', 'art-peach', 'art-mint', 'mark', 'mark-ink', 'fact-next', 'amber-ink', 'fee-ink', 'paid-wash', 'mint-on-ink', 'hot', 'hot-ink', 'miss',
  'sys', 'sent', 'zone-empty', 'receipt-rule', 'mock-line', 'mock-soft', 'mock-hair', 'mock-ring', 'mock-radio', 'mock-text-2',
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
      ['--action', '--calm-action'],
      ['--action-fg', '--calm-action-fg'],
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

  it('hides a held block only under `.js`, so a page whose scripts never ran shows every section', () => {
    const css = read('calm.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const hiding = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel, body]) => /\.rv\b/.test(sel!) && /opacity:\s*0\b/.test(body!));
    expect(hiding.length).toBeGreaterThan(0);
    for (const [, sel] of hiding) expect(sel!.trim()).toMatch(/^:global\(\.js\) \.rv\b/);
    expect(rule(read('calm.module.css'), '.rv')).not.toMatch(/(?<![-\w])(opacity|transform):/);
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

  /** Counts up every 100ms from 0; its still frame is -1. */
  const counter: Scene<number, null> = {
    still: () => -1,
    start: () => 0,
    async run(_p, set, wait) {
      await wait(100);
      set((n) => n + 1);
    },
  };
  function Counter() {
    const ref = useRef<HTMLDivElement>(null);
    const n = useScene(counter, null, ref);
    return <div ref={ref} data-n={n} />;
  }
  const shown = (c: HTMLElement) => c.querySelector('[data-n]')!.getAttribute('data-n');

  it('stops a scene that leaves the view and resets it to its start', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { container } = render(<Counter />);
    view.show(true);
    await advance(350);
    expect(shown(container)).toBe('3');
    view.show(false);
    expect(shown(container)).toBe('0');
    expect(vi.getTimerCount()).toBe(0);
    await advance(1000);
    expect(shown(container)).toBe('0');
  });

  it('pauses a scene while the tab is hidden', async () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    try {
      const view = watchViews();
      const { container } = render(<Counter />);
      view.show(true);
      await advance(250);
      expect(shown(container)).toBe('2');
      hidden = true;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(vi.getTimerCount()).toBe(0);
      await advance(1000);
      expect(shown(container)).toBe('0');
      hidden = false;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await advance(100);
      expect(shown(container)).toBe('1');
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it('leaves no timer once unmounted', async () => {
    vi.useFakeTimers();
    const view = watchViews();
    const { unmount } = render(<Counter />);
    view.show(true);
    await advance(150);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('contrast', () => {
  const tokens = readFileSync(join(import.meta.dirname, '../../../../packages/ui/src/tokens.css'), 'utf8');
  const hex = (name: string) => tokens.match(new RegExp(`^\\s*${name}:\\s*(#[0-9a-f]{6});`, 'm'))![1]!;
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x! + 0.05) / (y! + 0.05);
  };

  it('draws text people read, and everything they click, in --calm-muted or darker', () => {
    // The 19 Nov review: labels, small print, handles and receipt lines all pass AA. None is left in the old faint greys.
    const readable: [string, string][] = [
      ['calm.module.css', '.lbl'],
      ['calm.module.css', '.fine'],
      ['claim.module.css', '.cin > span'],
      ['footer.module.css', '.note'],
      ['footer.module.css', '.legal'],
      ['who.module.css', '.sw button'],
      ['who.module.css', '.ask em'],
      ['who.module.css', '.fa small'],
      ['who.module.css', '.fa p > span'],
      ['who.module.css', '.fb em'],
      ['how.module.css', '.paste small'],
      ['how.module.css', '.fact small'],
      ['pricing.module.css', '.k0'],
      ['nocut.module.css', '.incl small'],
      ['nocut.module.css', '.sm'],
      ['lands.module.css', '.lsteps span'],
      ['lands.module.css', '.lzk'],
      ['lands.module.css', '.kv small'],
    ];
    for (const [file, selector] of readable) {
      const decls = rule(read(file), selector);
      expect(decls, `${file} ${selector}`).toMatch(/(?<![-\w])color:\s*var\(--calm-(muted|ink)\)/);
    }
    for (const bg of ['--calm-bg', '--calm-surface']) expect(ratio(hex('--calm-muted'), hex(bg)), bg).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the coloured inks at 4.5:1 and the ask strip’s large unlit words at 3:1', () => {
    expect(rule(read('nocut.module.css'), '.rf b')).toMatch(/color:\s*var\(--cl-fee-ink\)/);
    expect(ratio(hex('--cl-fee-ink'), hex('--calm-surface'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex('--cl-hot-ink'), hex('--cl-hot'))).toBeGreaterThanOrEqual(4.5);
    expect(rule(read('ask.module.css'), '.w')).toMatch(/color:\s*var\(--cl-ghost\)/);
    expect(ratio(hex('--cl-ghost'), hex('--calm-bg'))).toBeGreaterThanOrEqual(3);
  });

  it('keeps the marketplace receipt at full strength: no dim', () => {
    expect(read('nocut.module.css')).not.toMatch(/data-dim/);
  });
});

/** The declarations of `selector` inside the first `@media (max-width: <px>px)` block of `css`. */
function phoneRule(css: string, px: number, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = clean.indexOf(`@media (max-width: ${px}px) {`);
  if (at < 0) return '';
  let depth = 0;
  let end = at;
  for (let i = clean.indexOf('{', at); i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    if (clean[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = clean.slice(clean.indexOf('{', at) + 1, end);
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').map((s) => s.trim()).includes(selector)) return m[2]!;
  }
  return '';
}

describe('a phone (19 Nov review)', () => {
  it('makes every tap target at least 44px: the logos, the nav button, the footer links, the toggles and the slider', () => {
    const targets: [string, string, RegExp][] = [
      ['nav.module.css', '.brand', /min-height:\s*44px/],
      ['nav.module.css', '.quiet', /min-height:\s*44px/],
      ['nav.module.css', '.right .cta', /min-height:\s*44px/],
      ['footer.module.css', '.brand', /min-height:\s*44px/],
      ['footer.module.css', '.links a', /min-height:\s*44px/],
      ['footer.module.css', '.legalLinks a', /min-height:\s*44px/],
      ['footer.module.css', '.co a', /min-height:\s*44px/],
      ['who.module.css', '.sw button', /min-height:\s*44px/],
      ['lands.module.css', '.tog button', /min-height:\s*44px/],
      ['pricing.module.css', '.tog button', /min-height:\s*44px/],
      ['pricing.module.css', '.seg button', /min-height:\s*44px/],
      ['pricing.module.css', '.rng', /(?<![-\w])height:\s*44px/],
    ];
    for (const [file, selector, decl] of targets) expect(phoneRule(read(file), 760, selector), `${file} ${selector}`).toMatch(decl);
    // The 44px block must not undo the hiding of the language and sign-in links on a narrow phone.
    const nav = read('nav.module.css');
    expect(nav.indexOf('@media (max-width: 760px)')).toBeLessThan(nav.indexOf('@media (max-width: 560px)'));
    expect(phoneRule(nav, 560, '.quiet')).toMatch(/display:\s*none/);
    // The slider's box grows, its drawn track stays 6px.
    expect(phoneRule(read('pricing.module.css'), 760, '.rng')).toMatch(/\/ 100% 6px/);
  });

  it('keeps Who’s send button at the end of the ask field once "asking 5 pages" is hidden', () => {
    const css = read('who.module.css');
    expect(phoneRule(css, 700, '.ask em')).toMatch(/display:\s*none/);
    expect(phoneRule(css, 700, '.ask i')).toMatch(/margin-left:\s*auto/);
  });

  it('shows the hero’s side pages as colour only, so their names never overlap the front page', () => {
    const css = read('page-card.module.css');
    for (const s of ["-1'] .body", "1'] .body", "-1'] .kind", "1'] .kind"]) expect(phoneRule(css, 640, `.pc[data-s='${s}`), s).toMatch(/visibility:\s*hidden/);
  });

  it('lets the chat’s message list shrink, so messages never slide under the chat header', () => {
    expect(rule(read('lands.module.css'), '.lcm')).toMatch(/min-height:\s*0;/);
  });
});

describe('section ends (19 Nov review)', () => {
  it.each(['en', 'ms'] as const)('%s: Who it’s for, How it works and For business end with room before the next colour', (locale) => {
    const { container } = render(<LandingPage locale={locale} terms={TERMS} />);
    for (const id of ['who', 'how', 'business']) expect(container.querySelector(`#${id}`)!.className, id).toContain(calm.secEnd);
    expect(rule(read('calm.module.css'), '.secEnd')).toMatch(/padding-bottom:\s*88px/);
    expect(phoneRule(read('calm.module.css'), 640, '.secEnd')).toMatch(/padding-bottom:\s*64px/);
  });
});
