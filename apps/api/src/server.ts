import { buildApp } from './app.js';
import { onShutdown } from '@curios/core/shutdown';

const app = await buildApp();
const port = Number(process.env.PORT ?? 3001);

await app.listen({ port, host: '0.0.0.0' });

// A deploy sends SIGTERM. app.close() stops taking requests, waits for the ones in flight (a chat
// stream among them), then runs every plugin's onClose: Prisma, Redis and the queues.
onShutdown(() => app.close(), app.log);
