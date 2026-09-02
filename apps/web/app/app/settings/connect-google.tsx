/**
 * A plain anchor to `GET /auth/google/link`, on the API origin, absolutely --
 * C3. Never a relative href: that endpoint does not exist on this Next app
 * and would 404. Never a `fetch`: the browser has to follow the redirect
 * chain to Google itself, and a `fetch` would follow it in the background and
 * hand back Google's HTML instead of navigating anywhere.
 *
 * No client-side state here, so no `'use client'` and no wrapper split --
 * unlike the forms elsewhere in this task, there is no closure over
 * `apiFetch` to keep off the server side of the RSC boundary.
 */
export function ConnectGoogle() {
  const href = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google/link`;

  return <a href={href}>Connect Google</a>;
}
