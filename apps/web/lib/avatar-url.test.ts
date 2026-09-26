import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { avatarUrl } from './avatar-url.js';

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
