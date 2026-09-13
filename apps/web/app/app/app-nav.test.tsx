import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The nav as the dashboard actually renders it.
 *
 * `Nav.test.tsx` proves `Nav` marks whatever `current` it is handed, but against
 * a list of links it declares for itself -- a copy of `ITEMS` in `app-nav.tsx`.
 * So a typo in the real list (`/app/lead` for `/app/leads`) broke the nav with
 * every test green, and nothing proved the real pathname ever reaches the
 * marker. This renders `AppNav` itself, reads its links off the page rather
 * than off a second list, and checks them against the routes that exist.
 */
let pathname: string | null = '/app/leads';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const { AppNav } = await import('./app-nav.js');

// `apps/web/app` -- where a dashboard href such as /app/leads keeps its page.tsx.
// Resolved from the package root vitest runs in, not from `import.meta.url`:
// under jsdom that is not a file: URL, so it cannot be turned back into a path.
const appDir = join(process.cwd(), 'app');

describe('AppNav', () => {
  beforeEach(() => {
    pathname = '/app/leads';
  });

  it('links only to screens that exist', () => {
    render(<AppNav />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');

    // Guards the path: if this file moved, or vitest ran from somewhere else,
    // every check below would fail for a reason that has nothing to do with the nav.
    expect(existsSync(join(appDir, 'app', 'app-nav.tsx'))).toBe(true);
    // Guards the loop below: an empty nav would pass it without checking anything.
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(existsSync(join(appDir, href, 'page.tsx')), `${href} has no page.tsx`).toBe(true);
    }
  });

  it('marks exactly the link for the screen it is on, for every screen', () => {
    const first = render(<AppNav />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    first.unmount();

    for (const href of hrefs) {
      pathname = href;
      const view = render(<AppNav />);
      const marked = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.getAttribute('href'));
      // Exactly one, and the right one. `toContain` would pass a nav that
      // marked every link as current.
      expect(marked).toEqual([href]);
      view.unmount();
    }
  });

  it('marks nothing on a screen the nav does not list', () => {
    pathname = '/app/onboarding';
    render(<AppNav />);

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
  });
});
