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

// jsdom has no layout engine, so it does not implement scrollIntoView at all
// -- calling it throws "not a function" without this. ChatMode calls it to
// keep the newest line of a streaming answer in view, now that nothing is
// position: fixed and the page scrolls normally instead of being locked.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}
