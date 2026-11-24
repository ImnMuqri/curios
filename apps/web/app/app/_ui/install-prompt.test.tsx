import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DISMISSED_AT_KEY, DISMISS_MS, FIRST_VISIT_WAIT_MS, INSTALLED_KEY, InstallPrompt, VISITS_KEY } from './install-prompt.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.20.113';
const IPHONE_FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108;]';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

function setup({ ua = ANDROID, touch = true, installed = false }: { ua?: string; touch?: boolean; installed?: boolean } = {}) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse') ? touch : query.includes('display-mode: standalone') ? installed : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
}

/** Chrome's install event: prompt() and the answer. */
function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  return event;
}
const fire = (event: Event) =>
  act(async () => {
    window.dispatchEvent(event);
  });
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const asked = () => screen.queryByText('Put Curios on your phone');

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('InstallPrompt on Android', () => {
  it('shows on the second visit with Install, which opens the browser prompt, then hides', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    const event = installEvent();
    await fire(event);
    expect(event.defaultPrevented).toBe(true);
    expect(asked()).toBeInTheDocument();
    expect(screen.getByText('Open it from your home screen, like an app.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await tick(0);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(asked()).toBeNull();
    expect(window.localStorage.getItem(INSTALLED_KEY)).toBe('1');
  });

  it('hides on appinstalled and remembers', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    await fire(installEvent());
    expect(asked()).toBeInTheDocument();
    await fire(new Event('appinstalled'));
    expect(asked()).toBeNull();
    expect(window.localStorage.getItem(INSTALLED_KEY)).toBe('1');
  });

  it('shows nothing without the browser event (Firefox on Android)', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    await tick(FIRST_VISIT_WAIT_MS * 2);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps a declined native prompt away for 30 days', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    await fire(installEvent('dismissed'));
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await tick(0);
    expect(window.localStorage.getItem(DISMISSED_AT_KEY)).not.toBeNull();
    expect(asked()).toBeNull();
  });
});

describe('InstallPrompt on iPhone and iPad', () => {
  it('shows the Share hint with a dismiss and no Install button', async () => {
    setup({ ua: IPHONE });
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    await tick(0);
    expect(screen.getByText('Put Curios on your Home Screen')).toBeInTheDocument();
    expect(screen.getByText(/Tap Share/)).toHaveTextContent('Tap Share, then Add to Home Screen.');
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it.each([['Instagram', IPHONE_INSTAGRAM], ['Facebook', IPHONE_FACEBOOK]])('leaves the %s in-app browser out', async (_name, ua) => {
    setup({ ua });
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    await tick(0);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('leaves other iOS browsers out', async () => {
    setup({ ua: IPHONE_CHROME });
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    await tick(0);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('InstallPrompt eligibility', () => {
  it('is hidden when Curios is already installed (standalone)', async () => {
    setup({ installed: true });
    window.localStorage.setItem(VISITS_KEY, '5');
    render(<InstallPrompt />);
    await fire(installEvent());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('is hidden when navigator.standalone says so (iOS Home Screen app)', async () => {
    setup({ ua: IPHONE });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    window.localStorage.setItem(VISITS_KEY, '5');
    render(<InstallPrompt />);
    await tick(0);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: undefined });
  });

  it('is hidden on a desktop (a mouse is the pointer)', async () => {
    setup({ ua: DESKTOP, touch: false });
    window.localStorage.setItem(VISITS_KEY, '5');
    render(<InstallPrompt />);
    await fire(installEvent());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows on a tablet too (touch, any width)', async () => {
    setup({ ua: IPHONE });
    window.localStorage.setItem(VISITS_KEY, '5');
    render(<InstallPrompt />);
    await tick(0);
    expect(screen.getByText('Put Curios on your Home Screen')).toBeInTheDocument();
  });

  it('is hidden once installed earlier (remembered)', async () => {
    setup();
    window.localStorage.setItem(INSTALLED_KEY, '1');
    window.localStorage.setItem(VISITS_KEY, '5');
    render(<InstallPrompt />);
    await fire(installEvent());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('InstallPrompt and an early event', () => {
  it('uses the event the root layout script kept before this mounted, and clears it after prompt()', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    const event = installEvent();
    (window as unknown as { __curiosInstall?: unknown }).__curiosInstall = event;
    render(<InstallPrompt />);
    await tick(0);
    expect(asked()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await tick(0);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect((window as unknown as { __curiosInstall?: unknown }).__curiosInstall).toBeNull();
  });
});

describe('InstallPrompt timing', () => {
  it('stays away on the first visit until 30 seconds have passed', async () => {
    setup();
    render(<InstallPrompt />);
    await fire(installEvent());
    expect(window.localStorage.getItem(VISITS_KEY)).toBe('1');
    expect(asked()).toBeNull();
    await tick(FIRST_VISIT_WAIT_MS - 1000);
    expect(asked()).toBeNull();
    await tick(1000);
    expect(asked()).toBeInTheDocument();
  });

  it('counts a visit per full load and shows at once on the second', async () => {
    setup();
    render(<InstallPrompt />).unmount();
    render(<InstallPrompt />);
    expect(window.localStorage.getItem(VISITS_KEY)).toBe('2');
    await fire(installEvent());
    expect(asked()).toBeInTheDocument();
  });

  it('waits behind the new-version card, then appears when it is gone', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    const view = render(<InstallPrompt held />);
    await fire(installEvent());
    expect(asked()).toBeNull();
    view.rerender(<InstallPrompt held={false} />);
    expect(asked()).toBeInTheDocument();
  });

  it('does not break when storage is blocked', async () => {
    setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<InstallPrompt />);
    await fire(installEvent());
    await tick(FIRST_VISIT_WAIT_MS);
    expect(asked()).toBeInTheDocument();
  });
});

describe('InstallPrompt dismissal', () => {
  it('stores the time and hides', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    render(<InstallPrompt />);
    await fire(installEvent());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(asked()).toBeNull();
    expect(Number(window.localStorage.getItem(DISMISSED_AT_KEY))).toBeGreaterThan(0);
  });

  it('stays away for 30 days and comes back after', async () => {
    setup();
    window.localStorage.setItem(VISITS_KEY, '1');
    window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now() - (DISMISS_MS - 60_000)));
    const first = render(<InstallPrompt />);
    await fire(installEvent());
    expect(asked()).toBeNull();
    first.unmount();
    window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now() - DISMISS_MS - 60_000));
    render(<InstallPrompt />);
    await fire(installEvent());
    expect(asked()).toBeInTheDocument();
  });
});

describe('InstallPrompt as a live region', () => {
  it('is a polite status that is in the page before the card', () => {
    setup();
    render(<InstallPrompt />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('shares the new-version card look, which stops its motion under reduced motion', () => {
    const css = readFileSync(path.join(__dirname, 'new-version.module.css'), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.card \{\s*animation: none/);
    const own = readFileSync(path.join(__dirname, 'install-prompt.module.css'), 'utf8');
    expect(own).toMatch(/composes: card from '\.\/new-version\.module\.css'/);
  });
});
