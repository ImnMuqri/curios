import { NextResponse, type NextRequest } from 'next/server';
// The subpath, NOT the '@curios/core' barrel: this runs on the Edge runtime,
// and the barrel re-exports a module importing node:crypto.
import { ADMIN_COOKIE } from '@curios/core/admin';

/**
 * Checks the cookie is PRESENT, nothing more. A redirect convenience, never a
 * security boundary: the (admin) layout runs on Node and asks the database
 * whether the session is real, and the API re-authorizes every request.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(ADMIN_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/signin', request.url));
}

// Everything except the sign-in page and assets.
export const config = { matcher: ['/((?!signin|_next/|favicon[.]ico|icon[.]svg|.*[.][a-z0-9]+$).*)'] };
