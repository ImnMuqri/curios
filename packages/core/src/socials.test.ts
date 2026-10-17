import { describe, expect, it } from 'vitest';
import { SOCIAL_KINDS, normalizeSocial, socialUrl, tidySocials } from './socials.js';

describe('normalizeSocial', () => {
  it.each([
    ['instagram', 'keklina', 'keklina'],
    ['instagram', '@KekLina', 'keklina'],
    ['instagram', 'https://www.instagram.com/keklina/', 'keklina'],
    ['instagram', 'instagram.com/kek.lina_bakes?igsh=abc', 'kek.lina_bakes'],
    ['tiktok', '@keklina.bakes', 'keklina.bakes'],
    ['tiktok', 'https://www.tiktok.com/@keklina.bakes', 'keklina.bakes'],
    ['facebook', 'facebook.com/KekLinaShahAlam', 'KekLinaShahAlam'],
    ['youtube', 'https://youtube.com/@keklina', 'keklina'],
    ['youtube', '@kek-lina', 'kek-lina'],
    ['whatsapp', '012-345 6789', '60123456789'],
    ['whatsapp', 'https://wa.me/60123456789', '60123456789'],
    ['whatsapp', '+60 11-2345 6789', '601123456789'],
    ['email', ' Lina@KekLina.example ', 'lina@keklina.example'],
  ] as const)('%s: %s becomes %s', (kind, raw, stored) => {
    expect(normalizeSocial(kind, raw)).toBe(stored);
  });

  it('clears a field left blank', () => {
    for (const kind of SOCIAL_KINDS) expect(normalizeSocial(kind, '   ')).toBe('');
  });

  it.each([
    ['instagram', 'kek lina'],
    ['instagram', 'a'.repeat(31)],
    ['tiktok', 'https://example.com/keklina'],
    ['whatsapp', '12345'],
    ['whatsapp', '+65 9123 4567'],
    ['email', 'lina@'],
    ['youtube', '<script>'],
    ['facebook', 'face book'],
  ] as const)('%s refuses %s', (kind, raw) => {
    expect(normalizeSocial(kind, raw)).toBeNull();
  });
});

describe('socialUrl', () => {
  it('builds the address each profile lives at', () => {
    expect(socialUrl('instagram', 'keklina')).toBe('https://instagram.com/keklina');
    expect(socialUrl('whatsapp', '60123456789')).toBe('https://wa.me/60123456789');
    expect(socialUrl('tiktok', 'keklina.bakes')).toBe('https://www.tiktok.com/@keklina.bakes');
    expect(socialUrl('email', 'lina@keklina.example')).toBe('mailto:lina@keklina.example');
    expect(socialUrl('facebook', 'KekLinaShahAlam')).toBe('https://facebook.com/KekLinaShahAlam');
    expect(socialUrl('youtube', 'keklina')).toBe('https://youtube.com/@keklina');
  });
});

describe('tidySocials', () => {
  it('keeps the known, filled-in profiles from whatever the column holds, in a fixed order', () => {
    expect(tidySocials({ youtube: 'keklina', instagram: 'keklina', myspace: 'x', email: '' })).toEqual([
      { kind: 'instagram', value: 'keklina' },
      { kind: 'youtube', value: 'keklina' },
    ]);
    expect(tidySocials(null)).toEqual([]);
    expect(tidySocials('nonsense')).toEqual([]);
  });
});
