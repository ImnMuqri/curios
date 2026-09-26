import { describe, expect, it } from 'vitest';
import { loginWalledSite } from './social-links.js';

describe('loginWalledSite', () => {
  it('names the sites that show the crawler a login wall', () => {
    expect(loginWalledSite('https://www.linkedin.com/in/nadia')).toBe('LinkedIn');
    expect(loginWalledSite('https://instagram.com/nadiabakes')).toBe('Instagram');
    expect(loginWalledSite('https://www.tiktok.com/@nadiabakes')).toBe('TikTok');
  });

  it('matches their subdomains, and any capitalisation', () => {
    expect(loginWalledSite('https://my.linkedin.com/in/nadia')).toBe('LinkedIn');
    expect(loginWalledSite('HTTPS://WWW.INSTAGRAM.COM/nadiabakes')).toBe('Instagram');
  });

  // An owner types what they see in the address bar, often without the scheme.
  it('reads a link typed without https://', () => {
    expect(loginWalledSite('linkedin.com/in/nadia')).toBe('LinkedIn');
  });

  it('leaves every other site alone', () => {
    expect(loginWalledSite('https://nadiabakes.my')).toBeNull();
    expect(loginWalledSite('https://linktr.ee/nadia')).toBeNull();
    expect(loginWalledSite('https://shopee.com.my/nadiabakes')).toBeNull();
  });

  // Only the host counts. A shop whose own address mentions a platform is still a shop.
  it('is not fooled by a platform name elsewhere in the address', () => {
    expect(loginWalledSite('https://notlinkedin.com')).toBeNull();
    expect(loginWalledSite('https://nadiabakes.my/instagram.com')).toBeNull();
  });

  it('returns null for something that is not a link at all', () => {
    expect(loginWalledSite('')).toBeNull();
    expect(loginWalledSite('not a url with spaces')).toBeNull();
  });
});
