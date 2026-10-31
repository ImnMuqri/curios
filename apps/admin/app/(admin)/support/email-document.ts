const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** An `<img>` whose src is http: or https:, the kind that tells the sender the email was opened. */
const REMOTE_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/i;

export function hasRemoteImages(html: string | null): boolean {
  return html !== null && REMOTE_IMAGE.test(html);
}

/** Elements that fetch, navigate or re-point the document on their own, which a CSP does not all cover. */
const STRIPPED = 'link, meta, base, script, iframe, object, embed, frame';

/**
 * The email's HTML with every element that could reach out removed: a `<link rel=preconnect>` or
 * `dns-prefetch` contacts the sender on open whatever the policy says, and the email's own `<meta>`
 * and `<base>` must not compete with ours. Parsed inertly (a DOMParser document runs and loads
 * nothing). Its head keeps only its `<style>`s. Where there is no DOMParser (a server render; the
 * screen loads mail only in the browser) the HTML is not used at all.
 */
function inertHtml(html: string): string | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(STRIPPED).forEach((el) => el.remove());
  const styles = Array.from(doc.head.querySelectorAll('style'), (el) => el.outerHTML).join('');
  return styles + doc.body.innerHTML;
}

/**
 * The whole document an email is shown as, for an iframe's `srcdoc`. The policy comes first, so it
 * governs everything after it: no script, nothing remote, no other base URL, and images only from
 * data: (the API turns cid: images into data: URIs) until the admin presses Show images, which adds
 * https: and nothing else. The frame's sandbox is the second wall: even if the policy were dropped,
 * script cannot run.
 */
export function buildEmailDocument(input: { html: string | null; text: string | null; showRemoteImages: boolean }): string {
  const policy = `default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${input.showRemoteImages ? ' https:' : ''}`;
  const body =
    (input.html === null ? null : inertHtml(input.html)) ??
    `<pre style="white-space:pre-wrap">${escapeHtml(input.text ?? '')}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta http-equiv="x-dns-prefetch-control" content="off"><base target="_blank"></head><body>${body}</body></html>`;
}
