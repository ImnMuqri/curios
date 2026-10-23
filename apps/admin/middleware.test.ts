import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN_COOKIE } from '@curios/core/admin';
import { config, middleware } from './middleware.js';

const request = (path: string, cookie?: string) => {
  const req = new NextRequest(new URL(`http://localhost:3002${path}`));
  if (cookie !== undefined) req.cookies.set(ADMIN_COOKIE, cookie);
  return req;
};

describe('middleware', () => {
  it('sends a caller with no admin cookie to sign in', () => {
    const res = middleware(request('/pages'));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/signin');
  });

  it('does not accept the owner cookie', () => {
    const req = new NextRequest(new URL('http://localhost:3002/'));
    req.cookies.set('curios_session', 'x');

    expect(middleware(req).status).toBe(307);
  });

  it('lets a caller with the cookie through without validating it', () => {
    // Edge cannot ask the database; the (admin) layout does.
    expect(middleware(request('/', 'never-issued')).status).toBe(200);
  });

  it('matches every page except sign-in and assets', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);

    expect(re.test('/')).toBe(true);
    expect(re.test('/pages')).toBe(true);
    expect(re.test('/audit')).toBe(true);
    expect(re.test('/signin')).toBe(false);
    expect(re.test('/_next/static/chunk.js')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
  });
});
