import { onShutdown } from '@curios/core/shutdown';
import { flushErrorTracking, startErrorTracking } from './lib/error-tracking.js';

// Before the app is built, so an error while it starts is reported too.
const tracking = startErrorTracking('api');
const { buildApp } = await import('./app.js');
const app = await buildApp();
if (!tracking && process.env.NODE_ENV === 'production') app.log.warn('SENTRY_DSN is not set: errors are only logged, not reported.');
const port = Number(process.env.PORT ?? 3001);

await app.listen({ port, host: '0.0.0.0' });

// A deploy sends SIGTERM. app.close() stops taking requests, waits for the ones in flight (a chat
// stream among them), then runs every plugin's onClose: Prisma, Redis and the queues.
onShutdown(async () => {
  await app.close();
  await flushErrorTracking();
}, app.log);
