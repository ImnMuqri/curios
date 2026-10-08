import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetWantedHandle, readWantedHandle, rememberWantedHandle, tidyHandle } from './wanted-handle.js';

describe('the wanted handle', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('keeps only what a handle can contain', () => {
    expect(tidyHandle('  @Kek Lina!  ')).toBe('keklina');
    expect(tidyHandle('kek_lina-2')).toBe('kek_lina-2');
    expect(tidyHandle('a'.repeat(40))).toHaveLength(30);
  });

  it('survives the trip through sign-up, and is forgotten once claimed', () => {
    rememberWantedHandle('KekLina');
    expect(readWantedHandle()).toBe('keklina');
    forgetWantedHandle();
    expect(readWantedHandle()).toBe('');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => rememberWantedHandle('keklina')).not.toThrow();
    expect(readWantedHandle()).toBe('');
  });
});
