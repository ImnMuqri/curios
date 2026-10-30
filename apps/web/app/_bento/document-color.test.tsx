import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PageTheme } from './BentoPage.js';
import { mixRgb, paintDocument } from './document-color.js';

const theme = { style: 'SOFT', accentColor: '#b5294e', headingFont: 'BRICOLAGE', background: 'INK', backgroundColor: null } as const;

afterEach(() => {
  cleanup();
  document.documentElement.style.backgroundColor = '';
  document.body.style.backgroundColor = '';
});

describe('paintDocument', () => {
  it('paints the root, the body and the browser bars, and gives all three back', () => {
    const undo = paintDocument('rgb(10, 13, 19)');
    expect(document.documentElement.style.backgroundColor).toBe('rgb(10, 13, 19)');
    // iOS 26 Safari colours the status bar's strip from the body.
    expect(document.body.style.backgroundColor).toBe('rgb(10, 13, 19)');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', 'rgb(10, 13, 19)');
    undo();
    expect(document.documentElement.style.backgroundColor).toBe('');
    expect(document.body.style.backgroundColor).toBe('');
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
  });

  it('leaves the body its paper when asked, for a page that sits as a column on a wide screen', () => {
    const undo = paintDocument('rgb(10, 13, 19)', { body: false });
    expect(document.documentElement.style.backgroundColor).toBe('rgb(10, 13, 19)');
    expect(document.body.style.backgroundColor).toBe('');
    undo();
  });

  it('paints the root alone in the foot colour, the body and the bars in the top one', () => {
    const undo = paintDocument('rgb(67, 64, 35)', { foot: 'rgb(189, 163, 127)' });
    expect(document.body.style.backgroundColor).toBe('rgb(67, 64, 35)');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', 'rgb(67, 64, 35)');
    expect(document.documentElement.style.backgroundColor).toBe('rgb(189, 163, 127)');
    undo();
    expect(document.documentElement.style.backgroundColor).toBe('');
  });
});

describe('mixRgb', () => {
  it('mixes as color-mix in srgb does, and refuses what it cannot read', () => {
    expect(mixRgb('rgb(0, 0, 0)', '#ffffff', 0.35)).toBe('rgb(166, 166, 166)');
    expect(mixRgb('rgb(25, 31, 44)', '#434023', 1)).toBe('rgb(25, 31, 44)');
    expect(mixRgb('rgb(25, 31, 44)', 'blue', 0.5)).toBeNull();
  });
});

describe('PageTheme', () => {
  it('paints the document only when it is the whole screen, never in a preview', () => {
    const { unmount } = render(
      <PageTheme theme={theme}>
        <p>preview</p>
      </PageTheme>,
    );
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    unmount();
    render(
      <PageTheme theme={theme} paintDocument>
        <p>public</p>
      </PageTheme>,
    );
    expect(document.querySelector('meta[name="theme-color"]')).not.toBeNull();
  });

  it('given the cover’s colours, paints the bars in the top one under the shop’s veil, the root in the foot one', () => {
    render(
      <PageTheme theme={theme} paintDocument={{ tint: { top: '#434023', bottom: '#bda37f' } }}>
        <p>shop</p>
      </PageTheme>,
    );
    const page = getComputedStyle(document.querySelector<HTMLElement>('[aria-hidden="true"]')!).backgroundColor;
    expect(document.body.style.backgroundColor).toBe(mixRgb(page, '#434023', 0.35));
    expect(document.documentElement.style.backgroundColor).toBe(mixRgb(page, '#bda37f', 0.62));
  });
});
