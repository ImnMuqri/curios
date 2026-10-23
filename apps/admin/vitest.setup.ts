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

// next/font/google downloads real font files at build time, which a unit test can
// neither do nor should. The mock returns the loader's shape for the three faces
// apps/admin/lib/fonts.ts uses.
vi.mock('next/font/google', () => ({
  Bricolage_Grotesque: () => ({ variable: 'font-bricolage', className: 'font-bricolage' }),
  IBM_Plex_Mono: () => ({ variable: 'font-plex-mono', className: 'font-plex-mono' }),
  IBM_Plex_Sans: () => ({ variable: 'font-plex-sans', className: 'font-plex-sans' }),
}));
