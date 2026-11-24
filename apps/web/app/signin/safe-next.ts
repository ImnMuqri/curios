/** Where sign in may send the person next: a path on this site, else the dashboard. Never another origin. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || [...next].some((c) => c.charCodeAt(0) < 0x20)) return '/app';
  return next;
}
