import { describe, expect, it } from 'vitest';
import { BILLPLZ_ENV } from '@curios/billing';
import { buildApp } from '../../app.js';
import { STORAGE_ENV } from './storage.js';

/**
 * Fix round 1, item 1b. storageDisabled (never disables in production) and
 * createS3Store (throws naming a missing setting) are each proven alone in
 * storage.test.ts, but nothing proved they are actually wired together at
 * registration. Hard-coding `store = null` in page.routes.ts -- skipping both
 * -- would leave every other test in the suite green: every test that reaches
 * an avatar route passes its own `pages` override, so none of them ever calls
 * `createS3Store` for real. This is the one test that does.
 *
 * Every BILLPLZ_* setting is filled in so a rejection here can only be about
 * storage; billing's own production requirement has its own test in
 * billing.routes.test.ts.
 */
describe('pageRoutes registration in production', () => {
  it('refuses to start over a missing storage setting, naming it, with Billplz fully configured', async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedBillplz = Object.fromEntries(BILLPLZ_ENV.map((name) => [name, process.env[name]]));
    const savedStorage = Object.fromEntries(STORAGE_ENV.map((name) => [name, process.env[name]]));

    try {
      process.env.NODE_ENV = 'production';
      for (const name of BILLPLZ_ENV) process.env[name] = 'set';
      for (const name of STORAGE_ENV) delete process.env[name];

      // createS3Store checks in this order (storage.ts): STORAGE_BUCKET,
      // STORAGE_PUBLIC_URL, STORAGE_ENDPOINT, then the two credential
      // settings -- STORAGE_BUCKET is the first one it reaches, so that is
      // the name a bare buildApp() must surface here.
      await expect(buildApp()).rejects.toThrow(/STORAGE_BUCKET is not set/);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      for (const [name, value] of Object.entries(savedBillplz)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      for (const [name, value] of Object.entries(savedStorage)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
