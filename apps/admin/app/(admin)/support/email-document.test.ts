import { describe, expect, it } from 'vitest';
import { buildEmailDocument, hasRemoteImages } from './email-document.js';

const csp = (doc: string) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1];

describe('buildEmailDocument', () => {
  it('lets only data: images load by default', () => {
    const doc = buildEmailDocument({ html: '<p>Hi</p><img src="https://track.example/p.gif">', text: null, showRemoteImages: false });

    expect(csp(doc)).toBe("default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:");
    expect(csp(doc)).not.toContain('https:');
  });

  it('adds https: images, and nothing else, once Show images is pressed', () => {
    const doc = buildEmailDocument({ html: '<p>Hi</p>', text: null, showRemoteImages: true });

    expect(csp(doc)).toBe("default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: https:");
  });

  it('never allows script, and always starts from default-src none', () => {
    for (const showRemoteImages of [false, true]) {
      for (const input of [{ html: '<script>alert(1)</script>', text: null }, { html: null, text: 'hi' }]) {
        const policy = csp(buildEmailDocument({ ...input, showRemoteImages }))!;
        expect(policy).not.toContain('script-src');
        expect(policy).toContain("default-src 'none'");
      }
    }
  });

  it('opens links outside the frame, and puts the policy before the email', () => {
    const doc = buildEmailDocument({ html: '<a href="https://x.example">x</a>', text: null, showRemoteImages: false });

    expect(doc).toContain('<base target="_blank">');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<a href'));
    expect(doc.indexOf('<base')).toBeLessThan(doc.indexOf('<a href'));
  });

  it('shows a text-only email escaped, with its line breaks kept', () => {
    const doc = buildEmailDocument({ html: null, text: '<b>hi</b>\n& bye', showRemoteImages: false });

    expect(doc).toContain('<pre style="white-space:pre-wrap">&lt;b&gt;hi&lt;/b&gt;\n&amp; bye</pre>');
    expect(doc).not.toContain('<b>hi</b>');
  });
});

describe('hasRemoteImages', () => {
  it('is true only for an image whose source is http: or https:', () => {
    expect(hasRemoteImages('<img src="https://track.example/p.gif">')).toBe(true);
    expect(hasRemoteImages("<IMG alt='' SRC='http://x.example/a.png'>")).toBe(true);
    expect(hasRemoteImages('<img src=https://x.example/a.png>')).toBe(true);
    expect(hasRemoteImages('<img src="data:image/png;base64,AAAA">')).toBe(false);
    expect(hasRemoteImages('<img src="cid:img1">')).toBe(false);
    expect(hasRemoteImages('<a href="https://x.example">link</a>')).toBe(false);
    expect(hasRemoteImages(null)).toBe(false);
  });
});
