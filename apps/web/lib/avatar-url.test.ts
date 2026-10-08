import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { avatarUrl, coverUrlFrom, joinAvatarUrl } from './avatar-url.js';

/**
 * Fix round 1, item 2: `avatarUrl` trims a base's trailing slash before
 * joining, but `my-curios-wrapper.tsx` built the fresh-upload URL with a bare
 * template literal and no trim, so the two could disagree the moment
 * `STORAGE_PUBLIC_URL` ends in "/". `joinAvatarUrl` is the one rule now, used
 * by both.
 */
describe('joinAvatarUrl', () => {
  it('joins a base and a key', () => {
    expect(joinAvatarUrl('https://cdn.example', 'avatars/p/1.webp')).toBe('https://cdn.example/avatars/p/1.webp');
  });

  it('does not double the slash when the base already ends in one', () => {
    expect(joinAvatarUrl('https://cdn.example/', 'avatars/p/1.webp')).toBe('https://cdn.example/avatars/p/1.webp');
  });

  it('trims more than one trailing slash', () => {
    expect(joinAvatarUrl('https://cdn.example//', 'avatars/p/1.webp')).toBe('https://cdn.example/avatars/p/1.webp');
  });
});

/**
 * Self-review addition (not in the task brief's own test list): `avatarUrl`
 * is a new pure function with three branches -- no key, no configured base,
 * and the trailing-slash trim -- and nothing else in the suite reads it
 * directly. `BentoPage.test.tsx` only exercises the render side of a URL
 * that is already non-null.
 */
describe('avatarUrl', () => {
  const original = process.env.STORAGE_PUBLIC_URL;

  beforeEach(() => {
    process.env.STORAGE_PUBLIC_URL = 'https://cdn.example';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.STORAGE_PUBLIC_URL;
    else process.env.STORAGE_PUBLIC_URL = original;
  });

  it('joins the configured base and the key', () => {
    expect(avatarUrl('avatars/p/1.webp')).toBe('https://cdn.example/avatars/p/1.webp');
  });

  it('is null when there is no key', () => {
    expect(avatarUrl(null)).toBeNull();
  });

  it('is null when storage is not configured, even with a key', () => {
    delete process.env.STORAGE_PUBLIC_URL;
    expect(avatarUrl('avatars/p/1.webp')).toBeNull();
  });

  it('does not double the slash when the base already ends in one', () => {
    process.env.STORAGE_PUBLIC_URL = 'https://cdn.example/';
    expect(avatarUrl('avatars/p/1.webp')).toBe('https://cdn.example/avatars/p/1.webp');
  });
});

describe('coverUrlFrom', () => {
  it('serves a stock cover from this app, storage or not', () => {
    expect(coverUrlFrom('stock/kedai', null)).toBe('/covers/kedai.webp');
    expect(coverUrlFrom('stock/kedai', 'https://pub.example.dev')).toBe('/covers/kedai.webp');
  });

  it('serves an uploaded cover from storage, and nothing without it', () => {
    expect(coverUrlFrom('covers/p1/a.webp', 'https://pub.example.dev/')).toBe('https://pub.example.dev/covers/p1/a.webp');
    expect(coverUrlFrom('covers/p1/a.webp', null)).toBeNull();
    expect(coverUrlFrom(null, 'https://pub.example.dev')).toBeNull();
  });

  it('never turns an unknown stock name into a path', () => {
    expect(coverUrlFrom('stock/../../secret', null)).toBeNull();
  });
});
