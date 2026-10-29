import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PageTheme } from './BentoPage.js';
import { paintDocument } from './document-color.js';

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
});
