// jsdom implements neither of these, and both are needed by components in this
// package: AskBar asks matchMedia whether motion is reduced before it starts
// cycling, and every component test asserts with jest-dom matchers.
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

import '@testing-library/jest-dom/vitest';
