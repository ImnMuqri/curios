import { describe, expect, it } from 'vitest';
import { createS3Store, STORAGE_ENV, storageDisabled } from './storage.js';

const all = Object.fromEntries(STORAGE_ENV.map((name) => [name, 'set']));

describe('storageDisabled', () => {
  it('switches uploads off in development when nothing is set', () => {
    expect(storageDisabled({ NODE_ENV: 'development' })).toBe(true);
    expect(storageDisabled({})).toBe(true);
  });
  it('never switches them off in production', () => {
    expect(storageDisabled({ NODE_ENV: 'production' })).toBe(false);
  });
  it('keeps them on when everything is set, and when only some is (so startup names the gap)', () => {
    expect(storageDisabled({ ...all })).toBe(false);
    expect(storageDisabled({ STORAGE_BUCKET: 'b' })).toBe(false);
  });
});

// Fix round 1, item 1a: storageDisabled only decides WHETHER a store gets
// built; nothing before this proved createS3Store itself refuses a partial
// set and names the gap. Passing the env object directly means these throw
// before any S3Client is constructed -- no network call to fail instead.
describe('createS3Store', () => {
  it('throws naming the missing setting when one is absent', () => {
    const { STORAGE_BUCKET: _omitted, ...partial } = all;
    expect(() => createS3Store(partial)).toThrow(/STORAGE_BUCKET is not set/);
  });

  it('throws the same way when only STORAGE_PUBLIC_URL is missing', () => {
    const { STORAGE_PUBLIC_URL: _omitted, ...partial } = all;
    expect(() => createS3Store(partial)).toThrow(/STORAGE_PUBLIC_URL is not set/);
  });
});
