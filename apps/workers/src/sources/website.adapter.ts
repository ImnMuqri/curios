import * as cheerio from 'cheerio';
import type { SourceDocument } from '@curios/core';
import type { SourceAdapter } from './types.js';

const MAX_PAGES = 25;
const MAX_DEPTH = 2;
const MAX_TOTAL_BYTES = 4_000_000;

export function extractText(html: string): { title: string; text: string; links: string[] } {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();

  const title = $('title').first().text().trim();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const links = $('a[href]')
    .map((_, el) => $(el).attr('href') ?? '')
    .get()
    .filter(Boolean);

  return { title, text, links };
}

export interface WebsiteAdapterDeps {
  fetchPage: (url: string) => Promise<string>;
}

export function createWebsiteAdapter(deps: WebsiteAdapterDeps): SourceAdapter {
  return {
    id: 'website',
    async fetch(input: string): Promise<SourceDocument[]> {
      const root = new URL(input);
      if (root.protocol !== 'http:' && root.protocol !== 'https:') {
        throw new Error(`Only http and https urls can be crawled, got ${root.protocol}`);
      }

      const queue: Array<{ url: string; depth: number }> = [{ url: root.href, depth: 0 }];
      const seen = new Set<string>([root.href]);
      const docs: SourceDocument[] = [];
      let bytes = 0;

      while (queue.length > 0 && docs.length < MAX_PAGES && bytes < MAX_TOTAL_BYTES) {
        const next = queue.shift();
        if (!next) break;

        let html: string;
        try {
          html = await deps.fetchPage(next.url);
        } catch {
          // One bad page must not end the crawl.
          continue;
        }

        bytes += html.length;
        const { title, text, links } = extractText(html);
        docs.push({ url: next.url, title, text });

        if (next.depth >= MAX_DEPTH) continue;

        for (const href of links) {
          let resolved: URL;
          try {
            resolved = new URL(href, next.url);
          } catch {
            continue;
          }
          resolved.hash = '';
          if (resolved.origin !== root.origin) continue;
          if (seen.has(resolved.href)) continue;
          seen.add(resolved.href);
          queue.push({ url: resolved.href, depth: next.depth + 1 });
        }
      }

      return docs;
    },
  };
}
