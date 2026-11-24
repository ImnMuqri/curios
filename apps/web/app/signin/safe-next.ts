/** Where sign in may send the person next: a path on this site, else the dashboard. Never another origin. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\u0000-\u001f]/.test(next)) return '/app';
  return next;
}
