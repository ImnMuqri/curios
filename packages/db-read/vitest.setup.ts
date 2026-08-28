// Runs before the test module is imported, which matters: client.ts reads
// DATABASE_URL_READONLY during module evaluation, so an assignment inside
// beforeAll would land after the client was already built against the dev
// database.
process.env.DATABASE_URL_READONLY = process.env.DATABASE_URL_TEST_READONLY;
