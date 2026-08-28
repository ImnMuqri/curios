// Runs before any test module is imported, which is the whole point: the
// @curios/db singleton is constructed during module evaluation, so an
// assignment inside beforeAll would land after `app.prisma` was already bound
// to the dev database. Same trap, and same fix, as packages/db-read.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
