import { scrubBreadcrumb, scrubEvent } from '@curios/core/error-report';

/**
 * Sentry in the browser, when NEXT_PUBLIC_SENTRY_DSN is set. Loaded only then, and after the page,
 * so a page without it pays nothing and a page with it does not wait for it.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import('@sentry/nextjs').then((Sentry) =>
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    }),
  );
}
