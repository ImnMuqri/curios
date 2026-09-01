import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@curios/core/cookie';
import { middleware } from './middleware.js';

const request = (path: string, cookie?: string) => {
  const req = new NextRequest(new URL(`http://localhost:3000${path}`));
  if (cookie !== undefined) req.cookies.set(SESSION_COOKIE, cookie);
  return req;
};

describe('middleware', () => {
  it('sends a caller with no cookie to sign in', () => {
    const res = middleware(request('/app/onboarding'));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/signin');
  });

  it('remembers where they were going', () => {
    const res = middleware(request('/app/onboarding'));

    // Bouncing someone to sign in and then dumping them on a dashboard they
    // did not ask for is a small rudeness that compounds on a slow phone.
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('next')).toBe('/app/onboarding');
  });

  it('lets a caller with a cookie through WITHOUT validating it', () => {
    // The whole point of this layer: it runs on the Edge, where Prisma cannot,
    // so it can only check presence. A forged value passes here and is caught
    // by the layout. This test exists so nobody "fixes" that by adding a
    // check middleware cannot perform.
    const res = middleware(request('/app', 'a-value-this-server-never-issued'));

    expect(res.status).toBe(200);
  });
});
