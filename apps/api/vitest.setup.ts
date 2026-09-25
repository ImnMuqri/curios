// Runs before any test module is imported, which is the whole point: the
// @curios/db singleton is constructed during module evaluation, so an
// assignment inside beforeAll would land after `app.prisma` was already bound
// to the dev database. Same trap, and same fix, as packages/db-read.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

// A namespace unique to this run, for the same reason: the limiters count in
// Redis with a 15-minute window, and those keys outlive the process. Sharing
// one namespace across runs makes the suite throttle itself -- the second run
// inherits the first run's budget, and the failures look like anything but a
// rate limit. Per-request addresses are not enough, because the same addresses
// come back every run.
//
// Within a run the limiters behave exactly as they do in production, so
// rate-limit.test.ts still proves they throttle. Only the bleed between runs
// is removed, which is the same clean-slate property the truncated test
// database gives every other test.
process.env.RATE_LIMIT_NAMESPACE = `curios-rl-test-${process.pid}-${Date.now()}:`;

// The limiter budgets, pinned to the production defaults.
//
// The root setup loads .env, so without this the suite inherits whatever a
// developer has put there -- and raising the limits locally to click through
// the app is a reasonable thing to do. It silently breaks the tests that
// assert a 429, which are exactly the tests proving the limiters still throttle
// where they are supposed to. A suite whose result depends on a gitignored
// file is not a suite.
//
// rate-limit.test.ts sets its own, much tighter values in beforeAll and
// restores them after; these are the defaults everything else runs against.
process.env.RATE_LIMIT_CHAT_PER_PAGE = '30';
process.env.RATE_LIMIT_CHAT_PER_IP = '100';
process.env.RATE_LIMIT_INGEST_PER_IP = '5';
process.env.RATE_LIMIT_INGEST_PER_PAGE = '20';
process.env.RATE_LIMIT_AUTH_PER_IP = '20';
process.env.RATE_LIMIT_AUTH_PER_EMAIL = '10';

// Same reasoning, same fix, for the other wallet control chatRoutes resolves
// at registration time: a developer with CONVERSATION_CAP_PER_MONTH set in
// their own .env (to click through the degrade path locally, say) would
// otherwise change what "over the cap" means for any suite that builds a real
// app via buildApp() -- app.test.ts among them. Pinned to the production
// default so those suites see the same number production does.
process.env.CONVERSATION_CAP_PER_MONTH = '200';

// The Billplz settings buildApp() now requires at boot. Dummies: every test that
// reaches Billplz injects a stub client through AppOverrides, so none of these is
// ever sent anywhere. They exist so the boot check passes, and so a developer's own
// sandbox keys in .env never change what a test does.
process.env.BILLPLZ_API_KEY = 'test-billplz-api-key';
process.env.BILLPLZ_COLLECTION_ID = 'test-collection';
process.env.BILLPLZ_X_SIGNATURE_KEY = 'test-signature-key';
process.env.BILLPLZ_BASE_URL = 'https://billplz.invalid';
process.env.BILLPLZ_CALLBACK_URL = 'http://localhost:3001/billing/billplz/callback';
process.env.BILLPLZ_REDIRECT_URL = 'http://localhost:3001/billing/billplz/return';
process.env.RATE_LIMIT_BILLING_PER_ACCOUNT = '10';

// The embeddings key factRoutes now requires at boot, for the same reason as
// the Billplz settings above: every test that reaches the embedder injects a
// stub through AppOverrides.facts.embedder, so this dummy is never sent
// anywhere. It exists so the boot check passes, and so a developer's own key
// in .env never changes what a test does -- and so nothing in this suite can
// spend real money reaching a real embedder by accident.
process.env.OPENAI_API_KEY = 'test-openai-api-key';
