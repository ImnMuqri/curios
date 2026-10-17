/** "keklina.example/menu" from a source address: no scheme, no www, no trailing slash. Not an address: as it is. */
export function sourcePlace(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return parsed.host.replace(/^www\./, '') + path;
  } catch {
    return url;
  }
}
