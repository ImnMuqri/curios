/**
 * Is this numeric address one an ingest fetch must never dial?
 *
 * The registries this encodes are IANA's IPv4 and IPv6 special-purpose
 * registries, narrowed to what actually matters here: reaching a machine that
 * is not on the public internet. Documentation ranges -- TEST-NET, 2001:db8 --
 * are deliberately absent. They are unroutable rather than private, blocking
 * them protects nobody, and every entry that protects nobody makes the list
 * harder for the next reader to trust.
 *
 * Unparseable input returns true. There is no address here we can reason
 * about, and the only safe answer to "may I dial this?" is no.
 */
export function isBlockedAddress(address: string): boolean {
  // A zone suffix (fe80::1%eth0) and brackets ([::1]) are both spellings the
  // classifier must see through rather than fail to parse and accidentally
  // block for the wrong reason. Blocked-for-the-wrong-reason passes tests and
  // hides a parser that does not work.
  const bare = address.trim().replace(/^\[/, '').replace(/\]$/, '').split('%')[0] ?? '';

  const v4 = parseIPv4(bare);
  if (v4) return isBlockedV4(v4);

  const v6 = parseIPv6(bare);
  if (v6) return isBlockedV6(v6);

  return true;
}

/** Dotted quad only. Every other IPv4 spelling is folded by URL parsing before it reaches here. */
function parseIPv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isBlockedV4(o: number[]): boolean {
  const [a = 0, b = 0, c = 0] = o;

  if (a === 0) return true; // 0.0.0.0/8 -- and 0.0.0.0 itself reaches localhost
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16, metadata included
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

/** Returns eight 16-bit groups, or null. Handles `::` and a trailing dotted IPv4. */
function parseIPv6(value: string): number[] | null {
  if (!value.includes(':')) return null;

  let text = value;
  let embedded: number[] | null = null;

  // A trailing IPv4 (::ffff:127.0.0.1) occupies the last two groups.
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const v4 = parseIPv4(text.slice(cut + 1));
    if (!v4) return null;
    embedded = [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)];
    text = text.slice(0, cut);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (!head || !tail) return null;

  const known = head.length + tail.length + (embedded?.length ?? 0);

  if (halves.length === 2) {
    // '::' must stand for at least one group, so a full eight without it is malformed.
    if (known > 7) return null;
    return [...head, ...new Array<number>(8 - known).fill(0), ...tail, ...(embedded ?? [])];
  }

  if (known !== 8) return null;
  return [...head, ...tail, ...(embedded ?? [])];
}

function parseGroups(text: string): number[] | null {
  if (text === '') return [];
  const out: number[] = [];
  for (const group of text.split(':')) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(Number.parseInt(group, 16));
  }
  return out;
}

function isBlockedV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  // Anything wrapping an IPv4 address is judged as that IPv4 address. This one
  // rule covers ::, ::1, the IPv4-mapped ::ffff:x and the deprecated
  // IPv4-compatible ::x forms, so none of them can smuggle 127.0.0.1 past a
  // check that only knows how to read four octets.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    return isBlockedV4(unwrapV4(g6, g7));
  }

  // NAT64. 64:ff9b::/96 exists precisely to carry an IPv4 address, and a
  // translator on the far side will happily carry it to a private one.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedV4(unwrapV4(g6, g7));
  }

  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

function unwrapV4(high: number, low: number): number[] {
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}
