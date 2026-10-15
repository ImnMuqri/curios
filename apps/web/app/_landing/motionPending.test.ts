import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_PENDING_MS, motionPendingScript, pendMotion } from './motionPending.js';

const win = (reduce: boolean) => ({ matchMedia: (query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion: reduce') }) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pendMotion', () => {
  it('marks the root pending when motion is allowed', () => {
    const root = document.createElement('div');
    expect(pendMotion(win(false), root, 4000)).toBe(true);
    expect(root.hasAttribute('data-motion-pending')).toBe(true);
  });

  it('leaves the root alone under reduced motion', () => {
    const root = document.createElement('div');
    expect(pendMotion(win(true), root, 4000)).toBe(false);
    expect(root.hasAttribute('data-motion-pending')).toBe(false);
  });

  it('gives up after the wait when motion never turned on', () => {
    const root = document.createElement('div');
    pendMotion(win(false), root, 4000);
    vi.advanceTimersByTime(3999);
    expect(root.hasAttribute('data-motion-pending')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(root.hasAttribute('data-motion-pending')).toBe(false);
  });

  it('keeps the attribute when a scene switched on', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-motion="on"></div>';
    pendMotion(win(false), root, 4000);
    vi.advanceTimersByTime(5000);
    expect(root.hasAttribute('data-motion-pending')).toBe(true);
  });
});

describe('motionPendingScript', () => {
  // The string is what the page ships, so it is run the way the browser would run it.
  function run(reduce: boolean) {
    const root = document.createElement('div');
    const script = document.createElement('script');
    root.append(script);
    document.body.append(root);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the point is to run the shipped string like a browser would
    const fn = new Function('window', 'document', motionPendingScript());
    fn(win(reduce), { currentScript: script });
    root.remove();
    return root;
  }

  it('pends motion from the shipped string', () => {
    expect(run(false).hasAttribute('data-motion-pending')).toBe(true);
    expect(run(true).hasAttribute('data-motion-pending')).toBe(false);
  });

  it('passes the shared wait and needs no library', () => {
    const src = motionPendingScript();
    expect(src).toContain(String(MOTION_PENDING_MS));
    expect(src).not.toMatch(/gsap|lenis|import|require/i);
  });
});
