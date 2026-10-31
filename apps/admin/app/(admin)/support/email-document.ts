const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** An `<img>` whose src is http: or https:, the kind that tells the sender the email was opened. */
const REMOTE_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/i;

export function hasRemoteImages(html: string | null): boolean {
  return html !== null && REMOTE_IMAGE.test(html);
}

/**
 * The whole document an email is shown as, for an iframe's `srcdoc`. The policy comes first, so it
 * governs everything after it: no script, nothing remote, and images only from data: (the API turns
 * cid: images into data: URIs) until the admin presses Show images, which adds https: and nothing
 * else. The frame's sandbox is the second wall: even if the policy were dropped, script cannot run.
 */
export function buildEmailDocument(input: { html: string | null; text: string | null; showRemoteImages: boolean }): string {
  const policy = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${input.showRemoteImages ? ' https:' : ''}`;
  const body =
    input.html ?? `<pre style="white-space:pre-wrap">${escapeHtml(input.text ?? '')}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><base target="_blank"></head><body>${body}</body></html>`;
}
