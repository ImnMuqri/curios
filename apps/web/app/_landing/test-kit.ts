import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { defaultSettings } from '@curios/core/settings';

/** Shared by the landing's section tests: no test code ships from here. */

export const LOCALES = ['en', 'ms'] as const;
/** The prices and allowances in force: the defaults, as a database with no rows gives. */
export const TERMS = defaultSettings();

/** A file next to this one, as text. */
export function read(file: string): string {
  return readFileSync(join(import.meta.dirname, file), 'utf8');
}

/** The declarations of the first rule whose selector is exactly `selector`. */
export function rule(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() === selector) return m[2]!;
  }
  return '';
}

/** The visitor asked for less motion. */
export function reduceMotion() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
}

/** A fake IntersectionObserver: `show(true)` tells every watched element it is in view. */
export function watchViews() {
  const watchers: { cb: IntersectionObserverCallback; els: Element[] }[] = [];
  class FakeIO {
    w: { cb: IntersectionObserverCallback; els: Element[] };
    constructor(cb: IntersectionObserverCallback) {
      this.w = { cb, els: [] };
      watchers.push(this.w);
    }
    observe(el: Element) {
      this.w.els.push(el);
    }
    unobserve(el: Element) {
      this.w.els = this.w.els.filter((e) => e !== el);
    }
    disconnect() {
      this.w.els = [];
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIO);
  return {
    show(inView: boolean) {
      act(() => {
        for (const w of watchers) {
          const entries = w.els.map(
            (target) => ({ target, isIntersecting: inView, intersectionRatio: inView ? 1 : 0 }) as unknown as IntersectionObserverEntry,
          );
          if (entries.length) w.cb(entries, {} as IntersectionObserver);
        }
      });
    },
    count: () => watchers.reduce((n, w) => n + w.els.length, 0),
  };
}

/** Advances fake time in steps, letting React and promises settle between them. */
export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
