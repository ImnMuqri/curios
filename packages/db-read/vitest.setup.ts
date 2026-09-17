// Runs before the test module is imported, which matters: client.ts reads
// DATABASE_URL_READONLY during module evaluation, so an assignment inside
// beforeAll would land after the client was already built against the dev
// database.
process.env.DATABASE_URL_READONLY = process.env.DATABASE_URL_TEST_READONLY;

// Pinned to the production default. conversationCap() reads this when called,
// and the root setup loads .env, so without the pin a developer's local
// override would change what the usage test expects. Same as apps/api.
process.env.CONVERSATION_CAP_PER_MONTH = '200';
