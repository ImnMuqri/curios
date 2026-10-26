import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers.js';

const prod = { apiUrl: 'https://api.curios.my', sentryDsn: 'https://abc123@o42.ingest.us.sentry.io/7', dev: false };

function directive(csp: string, name: string): string | undefined {
  return csp.split('; ').find((d) => d === name || d.startsWith(`${name} `));
}

describe('contentSecurityPolicy', () => {
  it('lets the browser reach the API and Sentry by origin, and nothing else beyond this site', () => {
    expect(directive(contentSecurityPolicy(prod), 'connect-src')).toBe(
      "connect-src 'self' https://api.curios.my https://o42.ingest.us.sentry.io",
    );
  });

  it('never puts the Sentry key into the header', () => {
    expect(contentSecurityPolicy(prod)).not.toContain('abc123');
  });

  it('forbids framing, plugins and foreign form targets', () => {
    const csp = contentSecurityPolicy(prod);
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'form-action')).toBe("form-action 'self'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
  });

  it('upgrades insecure requests and allows no eval in production', () => {
    const csp = contentSecurityPolicy(prod);
    expect(directive(csp, 'upgrade-insecure-requests')).toBeDefined();
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'");
  });

  it('allows eval and the dev websocket, and no upgrade to https, under next dev', () => {
    const csp = contentSecurityPolicy({ apiUrl: 'http://localhost:3001', dev: true });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' http://localhost:3001 ws:");
    expect(directive(csp, 'upgrade-insecure-requests')).toBeUndefined();
  });

  it('leaves out a missing or malformed URL rather than writing it into the policy', () => {
    expect(directive(contentSecurityPolicy({ apiUrl: 'not a url', dev: false }), 'connect-src')).toBe("connect-src 'self'");
  });
});

describe('securityHeaders', () => {
  const names = (dev: boolean) => securityHeaders({ ...prod, dev }).map((h) => h.key);

  it('sends every hardening header in production, HSTS included', () => {
    expect(names(false)).toEqual([
      'Content-Security-Policy',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ]);
  });

  it('never sends HSTS from next dev', () => {
    expect(names(true)).not.toContain('Strict-Transport-Security');
  });
});
