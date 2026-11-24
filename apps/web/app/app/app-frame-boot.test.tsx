import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const at = vi.hoisted(() => ({ pathname: '/app/curios' }));
vi.mock('next/navigation', () => ({ usePathname: () => at.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../lib/api.js', () => ({ apiFetch: vi.fn(async () => ({ sections: [], chat: true })), ApiError: class extends Error {} }));
const { AppFrame, BOOT_CAP_MS, BOOT_FADE_MS } = await import('./app-frame.js');

const PLAN = { name: 'Business plan', note: '18 days left', fill: 0.6, glance: 'Business' };
const css = readFileSync(path.join(__dirname, 'app-frame.module.css'), 'utf8');

const tree = (children = <p>content</p>) => (
  <AppFrame displayName="Iman Muqri" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="PERSONAL">
    {children}
  </AppFrame>
);
const loader = () => document.querySelector('[data-curios-loader]');
const frameEl = () => document.querySelector('[data-laptop-scale]') as HTMLElement;

let fontsReady: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  at.pathname = '/app/curios';
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: new Promise<void>((resolve) => (fontsReady = resolve)) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the boot overlay', () => {
  it('is in the server HTML, so the first paint has it', () => {
    const html = renderToString(tree());
    expect(html).toContain('data-curios-loader');
    expect(html).toContain('Getting your page ready');
    expect(html).toContain('aria-busy="true"');
  });

  it('marks the frame busy while it shows, then fades and is removed once fonts are ready', async () => {
    render(tree());
    expect(loader()).not.toBeNull();
    expect(frameEl()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fontsReady();
      await Promise.resolve();
    });
    // Fading: still there for the fade, no longer blocking the pointer.
    expect(loader()?.className).toMatch(/bootLeaving/);
    await act(async () => void (await vi.advanceTimersByTimeAsync(BOOT_FADE_MS)));
    expect(loader()).toBeNull();
    expect(frameEl()).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('content')).toBeVisible();
  });

  it('never waits past the cap when fonts are slow', async () => {
    render(tree());
    await act(async () => void (await vi.advanceTimersByTimeAsync(BOOT_CAP_MS + BOOT_FADE_MS)));
    expect(loader()).toBeNull();
  });

  it('is removed at once when the frame mounts fresh long after the load began (router.push from sign-in)', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(BOOT_CAP_MS + 5000);
    render(tree());
    expect(loader()).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(loader()?.className).toMatch(/bootLeaving/);
    await act(async () => void (await vi.advanceTimersByTimeAsync(BOOT_FADE_MS)));
    expect(loader()).toBeNull();
    vi.restoreAllMocks();
  });

  it('is not drawn again on a client navigation', async () => {
    const view = render(tree());
    await act(async () => {
      fontsReady();
      await vi.advanceTimersByTimeAsync(BOOT_FADE_MS + 1);
    });
    expect(loader()).toBeNull();
    at.pathname = '/app/review';
    view.rerender(tree(<p>review</p>));
    expect(loader()).toBeNull();
    expect(screen.getByText('review')).toBeInTheDocument();
  });

  it('shows after 150ms in CSS, fades out, and takes the frame dark values', () => {
    const loaderCss = readFileSync(path.join(__dirname, '..', '_ui', 'curios-loader.module.css'), 'utf8');
    expect(loaderCss).toMatch(/animation: loaderIn 200ms ease-out 150ms forwards/);
    expect(css).toMatch(/\.boot\.bootLeaving \{[^}]*bootOut 200ms ease-out forwards/s);
    expect(css).toMatch(/\.frame\[data-theme='dark'\] \.boot \{[^}]*--loader-bg: var\(--calm-dark-bg\)/s);
    expect(css).toMatch(/prefers-color-scheme: dark\) \{\s*\.frame:not\(\[data-theme='light'\]\) \.boot/);
  });

  it('ends itself in CSS by 2.5s, hidden and out of the pointer way, even with reduced motion', () => {
    expect(css).toMatch(/\.frame \.boot \{[^}]*animation:[^}]*bootFailsafe 300ms ease-out 2500ms forwards/s);
    expect(css).toMatch(/@keyframes bootFailsafe \{\s*to \{[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none/s);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('@keyframes bootFailsafe')));
    expect(reduced).toMatch(/\.frame \.boot \{\s*animation:[^}]*bootFailsafe 1ms linear 2500ms forwards/s);
  });

  it('keeps bootShow in the leaving animation list, catches no tap until showing, and has a reduced-motion pair', () => {
    expect(css).toMatch(/\.boot\.bootLeaving \{[^}]*animation:\s*bootShow 200ms ease-out 150ms forwards,\s*bootOut 200ms ease-out forwards/s);
    expect(css).toMatch(/\.frame \.boot \{\s*\/\*[^*]*\*\/\s*pointer-events: none;/s);
    expect(css).toMatch(/@keyframes bootShow \{\s*to \{[^}]*pointer-events: auto/s);
    expect(css).toMatch(/\.frame \.boot\.bootLeaving \{\s*animation:\s*bootShow 1ms linear 150ms forwards,\s*bootOut 1ms linear forwards/s);
  });

  it('keeps the layers host the last child of the frame', () => {
    render(tree());
    const last = frameEl().lastElementChild as HTMLElement;
    expect(last.className).toMatch(/layers/);
  });
});
