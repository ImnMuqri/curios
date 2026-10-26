import * as Sentry from '@sentry/node';
import { scrubBreadcrumb, scrubEvent, type ReportedError } from '@curios/core/error-report';

let started = false;

/**
 * Sentry, when SENTRY_DSN is set: production. Unset (development, the tests) it stays off and
 * `reportError` does nothing. Errors only, no tracing. Besides what the logger reports, the SDK
 * catches what nothing logged: an uncaught exception, an unhandled rejection.
 */
export function startErrorTracking(service: 'api' | 'workers'): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  started = true;
  return true;
}

/** What errorReportingHook hands over for each error-level log line. */
export function reportError({ error, message, extra }: ReportedError): void {
  if (!started) return;
  if (error) Sentry.captureException(error, { extra: { ...extra, logMessage: message } });
  else Sentry.captureMessage(message, { level: 'error', extra });
}

/** Sends what is queued before the process exits. */
export async function flushErrorTracking(): Promise<void> {
  if (started) await Sentry.close(2_000);
}
