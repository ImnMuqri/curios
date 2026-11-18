import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { findHexLiterals, findOffRuleRadii, findOffScaleFontSizes } from '../../../../packages/ui/src/design-rules.js';
import { LivePeek, type LivePeekHandle } from './LivePeek.js';
import { habitMs, nextHabitAt, pickHabit, pupilOffset } from './peek-life.js';
import styles from './live-peek.module.css';
import { advance } from '../_landing/test-kit.js';

const css = readFileSync(join(import.meta.dirname, 'live-peek.module.css'), 'utf8');

function reduceMotion() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
}

/** Every Peek's box: 100 by 100 at the top left, in view. */
const inView = () =>
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {},
  });

const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Peek’s life, in numbers', () => {
  it('moves the pupils at most 4.5 by 3.5, a pixel up at rest', () => {
    expect(pupilOffset(260, 0)).toEqual({ x: 4.5, y: -1 });
    expect(pupilOffset(0, 0)).toEqual({ x: 0, y: -1 });
    expect(pupilOffset(0, 130)).toEqual({ x: 0, y: 0.75 });
  });

  it('picks a habit, and never waves while whistling', () => {
    expect(pickHabit(4 / 9, 'whistle')).toBe('tilt');
    expect(pickHabit(4 / 9, 'idle')).toBe('wave2');
  });

  it('times each habit as the board does', () => {
    expect(habitMs('hop')).toBe(520);
    expect(habitMs('squish')).toBe(800);
    expect(habitMs('wave2')).toBe(1900);
    expect(nextHabitAt(0, 0, true)).toBe(1500);
    expect(nextHabitAt(0, 1, false)).toBe(7400);
  });
});

describe('LivePeek', () => {
  it('two live Peeks on one page have unique clip ids', () => {
    const { container } = render(
      <>
        <LivePeek width={80} />
        <LivePeek width={80} />
      </>,
    );
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[\w-]+$/);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('a mood is a class for its time, then gone', async () => {
    vi.useFakeTimers();
    const ref = createRef<LivePeekHandle>();
    const { container } = render(<LivePeek width={80} ref={ref} />);
    const svg = container.querySelector('svg')!;
    act(() => ref.current!.mood('hop'));
    expect(svg.getAttribute('class')).toContain(styles.hop);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(520);
    });
    expect(svg.getAttribute('class')).not.toContain(styles.hop);
  });

  it('holds a mood while held is set', () => {
    const { container } = render(<LivePeek width={80} held="happy" />);
    expect(container.querySelector('svg')!.getAttribute('class')).toContain(styles.happy);
  });

  it('adds no pointer listener and no timer under reduced motion', () => {
    vi.useFakeTimers();
    reduceMotion();
    const add = vi.spyOn(window, 'addEventListener');
    render(<LivePeek width={80} follow />);
    expect(add.mock.calls.map((c) => c[0])).not.toContain('pointermove');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares one pointer listener between many Peeks', () => {
    const add = vi.spyOn(window, 'addEventListener');
    render(
      <>
        <LivePeek width={80} follow />
        <LivePeek width={80} follow />
        <LivePeek width={80} />
      </>,
    );
    expect(add.mock.calls.filter((c) => c[0] === 'pointermove')).toHaveLength(1);
  });

  it('moves the pupils toward the pointer', async () => {
    inView();
    const { container } = render(<LivePeek width={100} follow />);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 310, clientY: 55 }));
    });
    await nextFrame();
    expect((container.querySelector(`.${styles.p}`) as SVGGElement).style.transform).toBe('translate(4.50px,-1.00px)');
  });

  it('reads each Peek’s box once a frame, however many pointer moves', async () => {
    const rect = inView();
    render(<LivePeek width={100} follow />);
    rect.mockClear();
    act(() => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new MouseEvent('pointermove', { clientX: 310, clientY: 55 }));
    });
    await nextFrame();
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it('leaves a Peek with no box alone, as a hidden one has', async () => {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {},
    });
    const { container } = render(<LivePeek width={100} follow />);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 310, clientY: 55 }));
    });
    await nextFrame();
    expect((container.querySelector(`.${styles.p}`) as SVGGElement).style.transform).toBe('');
  });

  it('runs looping animations only without reduced motion', () => {
    expect(css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '')).not.toMatch(/animation:[^;]*infinite/);
  });

  it('stays on the corner rule, the type scale, and hex-free', () => {
    expect(findOffRuleRadii(css)).toEqual([]);
    expect(findOffScaleFontSizes(css)).toEqual([]);
    expect(findHexLiterals(css)).toEqual([]);
  });
});

describe('Peek’s habit clock', () => {
  it('does a habit when the clock says, which Math.random seeds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    inView();
    const { container } = render(<LivePeek width={80} />);
    const cls = () => container.querySelector('svg')!.getAttribute('class') ?? '';
    // The first habit is due at 1500 + 0.5 × 4000 = 3500ms; the clock ticks every 400ms.
    await advance(3200);
    expect(cls()).not.toContain(styles.wave2);
    await advance(400);
    expect(cls()).toContain(styles.wave2);
  });

  it('looks around, and leaves no timer and no pointer listener when Peek goes mid-look', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    inView();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = render(<LivePeek width={80} follow />);
    // Due at 1500, picked on the 1600ms tick: a look to the left first.
    await advance(1700);
    expect((container.querySelector(`.${styles.p}`) as SVGGElement).style.transform).toBe('translate(-4.50px,0.00px)');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove.mock.calls.map((c) => c[0])).toContain('pointermove');
  });

  it('stops the clock while the tab is hidden', () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    try {
      render(<LivePeek width={80} />);
      expect(vi.getTimerCount()).toBe(1);
      hidden = true;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(vi.getTimerCount()).toBe(0);
      hidden = false;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });
});
