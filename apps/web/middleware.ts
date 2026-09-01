import { NextResponse, type NextRequest } from 'next/server';
// The subpath, NOT the '@curios/core' barrel. This file is bundled for the
// Edge runtime, and the barrel re-exports a module importing node:crypto,
// which the Edge runtime does not have. Importing the barrel here fails the
// build with UnhandledSchemeError.
import { SESSION_COOKIE } from '@curios/core/cookie';

/**
 * Checks the cookie is PRESENT. Nothing more, and deliberately.
 *
 * This runs on the Edge runtime, where Prisma cannot run, so it cannot ask the
 * database whether the session is real. A forged or expired cookie passes here
 * and is caught by the `/app` layout, which runs on Node and does ask.
 *
 * So this is a redirect convenience, never a security boundary. Nothing is
 * authorized because this let a request through, and `apps/api` re-authorizes
 * every mutation independently regardless of what happened here.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const signin = new URL('/signin', request.url);
  signin.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(signin);
}

export const config = { matcher: '/app/:path*' };
