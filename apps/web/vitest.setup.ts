import { vi } from 'vitest';

// jsdom does not implement matchMedia. AskBar's cycling effect calls
// window.matchMedia('(prefers-reduced-motion: reduce)') whenever there are 2+
// questions, which the fixture page always has, so every render test needs a
// stub. It resolves as a non-matching query so the setInterval path stays
// exercised, and carries the listener methods a future subscriber would need.
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
// Appended rather than replacing the matchMedia stub above, which the public
// page's tests still need.
import '@testing-library/jest-dom/vitest';

// jsdom has no layout engine, so it does not implement scrollIntoView at all
// -- calling it throws "not a function" without this. ChatMode calls it to
// keep the newest line of a streaming answer in view, now that nothing is
// position: fixed and the page scrolls normally instead of being locked.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// next/font/google runs at build time and downloads real font files, which a
// unit test can neither do nor should. The mock returns the shape the loader
// returns -- a className and a CSS variable name -- so a layout that forgets
// to apply one still fails its test rather than silently falling back to
// system-ui everywhere.
vi.mock('next/font/google', () => ({
  Bricolage_Grotesque: () => ({ variable: 'font-bricolage', className: 'font-bricolage' }),
  Inter: () => ({ variable: 'font-inter', className: 'font-inter' }),
  IBM_Plex_Mono: () => ({ variable: 'font-plex-mono', className: 'font-plex-mono' }),
  Plus_Jakarta_Sans: () => ({ variable: 'font-jakarta', className: 'font-jakarta' }),
  Fraunces: () => ({ variable: 'font-fraunces', className: 'font-fraunces' }),
  Space_Grotesk: () => ({ variable: 'font-space-grotesk', className: 'font-space-grotesk' }),
  DM_Serif_Display: () => ({ variable: 'font-dm-serif', className: 'font-dm-serif' }),
  Outfit: () => ({ variable: 'font-outfit', className: 'font-outfit' }),
}));
