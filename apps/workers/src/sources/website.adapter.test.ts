import { describe, expect, it } from 'vitest';
import { createWebsiteAdapter, extractText } from './website.adapter.js';
import { instagramAdapter } from './instagram.adapter.js';

const HOME = `<html><head><title>Nadia Bakes</title></head><body>
  <nav><a href="/menu">Menu</a><a href="https://facebook.com/x">FB</a></nav>
  <script>console.log('ignore me')</script>
  <style>body{color:red}</style>
  <h1>Nadia Bakes</h1>
  <p>Kek butter 1kg — RM95, tempahan 3 hari awal.</p>
</body></html>`;

const MENU = `<html><head><title>Menu</title></head><body><p>Kek coklat 1kg RM110.</p></body></html>`;

function fakeFetcher(pages: Record<string, string>) {
  const seen: string[] = [];
  return {
    seen,
    fetchPage: async (url: string) => {
      seen.push(url);
      const body = pages[url];
      if (!body) throw new Error(`404 ${url}`);
      return body;
    },
  };
}

describe('extractText', () => {
  it('drops script and style content', () => {
    const { text } = extractText(HOME);
    expect(text).not.toContain('ignore me');
    expect(text).not.toContain('color:red');
  });

  it('keeps visible prose and the title', () => {
    const { title, text } = extractText(HOME);
    expect(title).toBe('Nadia Bakes');
    expect(text).toContain('Kek butter 1kg');
  });

  it('returns same-document hrefs', () => {
    expect(extractText(HOME).links).toContain('/menu');
  });
});

const SHELL = `<html><head>
  <title>Nadia (@nadiabakes)</title>
  <meta property="og:title" content="Nadia (@nadiabakes)">
  <meta property="og:description" content="Home baker in Shah Alam. Kek butter from RM95, order by DM.">
  <meta name="description" content="Home baker in Shah Alam. Kek butter from RM95, order by DM.">
</head><body><div id="root"></div></body></html>`;

describe('extractText, on a page that renders in JavaScript', () => {
  it('reads the meta tags when the body has almost nothing', () => {
    const { text } = extractText(SHELL);

    expect(text).toContain('Nadia (@nadiabakes)');
    expect(text).toContain('Kek butter from RM95');
  });

  it('does not repeat a description that og and meta share', () => {
    const { text } = extractText(SHELL);

    expect(text.split('Kek butter from RM95').length - 1).toBe(1);
  });

  it('ignores meta tags on a page with real content', () => {
    // Well over 200 characters of body. The fallback is for shells; a real page
    // already says what it says, and its description is usually marketing.
    const prose = 'Kek butter 1kg RM95, tempahan 3 hari awal. '.repeat(8);
    const html = `<html><head><meta property="og:description" content="A tagline that must not appear"></head><body><p>${prose}</p></body></html>`;

    expect(extractText(html).text).not.toContain('must not appear');
  });
});

describe('createWebsiteAdapter', () => {
  it('crawls the root and same-origin links', async () => {
    const f = fakeFetcher({
      'https://nadia.example/': HOME,
      'https://nadia.example/menu': MENU,
    });
    const adapter = createWebsiteAdapter({ fetchPage: f.fetchPage });
    const docs = await adapter.fetch('https://nadia.example/');

    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.url)).toEqual([
      'https://nadia.example/',
      'https://nadia.example/menu',
    ]);
  });

  it('never leaves the origin', async () => {
    const f = fakeFetcher({ 'https://nadia.example/': HOME });
    const adapter = createWebsiteAdapter({ fetchPage: f.fetchPage });
    await adapter.fetch('https://nadia.example/');
    expect(f.seen.some((u) => u.includes('facebook.com'))).toBe(false);
  });

  it('caps the crawl at 25 pages', async () => {
    const pages: Record<string, string> = {};
    const links = Array.from({ length: 60 }, (_, i) => `<a href="/p${i}">p</a>`).join('');
    pages['https://big.example/'] = `<html><body>${links}</body></html>`;
    for (let i = 0; i < 60; i += 1) {
      pages[`https://big.example/p${i}`] = `<html><body><p>page ${i}</p></body></html>`;
    }
    const f = fakeFetcher(pages);
    const adapter = createWebsiteAdapter({ fetchPage: f.fetchPage });
    const docs = await adapter.fetch('https://big.example/');
    expect(docs.length).toBeLessThanOrEqual(25);
  });

  it('skips a page that fails rather than failing the crawl', async () => {
    const f = fakeFetcher({ 'https://nadia.example/': HOME });
    const adapter = createWebsiteAdapter({ fetchPage: f.fetchPage });
    const docs = await adapter.fetch('https://nadia.example/');
    expect(docs).toHaveLength(1);
  });

  it('rejects a non-http url', async () => {
    const adapter = createWebsiteAdapter({ fetchPage: async () => '' });
    await expect(adapter.fetch('file:///etc/passwd')).rejects.toThrow(/http/i);
  });
});

describe('instagramAdapter', () => {
  it('throws NOT_CONFIGURED so the shape is proven before access is', async () => {
    await expect(instagramAdapter.fetch('@nadia')).rejects.toThrow(/NOT_CONFIGURED/);
  });
});
