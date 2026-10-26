import type { Instrumentation } from 'next';
import { scrubBreadcrumb, scrubEvent } from '@curios/core/error-report';

/**
 * Sentry on the server, when SENTRY_DSN is set (production); off, and not even loaded, otherwise.
 * Errors only, no tracing, and every event scrubbed of order tokens, cookies and bodies.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

/** A render, route handler or server action that threw: what Next would otherwise only log. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
