import { describe, expect, it } from 'vitest';
import { STORAGE_ENV, storageDisabled } from './storage.js';

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
