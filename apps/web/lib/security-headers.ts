/**
 * The headers on every response this app sends: pages, redirects, route
 * handlers and the error and not-found screens. next.config.ts applies them to
 * every path.
 *
 * The CSP allows inline scripts and styles, deliberately. Next streams each
 * page's server-component payload as inline <script> tags and inlines the
 * stylesheets (`inlineCss`). The strict alternative, a per-request nonce,
 * forces every page to render dynamically, and the landing page and legal pages
 * would no longer be prerendered. Everything else is locked to this origin.
 * The exceptions are the API and Sentry, which the browser calls directly,
 * and images, which come from storage and from the links owners add.
 */
export interface SecurityHeaderOptions {
  /** NEXT_PUBLIC_API_URL: the browser calls it directly (apiFetch, the chat stream, lead capture). */
  apiUrl?: string;
  /** NEXT_PUBLIC_SENTRY_DSN: the browser posts errors to its host. */
  sentryDsn?: string;
  /** `next dev` evaluates code with eval and talks to its own websocket; production does neither. */
  dev: boolean;
}

/** The origin of a URL, or null when it is missing or not a URL. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy({ apiUrl, sentryDsn, dev }: SecurityHeaderOptions): string {
  const connect = ["'self'", originOf(apiUrl), originOf(sentryDsn), dev ? 'ws:' : null];
  const directives: [string, ...(string | null)[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", "'unsafe-inline'", dev ? "'unsafe-eval'" : null],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', 'https:'],
    ['font-src', "'self'", 'data:'],
    ['connect-src', ...connect],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  // In development the API is http://localhost:3001, which this would rewrite to https.
  if (!dev) directives.push(['upgrade-insecure-requests']);
  return directives
    .map(([name, ...values]) => [name, ...new Set(values.filter((v): v is string => v !== null))].join(' '))
    .join('; ');
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  const headers = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    // frame-ancestors above covers current browsers; this covers the rest.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Nothing here uses these. navigator.share (the shop's share button) is not on the list.
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), browsing-topics=()',
    },
  ];
  // Never on localhost: a browser that took HSTS from it would refuse every other app on http://localhost.
  if (!options.dev) headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
  return headers;
}
