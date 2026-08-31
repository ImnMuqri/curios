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
