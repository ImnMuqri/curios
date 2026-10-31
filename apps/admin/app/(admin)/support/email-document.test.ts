import { describe, expect, it } from 'vitest';
import { buildEmailDocument, hasRemoteImages } from './email-document.js';

const csp = (doc: string) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1];

describe('buildEmailDocument', () => {
  it('lets only data: images load by default', () => {
    const doc = buildEmailDocument({ html: '<p>Hi</p><img src="https://track.example/p.gif">', text: null, showRemoteImages: false });

    expect(csp(doc)).toBe("default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:");
    expect(csp(doc)).not.toContain('https:');
  });

  it('adds https: images, and nothing else, once Show images is pressed', () => {
    const doc = buildEmailDocument({ html: '<p>Hi</p>', text: null, showRemoteImages: true });

    expect(csp(doc)).toBe("default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: https:");
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

describe('buildEmailDocument, against an email that tries to reach out', () => {
  it('drops link, meta and base tags, so nothing contacts the sender on open', () => {
    const html =
      '<html><head><link rel=preconnect href=https://t.example><link rel="dns-prefetch" href="//t.example">' +
      '<link rel=stylesheet href=https://t.example/s.css><meta http-equiv=refresh content="0;url=https://t.example">' +
      '<base href=https://t.example><style>p { color: red }</style></head>' +
      '<body><p>Hi</p><link rel=prefetch href=https://t.example/x><iframe src=https://t.example></iframe>' +
      '<object data=https://t.example></object><embed src=https://t.example><script>fetch("https://t.example")</script>' +
      // A template's content is its own fragment, out of querySelectorAll's reach; the srcdoc parser
      // would attach a declarative shadow root and bring the <link> back to life.
      '<template shadowrootmode=open><link rel=preconnect href=https://t.example></template>' +
      '<div><template><template shadowrootmode=open><link rel=dns-prefetch href=//t.example></template></template></div>' +
      '<noscript><link rel=preconnect href=https://t.example></noscript></body></html>';
    const doc = buildEmailDocument({ html, text: null, showRemoteImages: true });

    expect(doc).not.toContain('t.example');
    expect(doc).toContain('<style>p { color: red }</style>');
    expect(doc).toContain('<p>Hi</p>');
    expect(doc).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
  });

  it('keeps only our policy and our base when the email brings its own', () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="img-src *"><base target="_self"></head><body><p>Hi</p></body></html>';
    const doc = buildEmailDocument({ html, text: null, showRemoteImages: false });

    expect(doc.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(csp(doc)).toBe("default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:");
    expect(doc.match(/<base\b[^>]*>/g)).toEqual(['<base target="_blank">']);
    expect(doc).not.toContain('img-src *');
  });

  it('shows the text, not the HTML, where there is no DOMParser', () => {
    const parser = globalThis.DOMParser;
    // @ts-expect-error -- a server render has none
    delete globalThis.DOMParser;
    try {
      const doc = buildEmailDocument({ html: '<p>Hi</p>', text: 'Hi <there>', showRemoteImages: false });
      expect(doc).toContain('<pre style="white-space:pre-wrap">Hi &lt;there&gt;</pre>');
      expect(doc).not.toContain('<p>Hi</p>');
    } finally {
      globalThis.DOMParser = parser;
    }
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
