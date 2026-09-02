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
