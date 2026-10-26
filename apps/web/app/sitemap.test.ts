import { describe, expect, it, vi } from 'vitest';

const getSitemapPages = vi.fn();
vi.mock('@curios/db-read', () => ({ getSitemapPages, SITEMAP_URL_LIMIT: 30 }));

const sitemap = (await import('./sitemap.js')).default;
const urls = async () => (await sitemap()).map((entry) => entry.url.replace('https://curios.my', ''));

describe('sitemap', () => {
  it('lists the site, then each page with its shop, its FAQ list and each entry', async () => {
    getSitemapPages.mockResolvedValue([
      { handle: 'keklina', shop: true, faqSlugs: ['is-it-halal', 'do-you-deliver'] },
      { handle: 'nadia', shop: false, faqSlugs: [] },
    ]);
    const listed = await urls();
    expect(listed.slice(0, 2)).toEqual(['', '/ms']);
    expect(listed).toContain('/privacy');
    expect(listed.slice(-6)).toEqual(['/keklina', '/keklina/shop', '/keklina/faq', '/keklina/faq/is-it-halal', '/keklina/faq/do-you-deliver', '/nadia']);
    expect(listed).not.toContain('/nadia/faq');
  });

  it('stops at the protocol’s limit for one file', async () => {
    getSitemapPages.mockResolvedValue(Array.from({ length: 40 }, (_, i) => ({ handle: `p${i}`, shop: false, faqSlugs: [] })));
    expect(await sitemap()).toHaveLength(30);
  });
});
