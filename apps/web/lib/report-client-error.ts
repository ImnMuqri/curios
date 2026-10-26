/**
 * Reports an error a client error boundary caught, which React does not pass on to the browser's
 * own error handlers. One that came from the server carries a digest and was reported there.
 */
export function reportClientError(error: Error & { digest?: string }): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN || error.digest) return;
  void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
}
