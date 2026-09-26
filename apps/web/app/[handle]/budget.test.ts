import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FRONTEND.md: "Budget, enforced in CI: under 40KB JS before chat opens."
 *
 * That sentence has never been enforced anywhere, and measuring it is how we
 * found out it cannot be met as literally written. Next reports 105 kB of
 * First Load JS for this route, of which 102 kB is the shared React and Next
 * runtime -- React alone is around 50 kB gzipped, so no amount of care in this
 * codebase brings first-load under 40 kB while React is in it.
 *
 * So this measures the number this codebase actually controls: the route's own
 * chunk, which is what grows when someone adds a dependency or statically
 * imports something that should have been lazy. The framework floor is
 * recorded below rather than asserted, so the real figure is visible to
 * whoever revisits the budget in FRONTEND.md.
 */
const ROUTE_CHUNK_BUDGET_KB = 40;

/**
 * Uncompressed, and a ratchet rather than a target. 355kB today, of which the
 * React and Next runtime is the overwhelming majority -- see FRONTEND.md on
 * why the original 40kB first-load budget was never achievable. The margin is
 * deliberately small: this exists to catch growth, not to bless the number.
 */
const FIRST_LOAD_CEILING_KB = 400;

/**
 * Neither route's own chunk is ever empty -- Next always emits the CSS
 * Modules class-name lookup object for a `.module.css` import, client
 * component or not -- so this is a size ceiling, not an emptiness check.
 * Three measurements, each against a real `pnpm --filter @curios/web build`:
 *
 *   inert (no client component, current code): 388 B
 *   minimal ('use client' + one useState, one <button>, no other imports),
 *     temporarily added to this route and removed after measuring: 603 B
 *   /[handle]/page's actual `Ask`, for scale: 5346 B own + 7321 B shared chunk
 *
 * The ceiling sits at the midpoint of the first two, comfortably clear of
 * both: 24% above the measured inert floor, 20% below the measured cost of
 * the smallest real client boundary that could be added.
 *
 * 550, not 480: 480 leaves only ~92 bytes of headroom over the 388 B inert
 * floor, and a CSS Modules class name adds roughly 40 bytes to that floor, so
 * two or three purely cosmetic classes added to either FAQ route would blow
 * the ceiling and read as "someone added client JS" when nobody did. 550
 * keeps the same job -- still comfortably below the 603 B minimal
 * client-component floor, so a real client boundary still trips it -- while
 * roughly doubling the cosmetic headroom.
 */
const FAQ_OWN_CHUNK_CEILING_BYTES = 550;

describe('the public page JS budget', () => {
  const root = process.cwd();
  const manifestPath = join(root, '.next/app-build-manifest.json');
  // Only `next build` writes BUILD_ID. `next dev` rewrites the manifest above in
  // place, compiling routes as they are visited, so a dev manifest can be
  // populated and still lack whole routes -- the FAQ pages, until someone opens
  // one. The checks below each catch one dev-output shape; this is the first to
  // ask the question directly: was the last thing to write .next a build?
  const built = existsSync(join(root, '.next/BUILD_ID'));

  it('keeps the route own chunk under budget', () => {
    if (!built || !existsSync(manifestPath)) {
      // Skipped rather than failed: `pnpm test` runs without a build, and a
      // test that fails for the absence of an artifact trains people to ignore
      // it. `pnpm build && pnpm test` is where this bites.
      console.warn('no .next build found; run `pnpm --filter @curios/web build` first');
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pages: Record<string, string[]>;
    };

    if (Object.keys(manifest.pages).length === 0) {
      // `next dev` overwrites this file with an empty one, so a manifest with
      // no pages at all means the last thing to touch .next was the dev
      // server, not a build. Skipped rather than failed: failing here would
      // mean the suite breaks for anyone who ran `next dev` this week, and a
      // test that cries wolf gets ignored on the day it is right.
      console.warn('.next holds a dev-server manifest, not a build; run the build first');
      return;
    }

    // A populated manifest that does not list this route is a different thing
    // entirely -- the key shape changed, and the measurement is silently
    // measuring nothing. That must fail.
    const files = manifest.pages['/[handle]/page'] ?? [];
    expect(files.length).toBeGreaterThan(0);

    // Only the chunks under app/[handle]/. The shared framework chunks are in
    // this list too, and including them would measure React rather than us.
    const own = files.filter((f) => f.includes('app/[handle]/') && f.endsWith('.js'));
    expect(own.length).toBeGreaterThan(0);

    // A production chunk carries a content hash in its filename. Anything
    // without one came from `next dev`, whose output is unminified and several
    // times larger -- measuring it reports a 233kB route and fails for a
    // reason that has nothing to do with the code.
    //
    // This is the second false alarm from this test, and the second is what
    // makes it worth fixing properly: a test that cries wolf gets ignored on
    // the day it is right.
    if (!own.every((f) => /-[0-9a-f]{8,}\.js$/.test(f))) {
      console.warn('.next holds dev output, not a build; run `pnpm --filter @curios/web build`');
      return;
    }

    const bytes = own.reduce((total, f) => total + statSize(join(root, '.next', f)), 0);
    expect(bytes / 1024).toBeLessThan(ROUTE_CHUNK_BUDGET_KB);
  });

  it('keeps the whole first load from creeping', () => {
    // The route-chunk measurement above has a hole, found by watching it drop
    // from 9.08kB to 5.12kB in a commit that ADDED a component: webpack had
    // hoisted the sheet into a shared chunk, which is still first-load but no
    // longer lives under app/[handle]/. Code can escape that metric simply by
    // being shared.
    //
    // So this counts every JavaScript file the route loads before anything is
    // interacted with, framework included. It is a ratchet, not a target --
    // 355kB uncompressed is roughly the 107kB Next reports gzipped, most of it
    // React, and the number that matters is whether it grows.
    if (!built || !existsSync(manifestPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pages: Record<string, string[]>;
    };
    const files = (manifest.pages['/[handle]/page'] ?? []).filter((f) => f.endsWith('.js'));
    if (files.length === 0 || !files.every((f) => /-[0-9a-f]{8,}\.js$/.test(f))) return;

    const bytes = files.reduce((total, f) => total + statSize(join(root, '.next', f)), 0);
    expect(bytes / 1024).toBeLessThan(FIRST_LOAD_CEILING_KB);
  });

  it('ships no route JavaScript for the FAQ pages', () => {
    // Neither FAQ route renders `Ask` or anything else interactive. The guard
    // this exists for -- someone dropping a client component into an SEO page
    // and quietly making it the heaviest thing on the site -- is enforced as a
    // size ceiling rather than an empty-array check; see
    // FAQ_OWN_CHUNK_CEILING_BYTES above for why the own file list is never
    // actually empty.
    if (!built || !existsSync(manifestPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pages: Record<string, string[]>;
    };
    if (Object.keys(manifest.pages).length === 0) return;

    for (const route of ['/[handle]/faq/page', '/[handle]/faq/[slug]/page']) {
      const files = manifest.pages[route] ?? [];
      // A populated manifest that does not list this route at all would be
      // measuring nothing, same reasoning as the /[handle] check above.
      expect(files.length).toBeGreaterThan(0);

      const own = files.filter((f) => f.includes('app/[handle]/faq') && f.endsWith('.js'));
      const bytes = own.reduce((total, f) => total + statSize(join(root, '.next', f)), 0);
      expect(bytes).toBeLessThan(FAQ_OWN_CHUNK_CEILING_BYTES);
    }
  });
});

function statSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
