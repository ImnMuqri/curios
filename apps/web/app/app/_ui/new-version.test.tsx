import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DISMISSED_KEY, NewVersion, VERSION_POLL_MS, VERSION_URL } from './new-version.js';

const css = readFileSync(path.join(__dirname, 'new-version.module.css'), 'utf8');
let live = 'b2';
let fetchMock: ReturnType<typeof vi.fn>;
let visibility: 'visible' | 'hidden' = 'visible';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  live = 'b2';
  visibility = 'visible';
  window.sessionStorage.clear();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ version: live }) }));
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NewVersion', () => {
  it('keeps an empty polite status region in the page before anything is newer', () => {
    render(<NewVersion version="b1" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('shows the card when the live build differs, with Refresh and Dismiss', async () => {
    render(<NewVersion version="b1" />);
    await tick(VERSION_POLL_MS);
    expect(fetchMock).toHaveBeenCalledWith(VERSION_URL, { cache: 'no-store' });
    expect(screen.getByRole('status')).toHaveTextContent('A new version of Curios is ready');
    expect(screen.getByText('Refresh to get the latest.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('stays quiet when the version is the same, and stops asking once it shows', async () => {
    live = 'b1';
    render(<NewVersion version="b1" />);
    await tick(VERSION_POLL_MS);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    live = 'b2';
    await tick(VERSION_POLL_MS);
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
    const calls = fetchMock.mock.calls.length;
    await tick(VERSION_POLL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('never asks while the tab is hidden, and asks when it becomes visible', async () => {
    visibility = 'hidden';
    render(<NewVersion version="b1" />);
    await tick(VERSION_POLL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('A new version');
  });

  it('asks when the connection returns', async () => {
    render(<NewVersion version="b1" />);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('backs off after an error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<NewVersion version="b1" />);
    await tick(VERSION_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(VERSION_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(VERSION_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not ask in development unless forced', async () => {
    const { unmount } = render(<NewVersion version="development" />);
    await tick(VERSION_POLL_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
    render(<NewVersion version="development" force />);
    await tick(VERSION_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers a dismissal for that version, and shows a newer one again', async () => {
    render(<NewVersion version="b1" />);
    await tick(VERSION_POLL_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(window.sessionStorage.getItem(DISMISSED_KEY)).toBe('b2');
    await tick(VERSION_POLL_MS);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    live = 'b3';
    await tick(VERSION_POLL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('A new version');
  });

  it('reloads the page on Refresh', async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    render(<NewVersion version="b1" />);
    await tick(VERSION_POLL_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});

describe('new-version.module.css', () => {
  const rule = (selector: string) => {
    const start = css.indexOf(`
${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  };

  it('draws Refresh as the primary pill, in the action tokens', () => {
    const refresh = rule('.refresh');
    expect(refresh).toContain('background: var(--action)');
    expect(refresh).toContain('color: var(--action-fg)');
    expect(refresh).toContain('border-radius: 999px');
  });

  it('is a 16px card with a hairline ring, and honours reduced motion', () => {
    expect(rule('.card')).toContain('border-radius: 16px');
    expect(rule('.card')).toContain('0 0 0 1px var(--line)');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.card\s*\{\s*animation: none/);
  });
});
