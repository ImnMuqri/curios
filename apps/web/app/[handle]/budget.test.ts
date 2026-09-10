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
 * Settled empirically (Step 14 of the slice-6 FAQ plan), against a real
 * `pnpm --filter @curios/web build`:
 *
 *   node -e "const m=require('./.next/app-build-manifest.json').pages;
 *     for(const r of ['/[handle]/faq/page','/[handle]/faq/[slug]/page'])
 *     console.log(r, JSON.stringify(m[r]??'ABSENT'))"
 *
 *   /[handle]/faq/page       [..., "static/chunks/app/[handle]/faq/page-a53d470d8c5651d5.js"]
 *   /[handle]/faq/[slug]/page [..., "static/chunks/app/[handle]/faq/[slug]/page-a53d470d8c5651d5.js"]
 *
 * Neither the "absent" guess nor the "own is empty" guess held: both routes
 * are listed, and each carries exactly one own-path .js file, 388 bytes,
 * byte-identical content between the two routes. Its full decompiled content
 * is nothing but the CSS Modules class-name lookup object --
 *   {page:"faq_page__xr5gE",shop:"faq_shop__...", ...}
 * -- no React, no component, no client boundary. Next always emits this shim
 * for a `.module.css` import, whether or not the importing component is a
 * client component, so a page with zero interactivity still shows up here.
 *
 * For contrast, `/[handle]/page` -- which does render the interactive `Ask`
 * -- carries a 5346-byte own chunk *and* an extra 7321-byte shared chunk
 * neither FAQ route pulls in at all. So the assertion that is actually true,
 * and still does the job the guard exists for, is a size ceiling far below
 * what any real interactivity costs, not an empty array.
 */
const FAQ_OWN_CHUNK_CEILING_BYTES = 2048;

describe('the public page JS budget', () => {
  const root = process.cwd();
  const manifestPath = join(root, '.next/app-build-manifest.json');

  it('keeps the route own chunk under budget', () => {
    if (!existsSync(manifestPath)) {
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
    if (!existsSync(manifestPath)) return;

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
    if (!existsSync(manifestPath)) return;

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
