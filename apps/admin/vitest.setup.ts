import { vi } from 'vitest';

// jsdom does not implement matchMedia. No admin test reads one yet; this stub
// never matches, so one that does will not throw.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Registers toBeInTheDocument, toBeDisabled and the rest of the DOM matchers.
import '@testing-library/jest-dom/vitest';

// jsdom has no layout engine and does not implement scrollIntoView; calling it throws.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// next/font/local reads the font files through a build-time loader that a unit test does not run.
// The mock returns the loader's shape; apps/admin/lib/fonts.ts loads three faces.
vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'font-face', className: 'font-face' }),
}));
