import { describe, expect, it } from 'vitest';
import { ACCOUNT_MAIL_FOOTER, escapeHtml, renderMailHtml } from './mail.js';

const base = { subject: 'Confirm your email', heading: 'Confirm your email', footer: ACCOUNT_MAIL_FOOTER };

describe('renderMailHtml', () => {
  it('the header is the hosted wordmark image with alt "curios"', () => {
    const html = renderMailHtml({ ...base, blocks: [], appUrl: 'https://curios.my/' });
    expect(html).toContain('<img src="https://curios.my/email/wordmark@2x.png"');
    expect(html).toContain('alt="curios"');
    expect(html).toContain('width="');
    expect(html).toContain('height="28"');
    expect(html).toContain('display:block;border:0');
  });

  it('lays the email out: wordmark, heading, button, footer', () => {
    const html = renderMailHtml({
      ...base,
      blocks: [
        { kind: 'p', text: 'Confirm your address to finish setting up Curios.' },
        { kind: 'buttons', primary: { label: 'Confirm my email', href: 'https://curios.my/verify?token=abc' } },
      ],
    });

    expect(html).toContain('<title>Confirm your email</title>');
    expect(html).not.toContain('>curios<');
    expect(html).toContain('>Confirm your email</h1>');
    expect(html).toContain('href="https://curios.my/verify?token=abc"');
    expect(html).toContain('>Confirm my email</a>');
    expect(html).toContain('You get this because someone used this address on Curios.');
    expect(html).toContain('Curios &middot; curios.my &middot; Kuala Lumpur');
  });

  it('escapes every string, so a visitor’s own words cannot become markup', () => {
    const html = renderMailHtml({
      ...base,
      heading: 'New lead <b>',
      blocks: [{ kind: 'chat', lines: [{ from: 'visitor', text: '<script>alert(1)</script> & "you"' }] }],
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;you&quot;');
    expect(html).toContain('New lead &lt;b&gt;');
  });

  it('links only to http(s) addresses', () => {
    const html = renderMailHtml({ ...base, blocks: [{ kind: 'buttons', primary: { label: 'Open', href: 'javascript:alert(1)' } }] });

    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('keeps line breaks in a paragraph', () => {
    expect(renderMailHtml({ ...base, blocks: [{ kind: 'p', text: 'one\ntwo' }] })).toContain('one<br>two');
  });

  it('gives a fallback link under the button, for a client that will not click', () => {
    const html = renderMailHtml({ ...base, blocks: [{ kind: 'fallback', url: 'https://curios.my/reset?token=x' }] });
    expect(html).toContain('Button not working? Paste this into your browser:');
    expect(html).toContain('https://curios.my/reset?token=x</p>');
  });

  it('shows a tag, a number and labelled facts', () => {
    const html = renderMailHtml({
      ...base,
      tag: { label: 'New lead', tone: 'hijau' },
      blocks: [
        { kind: 'number', value: '+60 17-882 4410', note: 'Left 2:15pm' },
        { kind: 'facts', rows: [['Product', 'Kek kahwin']] },
      ],
    });
    expect(html).toContain('New lead</span>');
    expect(html).toContain('+60 17-882 4410');
    expect(html).toContain('Left 2:15pm');
    expect(html).toContain('>Kek kahwin</td>');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
